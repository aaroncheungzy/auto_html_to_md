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

  function extractHtmlLinks(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const links = [];
    const attrs = ['href', 'data-href', 'data-url', 'data-link', 'data-to', 'data-route'];
    doc.querySelectorAll('*').forEach((el) => {
      attrs.forEach((attr) => {
        if (attr === 'href' && (el.tagName === 'LINK' || el.tagName === 'BASE')) return;
        const raw = el.getAttribute(attr);
        if (!raw) return;
        let url;
        try { url = new URL(raw, baseUrl).href; } catch (_) { return; }
        if (!/^https?:/i.test(url) || seen.has(url)) return;
        seen.add(url);
        const text = (el.textContent || el.getAttribute('title') || url).trim().replace(/\s+/g, ' ').slice(0, 200);
        links.push({ url, text: text || url });
      });
    });
    return links;
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
    if (msg.type === 'EXTRACT_HTML_LINKS') {
      try {
        const links = extractHtmlLinks(msg.payload.html, msg.payload.url);
        sendResponse({ success: true, data: { links } });
      } catch (err) {
        sendResponse({ success: false, error: err.message || '离屏链接提取失败' });
      }
      return false;
    }
    return false;
  });
})();
