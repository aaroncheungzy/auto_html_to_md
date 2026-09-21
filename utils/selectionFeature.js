(() => {
  const EXCLUDED_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

  function isUnlockEnabled(settings) {
    return !settings || settings.unlockSelection !== false;
  }

  function elementForNode(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function isEligibleSelection(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    if (!(selection.toString() || '').trim()) return false;
    const anchor = elementForNode(selection.anchorNode);
    const focus = elementForNode(selection.focusNode);
    return ![anchor, focus].some((el) => el && el.closest && el.closest(EXCLUDED_SELECTOR));
  }

  function positionFloatingButton(rect, viewportWidth, viewportHeight, buttonWidth, buttonHeight) {
    const margin = 8;
    const left = Math.min(
      Math.max(margin, rect.right - buttonWidth),
      Math.max(margin, viewportWidth - buttonWidth - margin)
    );
    const below = rect.bottom + margin;
    const top = below + buttonHeight <= viewportHeight - margin
      ? below
      : Math.max(margin, rect.top - buttonHeight - margin);
    return { left, top };
  }

  function createUnlockController(doc, win) {
    const styleId = 'auto-html-to-md-selection-unlock';
    const listenerOptions = { capture: true };
    let enabled = false;

    const allowDefault = (event) => {
      if (doc.documentElement && doc.documentElement.hasAttribute &&
          doc.documentElement.hasAttribute('data-auto-html-to-md-picker-active')) return;
      event.stopImmediatePropagation();
    };
    const allowCopyShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || String(event.key || '').toLowerCase() !== 'c') return;
      const selection = win.getSelection && win.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed && (selection.toString() || '').trim()) {
        event.stopImmediatePropagation();
      }
    };
    const listeners = [
      ['selectstart', allowDefault],
      ['copy', allowDefault],
      ['contextmenu', allowDefault],
      ['keydown', allowCopyShortcut]
    ];

    function enable() {
      if (enabled) return;
      enabled = true;
      let style = doc.getElementById(styleId);
      if (!style) {
        style = doc.createElement('style');
        style.id = styleId;
        style.textContent = `
          html, body, body * { -webkit-user-select: text !important; user-select: text !important; }
          input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"] {
            -webkit-user-select: text !important; user-select: text !important;
          }
          button, select, option { -webkit-user-select: auto !important; user-select: auto !important; }
          /* Articulate Storyline：透明无障碍遮罩会截获鼠标，实际可见文字则禁用命中。 */
          #preso .acc-blocker { pointer-events: none !important; }
          #preso .slide-layer svg text,
          #preso .slide-layer svg tspan { pointer-events: auto !important; }
          html[data-auto-html-to-md-picker-active] body,
          html[data-auto-html-to-md-picker-active] body * {
            -webkit-user-select: none !important; user-select: none !important;
          }
        `;
        doc.documentElement.appendChild(style);
      }
      listeners.forEach(([type, handler]) => win.addEventListener(type, handler, listenerOptions));
    }

    function disable() {
      if (!enabled) return;
      enabled = false;
      const style = doc.getElementById(styleId);
      if (style) style.remove();
      listeners.forEach(([type, handler]) => win.removeEventListener(type, handler, listenerOptions));
    }

    return { enable, disable, isEnabled: () => enabled };
  }

  const api = { isUnlockEnabled, isEligibleSelection, positionFloatingButton, createUnlockController };
  if (typeof window !== 'undefined') window.SelectionFeature = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
