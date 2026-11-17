import { h } from './ui.js';

// Inline on desktop; a native full-screen dialog is used only on a phone.
export function referenceLayout(page, title) {
  const grid = h('div', 'ad-reference'), left = h('div', 'ad-reference-left');
  [...page.children].forEach((child) => left.append(child));
  const panel = h('dialog', 'ad-reference-detail'); panel.setAttribute('aria-label', title);
  panel.innerHTML = '<div class="ad-reference-head"><button type="button" class="btn" data-back>← К списку</button><span>' + title + '</span></div><div class="ad-reference-body"></div>';
  grid.append(left, panel); page.append(grid); page.classList.add('ad-reference-page');
  const body = panel.querySelector('.ad-reference-body'), back = panel.querySelector('[data-back]'), narrow = matchMedia('(max-width: 879px)');
  let opener;
  const selected = () => left.querySelector('.is-sel') || left.querySelector('input,button');
  function close() { if (narrow.matches && panel.open) { panel.close(); if (opener?.isConnected) opener.focus(); else selected()?.focus(); } }
  function activate(focus = true) {
    if (!narrow.matches) return;
    opener = document.activeElement;
    if (!panel.open) panel.showModal();
    if (focus) back.focus();
  }
  function layout() { if (panel.open) panel.close(); if (!narrow.matches) panel.show(); }
  panel.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); back.addEventListener('click', close);
  const keys = (e) => { if (e.key === 'Escape' && !narrow.matches && panel.contains(document.activeElement)) { e.preventDefault(); selected()?.focus(); } };
  panel.addEventListener('keydown', keys); narrow.addEventListener('change', layout); layout();
  return { panel, body, header: panel.querySelector('.ad-reference-head'), activate, close, destroy() { narrow.removeEventListener('change', layout); if (panel.open) panel.close(); } };
}

export function listKeys(list, select) {
  list.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const buttons = [...list.querySelectorAll('[data-index], [data-key]')].filter((button) => !button.closest('details:not([open])'));
    const at = buttons.indexOf(document.activeElement); if (!buttons.length) return;
    e.preventDefault();
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus(); select(next); // Desktop selection keeps focus in the list.
  });
}
