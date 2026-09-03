/* content/content.js
 * 页面内脚本：执行转换、采集选区内链接、元素选择器、剪贴板、提示。
 */
(() => {
  const MSG = {
    PING: 'PING',
    CONVERT_PAGE: 'CONVERT_PAGE',
    CONVERT_SELECTION: 'CONVERT_SELECTION',
    GET_SELECTION_LINKS: 'GET_SELECTION_LINKS',
    CAPTURE_INTERACTIVE_ITEM: 'CAPTURE_INTERACTIVE_ITEM',
    START_ELEMENT_PICKER: 'START_ELEMENT_PICKER',
    STOP_ELEMENT_PICKER: 'STOP_ELEMENT_PICKER'
  };

  // 初始化转换器
  if (window.converter && !window.converter.turndown) {
    window.converter.init();
  }

  /* ---------- 提示 toast ---------- */
  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.textContent = message;
    const bg = isError ? '#ef4444' : '#10b981';
    el.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      background: ${bg}; color: #fff; padding: 12px 20px; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,.15); font: 14px system-ui, sans-serif;
      pointer-events: none; max-width: 360px;`;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s'; el.style.opacity = '0';
      setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 300);
    }, isError ? 3000 : 2000);
  }

  /* ---------- 剪贴板复制 ---------- */
  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); return; }
      catch (_) { /* 降级 */ }
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;opacity:0;';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); }
    catch (_) { toast('复制失败，请手动复制', true); }
    document.body.removeChild(ta);
  }

  /* ---------- 采集选区内的文档链接（增强版） ---------- */
  function getSelectionLinks() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { links: [], reason: 'no-selection' };
    }
    const container = document.createElement('div');
    container.appendChild(sel.getRangeAt(0).cloneContents());

    const here = location.href;
    const seen = new Set();
    const links = [];
    const URL_TEXT_RE = /https?:\/\/[^\s"'<>`\)\]]+/i;
    const isHttp = (u) => /^https?:/i.test(u);

    function push(raw, text) {
      if (!raw) return;
      let abs;
      try { abs = new URL(raw, location.href).href; } catch (_) { return; }
      if (!isHttp(abs)) return;
      if (/^(javascript|mailto|tel):/i.test(abs)) return;
      if (abs === here) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      const t = (text || '').toString().trim().replace(/\s+/g, ' ').slice(0, 200);
      links.push({ url: abs, text: t || abs });
    }

    const elSet = new Set();
    container.querySelectorAll('*').forEach((d) => elSet.add(d));
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

    return { links, reason: links.length ? 'ok' : 'no-links' };
  }

  async function captureInteractiveItem(payload) {
    const id = payload && payload.actionId;
    const el = id && document.querySelector(`[data-auto-html-to-md-action-id="${CSS.escape(id)}"]`);
    if (!el) throw new Error('页面内目录项已失效，请重新拾取');
    const before = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 20000);
    el.click();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await applyConverterSettings();
    const after = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 20000);
    if (before === after) return { sourceChanged: false };
    return { sourceChanged: true, markdown: window.converter.convertPage(), title: payload.text || document.title, url: location.href };
  }

  /* ---------- 元素选择器 ---------- */
  const picker = {
    active: false,
    highlight: null,
    overlay: null,
    tip: null,
    start() {
      if (this.active) return;
      this.active = true;
      document.body.style.cursor = 'crosshair';
      document.body.style.userSelect = 'none';
      this.overlay = document.createElement('div');
      this.overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.08);pointer-events:none;z-index:2147483646;';
      document.body.appendChild(this.overlay);
      document.addEventListener('mousemove', this.onMove, true);
      document.addEventListener('click', this.onClick, true);
      document.addEventListener('contextmenu', this.onContext, true);
      document.addEventListener('keydown', this.onKey, true);
      toast('元素选择模式：点击选中元素，右键/ESC 取消');
    },
    stop() {
      if (!this.active) return;
      this.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this._clearHighlight();
      if (this.overlay) { this.overlay.remove(); this.overlay = null; }
      if (this.tip) { this.tip.remove(); this.tip = null; }
      document.removeEventListener('mousemove', this.onMove, true);
      document.removeEventListener('click', this.onClick, true);
      document.removeEventListener('contextmenu', this.onContext, true);
      document.removeEventListener('keydown', this.onKey, true);
    },
    _highlight(el) {
      this._clearHighlight();
      if (!el) return;
      this.highlight = el;
      el._orig = {
        outline: el.style.outline, outlineOffset: el.style.outlineOffset,
        boxShadow: el.style.boxShadow
      };
      el.style.outline = '3px solid #3b82f6';
      el.style.outlineOffset = '-3px';
      el.style.boxShadow = '0 0 0 4px rgba(59,130,246,.3)';
    },
    _clearHighlight() {
      if (this.highlight && this.highlight._orig) {
        const o = this.highlight._orig;
        this.highlight.style.outline = o.outline;
        this.highlight.style.outlineOffset = o.outlineOffset;
        this.highlight.style.boxShadow = o.boxShadow;
        delete this.highlight._orig;
      }
      this.highlight = null;
    },
    onMove(e) {
      if (!picker.active) return;
      const t = e.target;
      if (t === picker.tip || t === picker.overlay || t === document.body || t === document.documentElement) {
        picker._clearHighlight(); return;
      }
      picker._highlight(t);
    },
    onClick(e) {
      if (!picker.active) return;
      e.preventDefault(); e.stopPropagation();
      const t = e.target;
      if (t === picker.tip || t === picker.overlay) return;
      try {
        const md = window.converter.convertElement(t);
        chrome.runtime.sendMessage({
          type: 'ELEMENT_PICKED',
          data: { markdown: md, title: document.title, url: location.href }
        });
        toast('已提取元素内容');
      } catch (err) { toast('转换失败：' + err.message, true); }
      picker.stop();
    },
    onContext(e) { if (picker.active) { e.preventDefault(); picker.stop(); } },
    onKey(e) { if (picker.active && e.key === 'Escape') { e.preventDefault(); picker.stop(); } }
  };
  picker.onMove = picker.onMove.bind(picker);
  picker.onClick = picker.onClick.bind(picker);
  picker.onContext = picker.onContext.bind(picker);
  picker.onKey = picker.onKey.bind(picker);

  /* ---------- 应用设置 ---------- */
  async function applyConverterSettings() {
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      window.converter.keepAllImages = !!(settings && settings.keepAllImages);
    } catch (_) {
      window.converter.keepAllImages = false;
    }
  }

  /* ---------- 消息处理 ---------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case MSG.PING:
            sendResponse({ success: true }); break;

          case MSG.GET_SELECTION_LINKS:
            sendResponse({ success: true, data: getSelectionLinks() }); break;

          case MSG.CAPTURE_INTERACTIVE_ITEM:
            sendResponse({ success: true, data: await captureInteractiveItem(msg.payload) }); break;

          case MSG.CONVERT_PAGE: {
            await applyConverterSettings();
            const md = window.converter.convertPage();
            sendResponse({ success: true, data: { markdown: md, title: document.title, url: location.href } });
            break;
          }
          case MSG.CONVERT_SELECTION: {
            await applyConverterSettings();
            const md = window.converter.convertSelection();
            sendResponse({ success: true, data: { markdown: md, title: document.title, url: location.href } });
            break;
          }
          case MSG.START_ELEMENT_PICKER:
            await applyConverterSettings();
            picker.start(); sendResponse({ success: true }); break;

          case MSG.STOP_ELEMENT_PICKER:
            picker.stop(); sendResponse({ success: true }); break;

          default:
            sendResponse({ success: false, error: '未知的消息类型' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message || '处理失败' });
      }
    })();
    return true; // 异步响应
  });

  console.log('[网页转Markdown] content script 已加载');
})();
