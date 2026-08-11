/* batch/batch.js
 * 批量转换页面：读取选区链接（或框选区域拾取） -> 抓取并转换 -> 分别下载 / 合并下载。
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));

  let links = [];          // [{url, text}]
  let results = [];        // [{url, title, markdown, error}]
  let port = null;
  let myTabId = null;
  let imgCache = new Map(); // 批量内跨页面图片去重：url -> 本地文件名

  /* ---------- 工具 ---------- */
  function sanitizeTitle(title) {
    let t = (title || '未命名').replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
    t = t.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return t.slice(0, 80) || '未命名';
  }
  function timestampStr() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function withSource(md, title, url) {
    return `# ${title || '未命名'}\n\n> 来源：${url}\n\n${md}`;
  }
  function downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      () => setTimeout(() => URL.revokeObjectURL(url), 60000)
    );
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename, conflictAction: 'uniquify', saveAs: false },
      () => setTimeout(() => URL.revokeObjectURL(url), 60000)
    );
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  function setPickerStatus(text) {
    const ps = $('picker-status');
    ps.hidden = !text;
    if (text) ps.textContent = text;
  }

  /* ---------- 加载选区链接 ---------- */
  async function loadLinks() {
    const list = $('link-list');
    list.innerHTML = '';
    hide($('empty-state'));
    setPickerStatus('');
    $('btn-start').disabled = true;

    if (!tabId) {
      $('empty-text').textContent = '未提供页面标识，请从扩展弹窗或右键菜单进入。';
      show($('empty-state'));
      return;
    }

    // 优先使用"先框选区域"流程带来的链接（由后台在拾取完成后写入）
    try {
      const key = 'pickedLinksForTab_' + tabId;
      const stored = await chrome.storage.local.get([key]);
      const picked = stored[key];
      if (Array.isArray(picked)) {
        await chrome.storage.local.remove([key]).catch(() => {});
        if (picked.length) {
          links = picked;
          renderLinks();
          $('btn-start').disabled = false;
          setPickerStatus('已通过框选区域载入 ' + picked.length + ' 个链接，可继续编辑或开始转换。');
          return;
        }
      }
    } catch (_) {}

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'GET_SELECTION_LINKS', payload: { tabId } });
    } catch (e) {
      $('empty-text').textContent = '无法连接后台：' + e.message;
      show($('empty-state'));
      return;
    }

    if (!res || !res.success) {
      $('empty-text').textContent = '获取链接失败：' + (res && res.error ? res.error : '未知错误');
      show($('empty-state'));
      return;
    }

    const data = res.data || {};
    if (data.reason === 'no-selection') {
      $('empty-text').textContent = '当前页面没有选区。可先在页面上选中区域后点“重新读取选区”，或直接用下方“框选区域拾取”。';
      show($('empty-state'));
      return;
    }
    links = data.links || [];
    if (!links.length) {
      $('empty-text').textContent = '选区内没有找到可转换的链接。可改用下方“框选区域拾取”。';
      show($('empty-state'));
      return;
    }

    renderLinks();
    $('btn-start').disabled = false;
  }

  function renderLinks() {
    const list = $('link-list');
    list.innerHTML = '';
    links.forEach((link, i) => {
      const row = document.createElement('label');
      row.className = 'link-row';
      row.innerHTML = `
        <input type="checkbox" class="link-check" data-index="${i}" checked />
        <span class="link-text">${escapeHtml(link.text)}</span>
        <span class="link-url" title="${escapeHtml(link.url)}">${escapeHtml(link.url)}</span>`;
      list.appendChild(row);
    });
    syncSelectAll();
  }

  function mergeLinks(newLinks) {
    const seen = new Set(links.map((l) => l.url));
    let added = 0;
    (newLinks || []).forEach((l) => {
      if (!seen.has(l.url)) { seen.add(l.url); links.push(l); added++; }
    });
    if (links.length) {
      hide($('empty-state'));
      renderLinks();
      $('btn-start').disabled = false;
    }
    return added;
  }

  function getSelectedLinks() {
    const checks = document.querySelectorAll('.link-check');
    const out = [];
    checks.forEach((c, i) => { if (c.checked) out.push(links[i]); });
    return out;
  }

  function syncSelectAll() {
    const checks = document.querySelectorAll('.link-check');
    const all = $('select-all');
    if (!checks.length) { all.checked = false; all.indeterminate = false; return; }
    const checkedCount = Array.from(checks).filter((c) => c.checked).length;
    all.checked = checkedCount === checks.length;
    all.indeterminate = checkedCount > 0 && checkedCount < checks.length;
  }

  /* ---------- 框选区域拾取 ---------- */
  async function startPicker() {
    if (!tabId) { alert('缺少源页面标识，无法启动拾取'); return; }
    setPickerStatus('正在启动拾取…');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'START_LINK_PICKER', payload: { tabId } });
      if (!res || !res.success) {
        setPickerStatus('启动拾取失败：' + (res && res.error ? res.error : '未知错误'));
      } else {
        setPickerStatus('已切换到源页面，请移动鼠标并点击要拾取的区域（可连续点击多个），完成后按 ESC 或右键。');
      }
    } catch (e) {
      setPickerStatus('启动拾取失败：' + e.message);
    }
  }

  // 接收来自页面拾取器的消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'LINKS_PICKED') {
      const added = mergeLinks(msg.data && msg.data.links);
      setPickerStatus(`已拾取 ${added} 个新链接，当前共 ${links.length} 个。可继续在源页面点击，或按 ESC 完成。`);
      sendResponse({ success: true });
      return true;
    }
    if (msg.type === 'LINKS_PICKER_DONE') {
      setPickerStatus(`拾取完成，当前共 ${links.length} 个链接。`);
      if (myTabId) {
        chrome.runtime.sendMessage({ type: 'FOCUS_TAB', payload: { tabId: myTabId } }).catch(() => {});
      }
      sendResponse({ success: true });
      return true;
    }
    return false;
  });

  /* ---------- 开始批量 ---------- */
  function start() {
    const selected = getSelectedLinks();
    if (!selected.length) { alert('请至少选择一个链接，或用“框选区域拾取”添加链接'); return; }
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const addSourceInfo = $('add-source').checked;
    const autoDownload = $('auto-download').checked;

    results = new Array(selected.length).fill(null);
    $('btn-start').disabled = true;
    show($('step-progress'));
    hide($('step-results'));
    renderStatusRows(selected, mode);
    setProgress(0, selected.length);

    port = chrome.runtime.connect({ name: 'batch' });
    port.onMessage.addListener((msg) => onPortMessage(msg, selected, mode, addSourceInfo, autoDownload));
    port.onDisconnect.addListener(() => { /* 端口断开兜底 */ });
    port.postMessage({
      type: 'START',
      data: { urls: selected.map((l) => l.url), mode, addSourceInfo, concurrency: 1, timeoutMs: 20000 }
    });
  }

  function renderStatusRows(selected, mode) {
    const wrap = $('status-list');
    wrap.innerHTML = '';
    selected.forEach((link, i) => {
      const row = document.createElement('div');
      row.className = 'status-row';
      row.id = `status-${i}`;
      row.innerHTML = `
        <span class="st-icon st-pending">○</span>
        <span class="st-text">${escapeHtml(link.text || link.url)}</span>
        <span class="st-state">等待中</span>`;
      wrap.appendChild(row);
    });
  }

  function setRowState(index, state, extra) {
    const row = $(`status-${index}`);
    if (!row) return;
    const icon = row.querySelector('.st-icon');
    const stateEl = row.querySelector('.st-state');
    icon.className = 'st-icon st-' + state;
    const map = { pending: ['○', '等待中'], start: ['◐', '转换中…'], done: ['●', '完成'], error: ['✕', '失败'] };
    const [ic, label] = map[state] || ['○', state];
    icon.textContent = ic;
    stateEl.textContent = state === 'error' ? `失败：${extra || ''}` : label;
  }

  function setProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('progress-fill').style.width = pct + '%';
    $('progress-text').textContent = `${done} / ${total}`;
  }

  function onPortMessage(msg, selected, mode, addSourceInfo, autoDownload) {
    if (msg.type === 'PROGRESS') {
      const { index, total, url, status, title, markdown, error } = msg.data;
      if (status === 'start') setRowState(index, 'start');
      else if (status === 'done') {
        results[index] = { url, title, markdown, error: null };
        setRowState(index, 'done');
        setProgress(results.filter(Boolean).length, total);
      } else if (status === 'error') {
        results[index] = { url, title: '', markdown: '', error };
        setRowState(index, 'error', error);
        setProgress(results.filter(Boolean).length, total);
      }
    } else if (msg.type === 'DONE') {
      finish(msg.data, selected, mode, addSourceInfo, autoDownload);
    }
  }

  function finish(data, selected, mode, addSourceInfo, autoDownload) {
    const ok = (data.results || []).filter((r) => r && r.markdown).length;
    const fail = (data.results || []).filter((r) => r && r.error).length;
    const total = (data.results || []).length;

    show($('step-results'));
    $('result-summary').innerHTML =
      `共 <b>${total}</b> 个，成功 <b class="ok">${ok}</b>，失败 <b class="err">${fail}</b>。` +
      (data.fatal ? `<br><span class="err">致命错误：${escapeHtml(data.fatal)}</span>` : '');

    const actions = $('result-actions');
    actions.innerHTML = '';

    if (mode === 'combined') {
      const combined = data.combinedMarkdown || '';
      $('combined-raw').textContent = combined;
      show($('combined-preview'));
      switchTab('raw');

      const ts = timestampStr();
      const baseName = `auto_html_to_md/合并文档_${ts}`;

      const btnDl = document.createElement('button');
      btnDl.className = 'btn btn-primary';
      btnDl.innerHTML = '<span class="icon">⬇</span><span class="label">下载压缩包 (ZIP)</span>';
      btnDl.onclick = async () => {
        if (bundleEnabled() && window.JSZip) {
          const zip = await window.ImageBundle.bundleToZip({ pages: [{ mdPath: '合并文档.md', markdown: combined }], baseName });
          downloadBlob(zip.blob, zip.filename);
        } else {
          downloadText(combined, `${baseName}.md`);
        }
      };
      actions.appendChild(btnDl);

      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn';
      btnCopy.textContent = '复制内容';
      btnCopy.onclick = () => navigator.clipboard.writeText(combined).then(() => btnCopy.textContent = '已复制！');
      actions.appendChild(btnCopy);

      if (autoDownload && combined) {
        (async () => {
          if (bundleEnabled() && window.JSZip) {
            const zip = await window.ImageBundle.bundleToZip({ pages: [{ mdPath: '合并文档.md', markdown: combined }], baseName });
            downloadBlob(zip.blob, zip.filename);
          } else {
            downloadText(combined, `${baseName}.md`);
          }
        })();
      }
    } else {
      hide($('combined-preview'));
      const ts = timestampStr();
      const baseName = `auto_html_to_md/批量文档_${ts}`;

      const btnDlAll = document.createElement('button');
      btnDlAll.className = 'btn btn-primary';
      btnDlAll.innerHTML = '<span class="icon">⬇</span><span class="label">下载压缩包 (ZIP)</span>';
      btnDlAll.onclick = async () => {
        if (bundleEnabled() && window.JSZip) {
          const pages = (data.results || []).filter((r) => r && r.markdown)
            .map((r, i) => ({ mdPath: `page_${i + 1}_${sanitizeTitle(r.title)}/index.md`,
              markdown: addSourceInfo ? withSource(r.markdown, r.title, r.url) : r.markdown }));
          const zip = await window.ImageBundle.bundleToZip({ pages, baseName, imgCache });
          downloadBlob(zip.blob, zip.filename);
        } else {
          downloadAll(data.results, addSourceInfo);
        }
      };
      actions.appendChild(btnDlAll);

      const btnCopyAll = document.createElement('button');
      btnCopyAll.className = 'btn';
      btnCopyAll.textContent = '复制合并内容';
      btnCopyAll.onclick = () => {
        const combined = data.results.filter((r) => r && r.markdown)
          .map((r) => addSourceInfo ? withSource(r.markdown, r.title, r.url) : r.markdown)
          .join('\n\n---\n\n');
        navigator.clipboard.writeText(combined).then(() => btnCopyAll.textContent = '已复制！');
      };
      actions.appendChild(btnCopyAll);

      if (autoDownload) {
        (async () => {
          if (bundleEnabled() && window.JSZip) {
            const pages = (data.results || []).filter((r) => r && r.markdown)
              .map((r, i) => ({ mdPath: `page_${i + 1}_${sanitizeTitle(r.title)}/index.md`,
                markdown: addSourceInfo ? withSource(r.markdown, r.title, r.url) : r.markdown }));
            const zip = await window.ImageBundle.bundleToZip({ pages, baseName, imgCache });
            downloadBlob(zip.blob, zip.filename);
          } else {
            downloadAll(data.results, addSourceInfo);
          }
        })();
      }
    }

    $('btn-start').disabled = false;
    $('btn-start').querySelector('.label').textContent = '重新转换';
  }

  function bundleEnabled() {
    const cb = $('bundle-images');
    return cb ? cb.checked : true;
  }

  function downloadAll(results, addSourceInfo) {
    let i = 0;
    (results || []).forEach((r) => {
      if (r && r.markdown) {
        const content = addSourceInfo ? withSource(r.markdown, r.title, r.url) : r.markdown;
        const folder = `auto_html_to_md/${sanitizeTitle(r.title)}`;
        const name = sanitizeTitle(r.title);
        const delay = i * 250;
        setTimeout(() => downloadWithBundle(content, folder, name), delay);
        i++;
      }
    });
  }

  /* ---------- 合并预览标签 ---------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    const raw = $('combined-raw');
    const rendered = $('combined-rendered');
    if (name === 'raw') { show(raw); hide(rendered); }
    else {
      hide(raw); show(rendered);
      try { rendered.innerHTML = marked.parse($('combined-raw').textContent || ''); }
      catch (e) { rendered.textContent = '渲染失败：' + e.message; }
    }
  }

  /* ---------- 事件绑定 ---------- */
  $('btn-start').addEventListener('click', start);
  $('btn-refresh').addEventListener('click', loadLinks);
  $('btn-pick').addEventListener('click', startPicker);
  $('btn-pick-empty').addEventListener('click', startPicker);
  $('select-all').addEventListener('change', () => {
    document.querySelectorAll('.link-check').forEach((c) => (c.checked = $('select-all').checked));
  });
  $('link-list').addEventListener('change', (e) => {
    if (e.target.classList.contains('link-check')) syncSelectAll();
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  /* ---------- 保留图片 / 打包图片 开关（持久化到 settings） ---------- */
  async function initKeepImagesCheckbox() {
    const cb = $('keep-images');
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      cb.checked = !!(settings && settings.keepAllImages);
    } catch (_) { cb.checked = false; }
    cb.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get(['settings']);
        await chrome.storage.local.set({ settings: { ...settings, keepAllImages: cb.checked } });
      } catch (_) {}
    });
  }

  async function initBundleCheckbox() {
    const cb = $('bundle-images');
    if (!cb) return;
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      cb.checked = settings && settings.bundleImages !== false; // 默认开
    } catch (_) { cb.checked = true; }
    cb.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get(['settings']);
        await chrome.storage.local.set({ settings: { ...settings, bundleImages: cb.checked } });
      } catch (_) {}
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try { const t = await chrome.tabs.getCurrent(); if (t) myTabId = t.id; } catch (_) {}
    initKeepImagesCheckbox();
    initBundleCheckbox();
    await loadLinks();
  });
})();
