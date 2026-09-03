(() => {
  function isCompatibilityFallback(text) {
    return /兼容模式|旧版\s*IE|极速模式浏览器|Chrome\s*\|\s*Firefox\s*\|\s*Edge/i.test(String(text || ''));
  }
  const api = { isCompatibilityFallback };
  if (typeof globalThis !== 'undefined') globalThis.HtmlQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
