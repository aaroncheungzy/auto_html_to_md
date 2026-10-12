/* Accessible, viewport-clamped explanations. Help buttons are outside labels
 * so opening help never changes the associated checkbox or radio. */
(() => {
  const tooltip = document.createElement('div');
  tooltip.id = 'setting-help-tooltip';
  tooltip.className = 'setting-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let active;
  const hide = () => {
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  };
  const position = () => {
    if (!active || tooltip.hidden) return;
    const rect = active.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - box.width, innerWidth - box.width - 8));
    const below = rect.bottom + 8;
    const top = below + box.height <= innerHeight - 8 ? below : Math.max(8, rect.top - box.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const show = (button, text) => {
    hide();
    active = button;
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.textContent = text;
    // Measure at a safe fixed origin, not at the body's static end position.
    // Otherwise the action popup may grow before we position the tooltip.
    tooltip.style.left = '8px';
    tooltip.style.top = '8px';
    tooltip.hidden = false;
    position();
  };
  document.querySelectorAll('[data-help]').forEach((element) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'setting-help';
    button.setAttribute('aria-label', `${element.textContent.trim()}：说明`);
    button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M7.5 7a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M10 14h.01"/></svg>';
    if (element.tagName === 'LABEL' || element.tagName === 'BUTTON') {
      const row = document.createElement('div');
      row.className = element.tagName === 'BUTTON' ? 'action-help-group' : 'setting-row';
      element.before(row);
      row.append(element, button);
    } else {
      element.appendChild(button);
    }
    button.addEventListener('mouseenter', () => show(button, element.dataset.help));
    button.addEventListener('mouseleave', () => { if (document.activeElement !== button) hide(); });
    button.addEventListener('focus', () => show(button, element.dataset.help));
    button.addEventListener('blur', hide);
    button.addEventListener('click', () => show(button, element.dataset.help));
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', position);
})();
