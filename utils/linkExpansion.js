/* utils/linkExpansion.js
 * 批量页目录展开所需的 URL 规范化、范围判断和链接合并。
 * 同时支持浏览器页面和 Node 原生测试。
 */
(() => {
  function normalizeDocumentUrl(raw) {
    const url = new URL(raw);
    url.hash = '';
    return url.href;
  }

  function directoryUrl(raw) {
    const url = new URL(normalizeDocumentUrl(raw));
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  }

  function isChildDirectoryUrl(candidate, directory) {
    let url;
    let base;
    try {
      url = new URL(normalizeDocumentUrl(candidate));
      base = directoryUrl(directory);
    } catch (_) {
      return false;
    }
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && url.pathname !== base.pathname;
  }

  function mergeExpandedLinks(existing, candidates, directory, maxCount) {
    const limit = Math.max(1, Number(maxCount) || 100);
    const links = [];
    const seen = new Set();
    let added = 0;
    let limitReached = false;

    function add(link, isCandidate) {
      if (!link || !link.url) return;
      let url;
      try { url = normalizeDocumentUrl(link.url); } catch (_) { return; }
      if (seen.has(url)) return;
      if (isCandidate && !isChildDirectoryUrl(url, directory)) return;
      if (links.length >= limit) {
        if (isCandidate) limitReached = true;
        return;
      }
      seen.add(url);
      links.push({ ...link, url });
      if (isCandidate) added++;
    }

    (existing || []).forEach((link) => add(link, false));
    (candidates || []).forEach((link) => add(link, true));
    return { links, added, limitReached };
  }

  const api = { normalizeDocumentUrl, isChildDirectoryUrl, mergeExpandedLinks };
  if (typeof window !== 'undefined') window.LinkExpansion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
