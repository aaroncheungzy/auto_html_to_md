/* popup/popup.js */
(() => {
  const $ = (id) => document.getElementById(id);
  const setStatus = (text, cls) => {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + (cls || 'status-ready');
  };

  function isRestricted(url) {
    return ['chrome://', 'chrome-extension://', 'edge://', 'about:'].some((p) => url.startsWith(p));
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function send(type, payload = {}) {
    try {
      setStatus('处理中…', 'status-busy');
      const res = await chrome.runtime.sendMessage({ type, payload });
      if (res && res.success) {
        setStatus('完成', 'status-ok');
        setTimeout(() => window.close(), 400);
      } else {
        setStatus((res && res.error) || '失败', 'status-err');
      }
      return res;
    } catch (e) {
      setStatus(e.message || '错误', 'status-err');
    }
  }

  $('btn-page').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (isRestricted(tab.url)) { setStatus('不支持此页面', 'status-err'); return; }
    await send('CONVERT_PAGE', { tabId: tab.id });
  });

  $('btn-selection').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (isRestricted(tab.url)) { setStatus('不支持此页面', 'status-err'); return; }
    setStatus('在页面上点击要转换的元素…', 'status-busy');
    await send('START_ELEMENT_PICKER', { tabId: tab.id });
    setTimeout(() => window.close(), 300);
  });

  $('btn-batch').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (isRestricted(tab.url)) { setStatus('不支持此页面', 'status-err'); return; }
    setStatus('请在页面上框选区域，点完按 ESC…', 'status-busy');
    await chrome.runtime.sendMessage({ type: 'START_BATCH_PICKER', payload: { tabId: tab.id } });
    setTimeout(() => window.close(), 300);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    // 初始化"打包图片到本地"开关
    const cb = $('bundle-images');
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
    setStatus('就绪', 'status-ready');
  });
})();
