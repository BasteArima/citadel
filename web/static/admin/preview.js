import { h, dialog } from './ui.js';
import { draft, save } from './draft.js';

const DEVICES = { 390: 'Телефон', 820: 'Планшет вертикально', 1180: 'Планшет горизонтально', 1440: 'Ноутбук' };
export function previewTools(main, wrap, getNode) {
  const narrow = window.matchMedia('(max-width: 879px)');
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('citadel-admin-view') || '{}') || {}; } catch (e) { /* optional */ }
  if (typeof prefs === 'string') prefs = { mode: prefs };
  let mode = ['edit', 'split', 'preview'].includes(prefs.mode) ? prefs.mode : 'split';
  let width = DEVICES[prefs.width] ? Number(prefs.width) : 0;
  let collapsed = !!prefs.collapsed, timer, ready = false, full = true, navigate = true;
  let mobilePreview = false, mobileTreeOpen = false;
  const controls = h('div', 'ed-column-head ed-preview-controls');
  controls.innerHTML = '<button type="button" class="btn" data-back-form>← К форме</button><select aria-label="Ширина превью"><option value="0">По ширине</option>' + Object.entries(DEVICES).map(([w, label]) => '<option value="' + w + '">' + label + ' · ' + w + '</option>').join('') + '</select><span class="ad-sp"></span><a class="btn" target="_blank" rel="noopener noreferrer" data-student>Как ученик ↗</a><button type="button" class="ad-ib" data-expand aria-label="Только превью" title="Только превью">⛶</button><button type="button" class="ad-ib" data-hide aria-label="Скрыть превью" title="Скрыть превью">×</button>';
  const tree = wrap.querySelector('.ed-tree-controls');
  tree.innerHTML = '<span class="lbl">Дерево</span><button type="button" class="ad-ib" data-tree aria-controls="editor-tree"></button>';
  const treeButton = tree.querySelector('[data-tree]');
  const show = h('button', 'btn ed-show-preview', 'Показать превью'); show.type = 'button';
  const formHead = wrap.querySelector('.ed-form-head'); formHead.append(show);
  const prev = wrap.querySelector('.ed-prev');
  const mobileDialog = h('dialog', 'ed-mobile-preview'); mobileDialog.setAttribute('aria-label', 'Превью курса'); main.append(mobileDialog);
  prev.innerHTML = '<div class="ed-preview-caption ad-small ad-mut"></div><div class="ed-preview-viewport"><iframe title="Черновик · превью курса"></iframe></div>';
  const frame = prev.querySelector('iframe'), viewport = prev.querySelector('.ed-preview-viewport'), caption = prev.firstElementChild;
  prev.prepend(controls);
  const url = () => '/admin/preview/' + encodeURIComponent(draft.id) + '#' + encodeURIComponent(getNode()?.id || '');
  frame.src = url();
  function persist() {
    try { localStorage.setItem('citadel-admin-view', JSON.stringify({ mode, width, collapsed })); } catch (e) { /* optional */ }
  }
  function layout() {
    const displayMode = narrow.matches ? (mobilePreview ? 'preview' : 'edit') : mode;
    const treeCollapsed = narrow.matches ? !mobileTreeOpen : collapsed;
    wrap.dataset.mode = displayMode; wrap.classList.toggle('tree-collapsed', treeCollapsed);
    show.hidden = displayMode !== 'edit';
    controls.querySelector('[data-back-form]').hidden = displayMode !== 'preview';
    treeButton.setAttribute('aria-expanded', String(!treeCollapsed));
    treeButton.textContent = narrow.matches ? 'Дерево курса ' + (treeCollapsed ? '▾' : '▴') : collapsed ? '›' : '‹';
    treeButton.setAttribute('aria-label', treeCollapsed ? 'Показать дерево' : 'Свернуть дерево');
    treeButton.title = treeButton.getAttribute('aria-label');
    const expand = controls.querySelector('[data-expand]');
    expand.setAttribute('aria-label', displayMode === 'preview' ? 'Вернуть форму' : 'Только превью');
    expand.title = displayMode === 'preview' ? 'Вернуть форму' : 'Только превью';
    expand.setAttribute('aria-pressed', String(displayMode === 'preview'));
    controls.querySelector('select').value = width;
    controls.querySelector('[data-student]').href = url(); scale();
  }
  function scale() {
    const deviceWidth = narrow.matches ? 0 : width;
    const actualWidth = deviceWidth || viewport.clientWidth;
    const factor = Math.min(1, viewport.clientWidth / actualWidth);
    if (!factor) return;
    frame.style.width = actualWidth + 'px'; frame.style.height = Math.max(1, viewport.clientHeight / factor) + 'px'; frame.style.transform = 'scale(' + factor + ')';
    frame.style.left = Math.max(0, (viewport.clientWidth - actualWidth * factor) / 2) + 'px';
    caption.textContent = deviceWidth ? DEVICES[deviceWidth] + ' · ' + deviceWidth + ' · ' + Math.round(factor * 100) + '%' : 'По ширине · ' + actualWidth;
  }
  function closeMobilePreview(focus = true) {
    mobilePreview = false;
    if (mobileDialog.open) mobileDialog.close();
    wrap.append(prev); layout();
    if (focus) show.focus({ preventScroll: true });
  }
  const breakpoint = () => { mobileTreeOpen = false; closeMobilePreview(false); };
  function send() {
    if (!ready) return;
    const node = getNode(), message = { type: 'citadel-preview', courseVersion: draft.version, theme: document.documentElement.dataset.theme || 'auto' };
    if (full || !node) message.course = draft.course; else message.node = node;
    if (navigate) message.navigate = node?.id || '';
    frame.contentWindow.postMessage(message, location.origin); full = navigate = false;
  }
  // A trailing update batches keystrokes and structural edits; selection shares this throttle.
  function update(options = {}) {
    full ||= !!options.full; navigate ||= !!options.navigate;
    if (narrow.matches && options.navigate && mobileTreeOpen) { mobileTreeOpen = false; layout(); wrap.querySelector('#nf-title')?.focus({ preventScroll: true }); }
    if (!timer) timer = setTimeout(() => { timer = null; send(); }, 300);
    controls.querySelector('[data-student]').href = url();
  }
  const receive = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== 'citadel-preview-ready') return;
    ready = true; full = navigate = true; update();
  };
  window.addEventListener('message', receive);
  narrow.addEventListener('change', breakpoint);
  const themeObserver = new MutationObserver(() => update()); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const observer = new ResizeObserver(scale); observer.observe(viewport);
  controls.querySelector('[data-expand]').addEventListener('click', () => { mode = mode === 'preview' ? (narrow.matches ? 'edit' : 'split') : 'preview'; layout(); persist(); controls.querySelector('[data-expand]').focus(); });
  controls.querySelector('[data-hide]').addEventListener('click', () => { mode = 'edit'; layout(); persist(); show.focus(); });
  show.addEventListener('click', () => {
    if (narrow.matches) {
      mobilePreview = true; mobileDialog.append(prev); mobileDialog.showModal(); layout();
      controls.querySelector('[data-back-form]').focus();
    } else { mode = 'split'; layout(); persist(); controls.querySelector('select').focus(); }
  });
  controls.querySelector('[data-back-form]').addEventListener('click', () => {
    if (narrow.matches) closeMobilePreview();
    else { mode = 'edit'; layout(); persist(); show.focus(); }
  });
  mobileDialog.addEventListener('cancel', (e) => { e.preventDefault(); closeMobilePreview(); });
  controls.querySelector('select').addEventListener('change', (e) => { width = Number(e.target.value); layout(); persist(); });
  treeButton.addEventListener('click', () => { if (narrow.matches) mobileTreeOpen = !mobileTreeOpen; else { collapsed = !collapsed; persist(); } layout(); });
  const escape = (e) => {
    if (e.key !== 'Escape') return;
    if (narrow.matches && mobileTreeOpen) { e.preventDefault(); mobileTreeOpen = false; layout(); treeButton.focus(); }
    else if (!narrow.matches && mode === 'preview' && !document.querySelector('dialog[open]')) { e.preventDefault(); mode = 'edit'; layout(); persist(); show.focus(); }
  };
  wrap.addEventListener('keydown', escape);
  controls.querySelector('[data-student]').addEventListener('click', (e) => {
    if (!draft.dirty) return;
    e.preventDefault();
    dialog('Открыть превью', '<p>Несохранённые правки в новой вкладке не видны.</p>', [
      { label: 'Отмена' },
      { label: 'Открыть без них', onClick: (close) => { window.open(url(), '_blank', 'noopener,noreferrer'); close(); } },
      { label: 'Сохранить и открыть', primary: true, onClick: async (close, d) => {
        // Open during the click so the browser does not block the tab after awaiting save.
        const tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null;
        d.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        if (await save()) { if (tab) tab.location = url(); close(); }
        else { tab?.close(); d.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
      } }
    ]);
  });
  layout();
  return { update, attachFormHead(head) { formHead.replaceChildren(head, show); layout(); }, destroy() { clearTimeout(timer); observer.disconnect(); themeObserver.disconnect(); window.removeEventListener('message', receive); narrow.removeEventListener('change', breakpoint); wrap.removeEventListener('keydown', escape); if (mobileDialog.open) mobileDialog.close(); mobileDialog.remove(); } };
}
