/* utils/batchItems.js
 * 批量转换条目的统一身份与去重：普通 URL 与页面内交互动作可并存。
 */
(() => {
  function itemKey(item) {
    if (!item) return '';
    if (item.kind === 'interactive') return item.actionId ? `interactive:${item.actionId}` : '';
    if (!item.url) return '';
    try {
      const url = new URL(item.url);
      url.hash = '';
      return `link:${url.href}`;
    } catch (_) {
      return `link:${item.url}`;
    }
  }

  function mergeBatchItems(existing, incoming) {
    const items = [];
    const seen = new Set();
    function add(item) {
      const key = itemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      items.push(item);
      return true;
    }
    (existing || []).forEach(add);
    let added = 0;
    (incoming || []).forEach((item) => { if (add(item)) added++; });
    return { items, added };
  }

  const api = { itemKey, mergeBatchItems };
  if (typeof window !== 'undefined') window.BatchItems = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
