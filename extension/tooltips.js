/* Shared, delegated tooltips for our icon controls (including dynamic song rows). */
(() => {
  'use strict';
  let target, bubble, timer, lastHidden = 0;
  function hide() {
    clearTimeout(timer);
    if (bubble) {
      const ids = (target?.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== bubble.id);
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
      else target?.removeAttribute('aria-describedby');
      bubble.remove();
      lastHidden = Date.now();
    }
    bubble = target = null;
  }
  function show(element, immediate = false) {
    if (target === element) return;
    hide();
    if (!element || element.disabled) return;
    target = element;
    timer = setTimeout(() => {
      if (!element.isConnected || !element.dataset.sfTooltip) return hide();
      bubble = document.createElement('div');
      bubble.className = 'sf-tooltip';
      bubble.id = 'sf-control-tooltip';
      bubble.setAttribute('role', 'tooltip');
      bubble.textContent = element.dataset.sfTooltip;
      (element.closest('dialog[open]') || document.body).append(bubble);
      const ids = element.getAttribute('aria-describedby');
      element.setAttribute('aria-describedby', [ids, bubble.id].filter(Boolean).join(' '));
      const rect = element.getBoundingClientRect(), size = bubble.getBoundingClientRect();
      bubble.style.left = Math.max(8, Math.min(innerWidth - size.width - 8, rect.left + (rect.width - size.width) / 2)) + 'px';
      bubble.style.top = (rect.top - size.height - 8 >= 8 ? rect.top - size.height - 8 : rect.bottom + 8) + 'px';
    }, immediate || Date.now() - lastHidden < 600 ? 0 : 300);
  }
  const control = node => node instanceof Element ? node.closest('[data-sf-tooltip]') : null;
  document.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') show(control(event.target)); });
  document.addEventListener('pointerout', event => {
    if (control(event.relatedTarget) !== target) hide();
  });
  document.addEventListener('focusin', event => {
    const element = control(event.target);
    if (element?.matches(':focus-visible')) show(element, true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('resize', hide);
})();
