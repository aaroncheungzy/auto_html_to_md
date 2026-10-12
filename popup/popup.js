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

  const themeButtons = window.AppTheme.PRESETS.map(([color, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-swatch';
    button.style.setProperty('--swatch', color);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', () => saveTheme(color));
    $('theme-presets').appendChild(button);
    return { button, color };
  });
  window.AppTheme.subscribe((color, mode) => {
    $('theme-custom').value = color;
    $('theme-value').textContent = color.toUpperCase();
    themeButtons.forEach((item) => item.button.setAttribute('aria-pressed', String(item.color === color)));
    document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
    try { await window.AppTheme.saveMode(button.dataset.mode); setStatus('背景模式已保存', 'status-ok'); }
    catch (_) { setStatus('保存背景模式失败', 'status-err'); }
  }));
  async function saveTheme(color) {
    try { await window.AppTheme.save(color); setStatus('主题色已保存', 'status-ok'); }
    catch (_) { setStatus('保存主题色失败', 'status-err'); }
  }
  $('theme-custom').addEventListener('input', (event) => window.AppTheme.apply(document.documentElement, event.target.value));
  $('theme-custom').addEventListener('change', (event) => saveTheme(event.target.value));

  document.addEventListener('DOMContentLoaded', async () => {
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    const floating = $('selection-floating');
    const { settings: initialSettings } = await chrome.storage.local.get(['settings']);
    floating.checked = !initialSettings || initialSettings.selectionFloating !== false;
    floating.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get(['settings']);
        await chrome.storage.local.set({ settings: { ...settings, selectionFloating: floating.checked } });
        setStatus(floating.checked ? '选区浮窗已开启' : '选区浮窗已关闭', 'status-ok');
      } catch (_) { setStatus('保存浮窗设置失败', 'status-err'); }
    });
    // 初始化全局网页解锁开关（缺失时默认开启）
    const unlock = $('unlock-selection');
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      unlock.checked = !settings || settings.unlockSelection !== false;
    } catch (_) { unlock.checked = true; }
    unlock.addEventListener('change', async () => {
      try {
        const { settings } = await chrome.storage.local.get(['settings']);
        await chrome.storage.local.set({ settings: { ...settings, unlockSelection: unlock.checked } });
        setStatus(unlock.checked ? '网页解锁已开启' : '网页解锁已关闭', 'status-ok');
      } catch (_) { setStatus('保存解锁设置失败', 'status-err'); }
    });

    await window.ImageSettings.bind($('bundle-images'), $('keep-images'), chrome.storage,
      (message, failed) => setStatus(message, failed ? 'status-err' : 'status-ok'),
      async (patch) => {
        const result = await chrome.runtime.sendMessage({ type: 'UPDATE_IMAGE_SETTINGS', payload: patch });
        if (!result?.success) throw new Error(result?.error || '保存失败');
      });
    setStatus('就绪', 'status-ready');
  });
})();
