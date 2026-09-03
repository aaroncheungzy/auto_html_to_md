/* background/background.js
 * MV3 service worker：菜单/快捷键、单页与选区转换、批量抓取+转换编排、下载。
 */
(() => {
  const DEFAULT_SETTINGS = {
    addSourceInfo: true,
    showPreview: true,
    autoCopy: false,
    autoDownload: false,
    batchConcurrency: 4,
    batchTimeoutMs: 20000,
    keepAllImages: false,
    bundleImages: true
  };

  const INJECT_FILES = [
    'lib/turndown.js',
    'lib/turndown-plugin-gfm.js',
    'utils/textBlockStructure.js',
    'utils/converter.js',
    'content/content.js'
  ];

  let offscreenReady = false;
  let pendingBatchTab = null; // 批量"先选区再跳转"流程中，待跳转的源页面 tabId
  function safePost(port, msg) { try { port.postMessage(msg); } catch (_) { /* port may be closed */ } }

  /* ---------------- 工具函数 ---------------- */
  function isRestricted(url) {
    if (!url) return true;
    return ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'https://chrome.google.com/webstore'].some((p) => url.startsWith(p));
  }

  async function getSettings() {
    const { settings } = await chrome.storage.local.get(['settings']);
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  function sanitizeTitle(title) {
    let t = (title || '未命名').replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    t = t.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return t.slice(0, 80) || '未命名';
  }

  function timestampStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function makeFilename(title) {
    return `${sanitizeTitle(title)}_${timestampStr()}.md`;
  }

  function formatWithSource(md, title, url) {
    return `# ${title || '未命名'}\n\n> 来源：${url}\n\n${md}`;
  }
  
  /* 在页面中安装增强版链接提取器（供 executeScript 注入，自包含）。
   * 识别范围：标准 <a href>、无 href 的 <a>、祖先/后代中的链接、
   * data-href/data-url 等自定义链接属性，以及 title/aria-label/内联事件里内嵌的 URL
   * （即“鼠标悬停显示链接”的常见内部平台场景）。 */
  function installExtractLinks() {
    globalThis.extractLinks = function (node, here) {
      const out = [];
      const seen = new Set();
      const URL_TEXT_RE = /https?:\/\/[^\s"'<>`\)\]]+/i;
      const isHttp = (u) => /^https?:/i.test(u);
      function push(raw, text) {
        if (!raw) return;
        let abs;
        try { abs = new URL(raw, location.href).href; } catch (_) { return; }
        if (!isHttp(abs)) return;
        if (/^(javascript|mailto|tel):/i.test(abs)) return;
        // 仅过滤完全相同的 URL（含 hash），允许"同域不同 hash"——SPA 路由常见
        if (here && abs === here) return;
        if (seen.has(abs)) return;
        seen.add(abs);
        const t = (text || '').toString().trim().replace(/\s+/g, ' ').slice(0, 200);
        out.push({ url: abs, text: t || abs });
      }
      // 候选元素：当前节点 + 向上若干层祖先（点中的常是链接内部的按钮/图标/文字）+ 所有后代
      const elSet = new Set();
      let cur = node;
      let guard = 0;
      while (cur && cur.nodeType === 1 && guard < 8) { elSet.add(cur); cur = cur.parentElement; guard++; }
      if (node && node.querySelectorAll) node.querySelectorAll('*').forEach((d) => elSet.add(d));
      const HREF_ATTRS = ['href', 'data-href', 'data-url', 'data-link', 'data-to', 'data-route',
        'data-jump-url', 'data-jumpurl', 'data-target-url', 'data-redirect', 'data-goto',
        'data-nav', 'data-navigate', 'data-link-url', 'data-jump', 'data-linkto',
        'data-href-url', 'data-url-path', 'data-hreflink'];
      const TIP_ATTRS = ['title', 'aria-label', 'alt', 'data-tip', 'data-tooltip',
        'data-title', 'aria-description', 'data-original-title'];
      const EVENT_ATTRS = ['onclick', 'onmousedown', 'ondblclick'];
      elSet.forEach((el) => {
        if (!el || el.nodeType !== 1) return;
        for (const a of HREF_ATTRS) {
          if (a === 'href' && (el.tagName === 'LINK' || el.tagName === 'BASE')) continue;
          const v = el.getAttribute(a);
          // 不预过滤 isHttp：允许 href="#/post/..."、href="/path" 等相对值，由 URL 构造器解析
          if (v) push(v, el.textContent || el.getAttribute('title'));
        }
        for (const a of TIP_ATTRS) {
          const v = el.getAttribute(a);
          if (v) { const m = v.match(URL_TEXT_RE); if (m) push(m[0], v); }
        }
        for (const a of EVENT_ATTRS) {
          const v = el.getAttribute(a);
          if (v) { const m = v.match(URL_TEXT_RE); if (m) push(m[0], el.textContent || el.getAttribute('title')); }
        }
      });
      return out;
    };
  }

  /* 在页面中读取当前选区内的所有链接（供 executeScript func 注入） */
  function collectSelectionLinksInPage() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { links: [], reason: 'no-selection' };
    const container = document.createElement('div');
    container.appendChild(sel.getRangeAt(0).cloneContents());
    const here = location.href;
    const links = globalThis.extractLinks
      ? globalThis.extractLinks(container, here)
      : Array.from(container.querySelectorAll('a[href]')).map((a) => ({ url: a.href, text: a.textContent || a.title || a.href }));
    return { links, reason: links.length ? 'ok' : 'no-links' };
  }

  /* 在目标页安装增强链接提取器（供框选/选区提取前调用，幂等） */
  function installInteractiveItemExtractor() {
    globalThis.extractInteractiveItems = function (node) {
      const out = [], seen = new Set();
      const list = node && node.querySelectorAll ? Array.from(node.querySelectorAll('a[href], .list-item-main[id]')) : [];
      if (node && node.nodeType === 1 && node.matches('a[href]')) list.unshift(node);
      list.forEach((el) => {
        if (el.matches('.list-item-main[id]')) {
          const actionId = `job-${el.id}`;
          if (seen.has(actionId)) return;
          seen.add(actionId);
          el.setAttribute('data-auto-html-to-md-action-id', actionId);
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
          if (text) out.push({ kind: 'interactive', actionId, text, url: 'javascript:;', detailId: `detail_${el.id}` });
          return;
        }
        const href = (el.getAttribute('href') || '').trim();
        if (!/^(javascript:|#?$)/i.test(href)) return;
        let actionId = el.getAttribute('data-auto-html-to-md-action-id');
        if (!actionId) {
          actionId = `action-${(window.__autoHtmlToMdActionSeq || 0) + 1}`;
          window.__autoHtmlToMdActionSeq = (window.__autoHtmlToMdActionSeq || 0) + 1;
          el.setAttribute('data-auto-html-to-md-action-id', actionId);
        }
        if (seen.has(actionId)) return;
        seen.add(actionId);
        const text = (el.textContent || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 200);
        if (text) out.push({ kind: 'interactive', actionId, text, url: href || 'javascript:;' });
      });
      return out;
    };
  }

  async function ensureExtractorInjected(tabId) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: installExtractLinks });
      await chrome.scripting.executeScript({ target: { tabId }, func: installInteractiveItemExtractor });
    } catch (_) {}
  }

  /* 框选区域拾取链接：注入到页面，高亮元素，点击拾取其内部所有链接（可连续拾取，ESC/右键完成） */
  function startLinkPickerInPage() {
    if (window.__linkPickerActive) return { started: false, reason: 'already-active' };
    window.__linkPickerActive = true;
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'none';

    const Z = 2147483646;
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(59,130,246,.06);pointer-events:none;z-index:${Z};`;
    document.body.appendChild(overlay);

    const tip = document.createElement('div');
    tip.style.cssText = `position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 16px;border-radius:8px;font:14px system-ui,sans-serif;z-index:${Z + 1};box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;white-space:nowrap;`;
    tip.textContent = '移动鼠标框选区域，点击拾取其中的链接（可连续点击，右键/ESC 完成）';
    document.body.appendChild(tip);

    const box = document.createElement('div');
    box.style.cssText = `position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.12);pointer-events:none;z-index:${Z + 1};display:none;`;
    document.body.appendChild(box);

    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;top:64px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:8px 16px;border-radius:8px;font:14px system-ui,sans-serif;z-index:${Z + 1};box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;display:none;`;
    document.body.appendChild(toast);

    let currentEl = null;
    let total = 0;
    const allLinks = [];
    const allSeen = new Set();

    function cleanup() {
      window.__linkPickerActive = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      [overlay, tip, box, toast].forEach((e) => e.remove());
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onContext, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function showToast(text) {
      toast.textContent = text;
      toast.style.display = 'block';
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => { toast.style.display = 'none'; }, 1800);
    }
    function collectLinks(root) {
      const here = location.href;
      if (globalThis.extractLinks) return [...globalThis.extractLinks(root, here), ...(globalThis.extractInteractiveItems ? globalThis.extractInteractiveItems(root) : [])];
      // 兜底：仅标准 <a href>
      const links = [];
      const seen = new Set();
      let list = root.querySelectorAll('a[href]');
      if (root.tagName === 'A' && root.getAttribute('href')) list = [root, ...list];
      list.forEach((a) => {
        let url;
        try { url = new URL(a.href, location.href).href; } catch (_) { return; }
        if (!/^https?:/i.test(url)) return;
        if (/^(javascript|mailto|tel):/i.test(url)) return;
        if (url === here) return;
        if (seen.has(url)) return;
        seen.add(url);
        const text = (a.textContent || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 200);
        links.push({ url, text: text || url });
      });
      return links;
    }
    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === tip || el === box || el === toast || el === document.body || el === document.documentElement) {
        box.style.display = 'none'; currentEl = null; return;
      }
      currentEl = el;
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
    }
    function onClick(e) {
      if (!currentEl) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const links = collectLinks(currentEl);
      let added = 0;
      links.forEach((l) => { const key = l.kind === 'interactive' ? `interactive:${l.actionId}` : `link:${l.url}`; if (!allSeen.has(key)) { allSeen.add(key); allLinks.push(l); added++; } });
      total += links.length;
      try { chrome.runtime.sendMessage({ type: 'LINKS_PICKED', data: { links } }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      showToast(added ? `已拾取 ${added} 个链接（累计 ${allLinks.length}），可继续点击或按 ESC 完成` : '该区域没有新链接，请点击其他区域');
    }
    function finish() {
      try { chrome.runtime.sendMessage({ type: 'LINKS_PICKER_DONE', data: { links: allLinks } }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      cleanup();
    }
    function onContext(e) { e.preventDefault(); finish(); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(); } }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContext, true);
    document.addEventListener('keydown', onKey, true);
    return { started: true };
  }

  /** 通过 data URL 下载（service worker 中无 Blob/URL） */
  async function downloadText(content, filename) {
    const bytes = new TextEncoder().encode(content);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const url = `data:text/markdown;charset=utf-8;base64,${btoa(bin)}`;
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  }

  async function copyToClipboard(text) {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (t) => { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); },
        args: [text]
      });
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  /* ---------------- content script 注入与通信 ---------------- */
  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return true;
    } catch (_) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });
        await new Promise((r) => setTimeout(r, 120));
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  async function sendToTab(tabId, message, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        if (!(await ensureContentScript(tabId))) throw new Error('无法注入 content script');
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  /* ---------------- 离屏文档：解析+转换 ---------------- */
  async function pingOffscreen() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'PING' });
      return !!(res && res.success && res.ready);
    } catch (_) {
      return false;
    }
  }

  async function ensureOffscreen() {
    if (offscreenReady && (await pingOffscreen())) return;
    try {
      if (chrome.offscreen.hasDocument && !(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['DOM_PARSER'],
          justification: '解析抓取到的 HTML 并转换为 Markdown'
        });
      } else if (!chrome.offscreen.hasDocument) {
        await chrome.offscreen.createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['DOM_PARSER'],
          justification: '解析抓取到的 HTML 并转换为 Markdown'
        });
      }
    } catch (_) { /* 已存在则忽略 */ }

    // 等待离屏脚本就绪（最多约 3 秒）
    for (let i = 0; i < 30; i++) {
      if (await pingOffscreen()) { offscreenReady = true; return; }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('离屏文档未就绪');
  }

  async function convertHtmlViaOffscreen(html, url) {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ type: 'CONVERT_HTML', payload: { html, url } });
    if (!res || !res.success) throw new Error((res && res.error) || '离屏转换失败');
    return res.data; // { markdown, title }
  }

  async function extractHtmlLinksViaOffscreen(html, url) {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ type: 'EXTRACT_HTML_LINKS', payload: { html, url } });
    if (!res || !res.success) throw new Error((res && res.error) || '离屏链接提取失败');
    return res.data.links || [];
  }

  async function fetchHtml(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
    try {
      const res = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /* 等待标签页加载完成（带超时） */
  function waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (complete) => {
        if (done) return; done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(complete);
      };
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') finish(true);
      };
      chrome.tabs.onUpdated.addListener(listener);
      const timer = setTimeout(() => finish(false), timeoutMs || 20000);
      chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finish(true); }).catch(() => finish(false));
    });
  }

  /* 等待 SPA 真正渲染出正文。
   * 关键：不能只看“body 有少量文本就返回”——左侧导航栏本身就几百字，
   * 会导致正文未加载时就转换（把导航栏当正文）。这里轮询 body 文本长度，
   * 直到连续多次不再增长（渲染稳定）或已知正文容器已出现且足够长才返回。 */
  async function renderReady(tabId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 20000);
    let prevLen = -1, stableCount = 0;
    while (Date.now() < deadline) {
      let len = 0, containerReady = false;
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const c = document.querySelector(
              'article, main, [role="main"], .article, .content, #content, .post, .doc, ' +
              '.markdown-body, .doc-content, .article-content, .ark-doc, .doc-detail'
            );
            if (c && (c.textContent || '').replace(/\s+/g, '').length > 500) {
              return { len: (document.body.textContent || '').replace(/\s+/g, '').length, containerReady: true };
            }
            return { len: (document.body.textContent || '').replace(/\s+/g, '').length, containerReady: false };
          }
        });
        const o = r && r[0] && r[0].result;
        if (o) { len = o.len || 0; containerReady = o.containerReady; }
      } catch (_) { /* 标签页可能已关闭 */ }
      if (containerReady) return true;
      // 稳定判定：文本不再明显增长，说明渲染已结束
      if (prevLen >= 0 && Math.abs(len - prevLen) <= Math.max(8, prevLen * 0.01)) stableCount++;
      else stableCount = 0;
      prevLen = len;
      if (len >= 1500 && stableCount >= 2) return true; // 已有可观正文且趋于稳定
      if (stableCount >= 5) return true;               // 连续多次无增长（含短文）视为渲染完毕
      await new Promise((res) => setTimeout(res, 500));
    }
    return false;
  }

  /* 在前台标签页中渲染页面后转换（可捕获 JS 动态内容，与单页转换一致）。
   * 必须用前台标签：Chrome 对后台隐藏标签节流，SPA 正文往往渲染不完，
   * 表现为“首个链接完整、其余只有侧边栏”。前台标签不被节流，转换完整。 */
  async function convertViaTab(url, timeoutMs, returnToTabId) {
    const tab = await chrome.tabs.create({ url, active: true });
    try {
      await waitForTabComplete(tab.id, timeoutMs);
      await renderReady(tab.id, Math.min(timeoutMs || 30000, 20000)); // 等 SPA 渲染出正文并稳定
      if (!(await ensureContentScript(tab.id))) throw new Error('无法注入内容脚本');
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'CONVERT_PAGE' });
      if (!res || !res.success) throw new Error((res && res.error) || '标签页转换失败');
      return { markdown: res.data.markdown, title: res.data.title };
    } finally {
      const t = await chrome.tabs.get(tab.id).catch(() => null);
      const wasActive = !!(t && t.active);
      chrome.tabs.remove(tab.id).catch(() => {});
      // 若用户未中途切走，转换完后把焦点还回批量页
      if (returnToTabId && wasActive) {
        chrome.tabs.update(returnToTabId, { active: true }).catch(() => {});
      }
    }
  }

  /* 转换单个 URL：先用 fetch+离屏（快，适合服务端渲染），内容过短或失败则回退到标签页渲染 */
  async function convertUrl(url, timeoutMs, useOffscreen, returnToTabId) {
    if (useOffscreen) {
      try {
        const html = await fetchHtml(url, timeoutMs);
        const { markdown, title } = await convertHtmlViaOffscreen(html, url);
        // 判定提取是否充分。SPA 空壳页特征：fetch 到的原始 HTML 很大（含框架脚本），
        // 但正文靠 JS 渲染，离屏转换出的 markdown 极小 -> 视为提取失败，回退标签页渲染（可捕获动态内容）。
        // 注意：去掉标签后脚本内容被剥离，会丢失"HTML 很大"这一信号，故用原始 HTML 长度判断。
        const rawLen = html.length;
        const mdLen = (markdown || '').trim().length;
        const likelyShell = rawLen >= 20000 && mdLen < Math.max(200, rawLen * 0.01);
        const sufficient = mdLen >= 80 && !likelyShell;
        if (sufficient) return { markdown, title };
      } catch (_) { /* 回退到标签页渲染 */ }
    }
    return await convertViaTab(url, timeoutMs, returnToTabId);
  }

  async function convertInteractiveItem(item) {
    const openedTab = new Promise((resolve) => {
      let done = false;
      const finish = (tab) => { if (!done) { done = true; clearTimeout(timer); chrome.tabs.onCreated.removeListener(listener); resolve(tab); } };
      const listener = (tab) => { if (tab.openerTabId === item.sourceTabId) finish(tab); };
      chrome.tabs.onCreated.addListener(listener);
      const timer = setTimeout(() => finish(null), 3000);
    });
    const sourceResult = sendToTab(item.sourceTabId, { type: 'CAPTURE_INTERACTIVE_ITEM', payload: { actionId: item.actionId, text: item.text } })
      .catch((error) => ({ success: false, error: error.message || String(error) }));
    const tab = await openedTab;
    if (tab) {
      try {
        await waitForTabComplete(tab.id, 20000);
        await renderReady(tab.id, 15000);
        const res = await sendToTab(tab.id, { type: 'CONVERT_PAGE' });
        if (!res || !res.success) throw new Error((res && res.error) || '新标签页转换失败');
        return res.data;
      } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
    const res = await sourceResult;
    if (!res || !res.success) throw new Error((res && res.error) || '点击后未打开新标签页且源页面未变化');
    return res.data;
  }

  async function expandDirectoryLinks(urls, timeoutMs) {
    const results = [];
    for (const url of urls || []) {
      try {
        const html = await fetchHtml(url, timeoutMs);
        const links = await extractHtmlLinksViaOffscreen(html, url);
        results.push({ url, links, error: null });
      } catch (err) {
        results.push({ url, links: [], error: err.message || String(err) });
      }
    }
    return results;
  }

  /* ---------------- 单次转换结果处理 ---------------- */
  async function handleConversionResult(tab, markdown, source) {
    const settings = await getSettings();
    await chrome.storage.local.set({
      lastConversion: markdown,
      lastConversionSource: source,
      lastConversionUrl: tab.url,
      lastConversionTitle: tab.title
    });
    if (settings.showPreview) {
      await openPreview(markdown, tab.title);
    } else if (settings.autoDownload) {
      await downloadText(markdown, makeFilename(tab.title));
    } else if (settings.autoCopy) {
      await copyToClipboard(markdown);
    } else {
      await openPreview(markdown, tab.title);
    }
  }

  async function openPreview(markdown, title) {
    await chrome.storage.local.set({ previewContent: markdown, previewTitle: title || '', previewTs: Date.now() });
    await chrome.tabs.create({ url: 'preview/preview.html' });
  }

  async function convertPage(tab) {
    if (isRestricted(tab.url)) throw new Error('不支持在此页面转换');
    const res = await sendToTab(tab.id, { type: 'CONVERT_PAGE' });
    if (!res || !res.success) throw new Error((res && res.error) || '转换失败');
    const settings = await getSettings();
    let md = res.data.markdown;
    if (settings.addSourceInfo) md = formatWithSource(md, res.data.title, res.data.url);
    await handleConversionResult(tab, md, 'page');
  }

  async function convertSelection(tab) {
    if (isRestricted(tab.url)) throw new Error('不支持在此页面转换');
    const res = await sendToTab(tab.id, { type: 'CONVERT_SELECTION' });
    if (!res || !res.success) throw new Error((res && res.error) || '转换失败，请确保已选中内容');
    const settings = await getSettings();
    let md = res.data.markdown;
    if (settings.addSourceInfo) md = formatWithSource(md, res.data.title, res.data.url);
    await handleConversionResult(tab, md, 'selection');
  }

  /* ---------------- 批量转换：端口协议 ---------------- */
  // page -> bg: { type:'START', data:{ urls, mode, addSourceInfo, concurrency, timeoutMs } }
  // bg -> page: { type:'PROGRESS', data:{ index, total, url, status, title?, markdown?, error? } }
  // bg -> page: { type:'DONE', data:{ mode, addSourceInfo, results, combinedMarkdown } }
  async function runBatch(port, data) {
    const { items: requestedItems, mode, addSourceInfo, concurrency, timeoutMs } = data;
    const batchTabId = port.sender && port.sender.tab && port.sender.tab.id;
    const items = requestedItems || [];
    const total = items.length;
    const results = new Array(total);
    const queue = items.map((source, index) => ({ source, index }));
    const pool = items.some((item) => item.kind === 'interactive') ? 1 : Math.max(1, Math.min(concurrency || 4, 8));

    // 一次性探测离屏文档是否可用（不可用则全部走标签页渲染）
    let useOffscreen = true;
    try { await ensureOffscreen(); } catch (_) { useOffscreen = false; }

    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        const { source, index } = item;
        const url = source.kind === 'interactive' ? `页面内目录：${source.text}` : source.url;
        safePost(port, { type: 'PROGRESS', data: { index, total, url, status: 'start' } });
        try {
          const converted = source.kind === 'interactive' ? await convertInteractiveItem(source) : await convertUrl(source.url, timeoutMs, useOffscreen, batchTabId);
          const { markdown, title } = converted;
          results[index] = { url: converted.url || source.url, title, markdown, error: null };
          safePost(port, { type: 'PROGRESS', data: { index, total, url: converted.url || source.url, status: 'done', title, markdown } });
        } catch (err) {
          results[index] = { url, title: '', markdown: '', error: err.message || String(err) };
          safePost(port, { type: 'PROGRESS', data: { index, total, url, status: 'error', error: err.message || String(err) } });
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(pool, total) }, () => worker()));
    } catch (e) {
      // worker 内部已捕获，兜底
    }

    let combinedMarkdown = '';
    if (mode === 'combined') {
      combinedMarkdown = results
        .filter((r) => r && r.markdown)
        .map((r) => addSourceInfo ? formatWithSource(r.markdown, r.title, r.url) : r.markdown)
        .join('\n\n---\n\n');
    }

    safePost(port, { type: 'DONE', data: { mode, addSourceInfo: !!addSourceInfo, results, combinedMarkdown } });
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'batch') return;
    port.onMessage.addListener((msg) => {
      if (msg.type === 'START') {
        runBatch(port, msg.data).catch((e) => {
          safePost(port, { type: 'DONE', data: { mode: msg.data.mode, addSourceInfo: !!msg.data.addSourceInfo, results: [], combinedMarkdown: '', fatal: e.message } });
        });
      }
    });
  });

  /* ---------------- 打开批量页 ---------------- */
  async function openBatchPage(tabId) {
    await chrome.tabs.create({ url: `batch/batch.html?tabId=${tabId}` });
  }

  /* 批量"先框选区域再跳转"：在源页面启动链接拾取器，拾取完成后跳转到批量页 */
  async function startBatchPicker(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (isRestricted(tab.url)) throw new Error('不支持在此页面转换');
    pendingBatchTab = tabId;
    await ensureExtractorInjected(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, func: startLinkPickerInPage });
    await chrome.tabs.update(tabId, { active: true });
  }

  /* ---------------- 菜单 ---------------- */
  function createMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'm-page', title: '转换当前页面为 Markdown', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'm-selection', title: '转换选区为 Markdown', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'm-batch', title: '批量转换选区内的链接…', contexts: ['selection'] });
    });
  }
  chrome.runtime.onInstalled.addListener(() => {
    createMenus();
    chrome.storage.local.get(['settings']).then(({ settings }) => { if (!settings) chrome.storage.local.set({ settings: DEFAULT_SETTINGS }); });
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    try {
      if (info.menuItemId === 'm-page') await convertPage(tab);
      else if (info.menuItemId === 'm-selection') await convertSelection(tab);
      else if (info.menuItemId === 'm-batch') await openBatchPage(tab.id);
    } catch (e) { console.error('[bg] menu error', e); }
  });

  /* ---------------- 快捷键 ---------------- */
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      if (command === 'convert-page') await convertPage(tab);
      else if (command === 'convert-selection') await convertSelection(tab);
      else if (command === 'batch-convert-selection') await startBatchPicker(tab.id);
    } catch (e) { console.error('[bg] command error', e); }
  });

  /* ---------------- 来自 popup/preview 的消息 ---------------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'CONVERT_PAGE': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await convertPage(tab);
            sendResponse({ success: true }); break;
          }
          case 'CONVERT_SELECTION': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await convertSelection(tab);
            sendResponse({ success: true }); break;
          }
          case 'START_ELEMENT_PICKER': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (isRestricted(tab.url)) { sendResponse({ success: false, error: '不支持在此页面' }); break; }
            await ensureContentScript(tab.id);
            await chrome.tabs.sendMessage(tab.id, { type: 'START_ELEMENT_PICKER' });
            sendResponse({ success: true }); break;
          }
          case 'START_LINK_PICKER': {
            const tabId = msg.payload && msg.payload.tabId;
            try {
              await ensureExtractorInjected(tabId);
              await chrome.scripting.executeScript({ target: { tabId }, func: startLinkPickerInPage });
              await chrome.tabs.update(tabId, { active: true });
              sendResponse({ success: true });
            } catch (e) {
              sendResponse({ success: false, error: e.message || String(e) });
            }
            break;
          }
          case 'OPEN_BATCH': {
            const tid = msg.payload && msg.payload.tabId;
            if (tid) {
              await openBatchPage(tid);
            } else {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              await openBatchPage(tab.id);
            }
            sendResponse({ success: true }); break;
          }
          case 'START_BATCH_PICKER': {
            const tid = msg.payload && msg.payload.tabId;
            if (!tid) { sendResponse({ success: false, error: '缺少 tabId' }); break; }
            try {
              await startBatchPicker(tid);
              sendResponse({ success: true });
            } catch (e) {
              pendingBatchTab = null;
              sendResponse({ success: false, error: e.message || String(e) });
            }
            break;
          }
          case 'GET_SELECTION_LINKS': {
            const tabId = msg.payload && msg.payload.tabId;
            try {
              await ensureExtractorInjected(tabId);
              const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: collectSelectionLinksInPage
              });
              const data = (results && results[0] && results[0].result) || { links: [], reason: 'no-selection' };
              sendResponse({ success: true, data });
            } catch (e) {
              sendResponse({ success: false, error: e.message || String(e) });
            }
            break;
          }
          case 'EXPAND_DIRECTORY_LINKS': {
            const urls = (msg.payload && msg.payload.urls) || [];
            const timeoutMs = (msg.payload && msg.payload.timeoutMs) || 20000;
            const data = await expandDirectoryLinks(urls, timeoutMs);
            sendResponse({ success: true, data }); break;
          }
          case 'DOWNLOAD_FILE':
            await downloadText(msg.payload.content, msg.payload.filename);
            sendResponse({ success: true }); break;
          case 'COPY_TO_CLIPBOARD':
            await copyToClipboard(msg.payload.text);
            sendResponse({ success: true }); break;
          case 'GET_SETTINGS': {
            const s = await getSettings();
            sendResponse({ success: true, data: { settings: s } }); break;
          }
          case 'SAVE_SETTINGS':
            await chrome.storage.local.set({ settings: msg.payload.settings });
            sendResponse({ success: true }); break;
          case 'LINKS_PICKED':
            // 批量页打开时由页面处理；此处仅确认已收到，避免端口告警
            sendResponse({ success: true });
            return;
          case 'LINKS_PICKER_DONE': {
            // "先选区再跳转"流程：拾取完成后把链接存入临时存储并打开批量页
            if (pendingBatchTab != null) {
              const tid = pendingBatchTab; pendingBatchTab = null;
              const links = (msg.data && msg.data.links) || [];
              try { await chrome.storage.local.set({ ['pickedLinksForTab_' + tid]: links }); } catch (_) {}
              await openBatchPage(tid);
            }
            return;
          }
          case 'FOCUS_TAB':
            if (msg.payload && msg.payload.tabId) {
              chrome.tabs.update(msg.payload.tabId, { active: true }).catch(() => {});
            }
            sendResponse({ success: true });
            return;
          default:
            // 不响应未识别类型（如 PING/CONVERT_HTML 由离屏文档处理）
            return;
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message || String(e) });
      }
    })();
    return true; // 异步响应
  });

  /* ---------------- 元素选择器结果 ---------------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'ELEMENT_PICKED') return false;
    (async () => {
      try {
        const settings = await getSettings();
        let md = msg.data.markdown;
        if (settings.addSourceInfo) md = formatWithSource(md, msg.data.title, msg.data.url);
        await handleConversionResult(sender.tab, md, 'element');
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  });

  console.log('[网页转Markdown] background service worker 已启动');
})();
