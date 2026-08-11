/* offscreen/offscreen.js
 * 离屏文档脚本：接收 background 传来的 HTML 字符串，解析并转换为 Markdown。
 * 同时响应 PING 以便 background 确认脚本已就绪。
 */
(() => {
  if (window.converter && !window.converter.turndown) {
    window.converter.init();
  }

  async function applyConverterSettings() {
    try {
      const { settings } = await chrome.storage.local.get(['settings']);
      window.converter.keepAllImages = !!(settings && settings.keepAllImages);
    } catch (_) {
      window.converter.keepAllImages = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ success: true, ready: true });
      return false;
    }
    if (msg.type === 'CONVERT_HTML') {
      (async () => {
        try {
          await applyConverterSettings();
          const { markdown, title } = window.converter.convertHTMLString(msg.payload.html, msg.payload.url);
          sendResponse({ success: true, data: { markdown, title } });
        } catch (err) {
          sendResponse({ success: false, error: err.message || '离屏转换失败' });
        }
      })();
      return true;
    }
    return false;
  });
})();
