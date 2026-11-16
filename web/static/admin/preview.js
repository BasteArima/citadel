import { h, dialog } from './ui.js';
import { draft, save } from './draft.js';

const DEVICES = { 390: 'Телефон', 820: 'Планшет', 1280: 'ПК' };
export function previewTools(main, wrap, getNode) {
  const narrow = window.matchMedia('(max-width: 899px)');
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('citadel-admin-view') || '{}') || {}; } catch (e) { /* optional */ }
  let mode = ['edit', 'split', 'preview'].includes(prefs.mode) ? prefs.mode : 'split';
  let width = DEVICES[prefs.width] ? Number(prefs.width) : 1280;
  let collapsed = !!prefs.collapsed, timer, ready = false, full = true, navigate = true;
  const controls = h('div', 'ed-viewbar');
  controls.innerHTML = '<div class="ad-row"><button type="button" class="btn" data-tree aria-controls="editor-tree">Дерево</button><div class="ed-modes" role="group" aria-label="Вид редактора">' + [['edit', 'Правка'], ['split', 'Рядом'], ['preview', 'Превью']].map(([key, title]) => '<button type="button" class="btn" data-mode="' + key + '">' + title + '</button>').join('') + '</div></div><div class="ad-row"><label class="ed-device">Превью как <select aria-label="Ширина превью">' + Object.entries(DEVICES).map(([w, label]) => '<option value="' + w + '">' + label + ' · ' + w + '</option>').join('') + '</select></label><a class="btn" target="_blank" rel="noopener noreferrer" data-student>Как ученик ↗</a></div>';
  main.insertBefore(controls, wrap);
  const prev = wrap.querySelector('.ed-prev');
  prev.innerHTML = '<div class="ed-preview-caption ad-small ad-mut"></div><div class="ed-preview-viewport"><iframe title="Черновик · превью курса"></iframe></div>';
  const frame = prev.querySelector('iframe'), viewport = prev.querySelector('.ed-preview-viewport'), caption = prev.firstElementChild;
  const url = () => '/admin/preview/' + encodeURIComponent(draft.id) + '#' + encodeURIComponent(getNode()?.id || '');
  frame.src = url();
  function persist() {
    try { localStorage.setItem('citadel-admin-view', JSON.stringify({ mode, width, collapsed })); } catch (e) { /* optional */ }
  }
  function layout() {
    const displayMode = narrow.matches && mode === 'split' ? 'edit' : mode;
    wrap.dataset.mode = displayMode; wrap.classList.toggle('tree-collapsed', collapsed);
    controls.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === displayMode)));
    controls.querySelector('[data-tree]').setAttribute('aria-expanded', String(!collapsed));
    controls.querySelector('select').value = width;
    controls.querySelector('[data-student]').href = url(); scale();
  }
  function scale() {
    const factor = Math.min(1, viewport.clientWidth / width);
    if (!factor) return;
    frame.style.width = width + 'px'; frame.style.height = Math.max(1, viewport.clientHeight / factor) + 'px'; frame.style.transform = 'scale(' + factor + ')';
    caption.textContent = DEVICES[width] + ' · ' + width + ' · уменьшено до ' + Math.round(factor * 100) + '%';
  }
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
    if (!timer) timer = setTimeout(() => { timer = null; send(); }, 300);
    controls.querySelector('[data-student]').href = url();
  }
  const receive = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== 'citadel-preview-ready') return;
    ready = true; full = navigate = true; update();
  };
  window.addEventListener('message', receive);
  narrow.addEventListener('change', layout);
  const themeObserver = new MutationObserver(() => update()); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const observer = new ResizeObserver(scale); observer.observe(viewport);
  const controlObserver = new ResizeObserver(() => main.style.setProperty('--editor-view-h', controls.offsetHeight + 'px')); controlObserver.observe(controls);
  controls.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; layout(); persist(); }));
  controls.querySelector('select').addEventListener('change', (e) => { width = Number(e.target.value); layout(); persist(); });
  controls.querySelector('[data-tree]').addEventListener('click', () => { collapsed = !collapsed; layout(); persist(); });
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
  return { update, destroy() { clearTimeout(timer); observer.disconnect(); controlObserver.disconnect(); themeObserver.disconnect(); window.removeEventListener('message', receive); narrow.removeEventListener('change', layout); } };
}
