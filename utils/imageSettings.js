(() => {
  function read(settings = {}) {
    const download = settings.bundleImages !== false;
    const decorative = settings.keepAllImages === true;
    return { download, decorative, effectiveDecorative: download && decorative };
  }

  // One worker-owned queue serializes writes from every extension page.
  function createUpdater(storage) {
    let pending = Promise.resolve();
    return (patch) => {
      const task = pending.then(async () => {
        const { settings } = await storage.local.get(['settings']);
        await storage.local.set({ settings: { ...settings, ...patch } });
      });
      pending = task.catch(() => {});
      return task;
    };
  }

  async function bind(download, decorative, storage = chrome.storage, onStatus = () => {}, updateSettings = createUpdater(storage)) {
    const render = (settings) => {
      const state = read(settings);
      download.checked = state.download;
      decorative.checked = state.decorative;
      decorative.disabled = !state.download;
      decorative.closest?.('.setting-child')?.classList.toggle('is-disabled', !state.download);
    };
    storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) render(changes.settings.newValue);
    });
    const save = async (key, control) => {
      const checked = control.checked;
      if (key === 'bundleImages') {
        decorative.disabled = !checked;
        decorative.closest?.('.setting-child')?.classList.toggle('is-disabled', !checked);
      }
      try {
        await updateSettings({ [key]: checked });
        onStatus('图片设置已保存');
      } catch (_) {
        try { render((await storage.local.get(['settings'])).settings); } catch (_) {}
        onStatus('保存图片设置失败', true);
      }
    };
    download.addEventListener('change', () => save('bundleImages', download));
    decorative.addEventListener('change', () => save('keepAllImages', decorative));
    try { render((await storage.local.get(['settings'])).settings); }
    catch (_) { render(); onStatus('读取图片设置失败', true); }
  }
  const api = { read, bind, createUpdater };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof module === 'undefined') globalThis.ImageSettings = api;
})();
