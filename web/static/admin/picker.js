import { h, esc, req, toast } from './ui.js';
import { avatarHTML } from '../site/shared.js';

let pickerID = 0;
export function personHTML(user) {
  return '<span class="ad-ava">' + avatarHTML(user, 32) + '</span><span class="ad-person-name"><b>' + esc(user.name) + '</b><small>' + esc(user.login || 'без логина') + (user.disabledAt ? ' · заблокирован' : '') + '</small></span>';
}

// A reusable asynchronous combobox. Focus stays in the input; aria-activedescendant
// exposes the active option. A generation guards both the debounce and late replies.
export function searchPicker({ label, search, onSelect, render = (item) => esc(item.title), delay = 250 }) {
  const id = 'admin-picker-' + ++pickerID, root = h('div', 'ad-picker');
  root.innerHTML = '<label class="ad-f" for="' + id + '">' + esc(label) + '<input id="' + id + '" type="text" role="combobox" autocomplete="off" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-list"></label><div class="ad-picker-options" id="' + id + '-list" role="listbox" aria-label="' + esc(label) + '" hidden></div><p class="ad-small ad-mut" role="status"></p>';
  const input = root.querySelector('input'), list = root.querySelector('[role=listbox]'), status = root.querySelector('[role=status]');
  let timer, generation = 0, items = [], active = -1, disposed = false;
  function close() { clearTimeout(timer); generation++; list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) { input.setAttribute('aria-activedescendant', id + '-option-' + active); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
  }
  async function choose(index) {
    const item = items[index]; if (!item || input.disabled) return;
    close(); input.disabled = true;
    try { if (await onSelect(item) !== false) input.value = ''; }
    catch (e) { toast(e.message, 'bad'); }
    finally { input.disabled = false; if (!disposed && root.isConnected) input.focus(); }
  }
  input.addEventListener('input', () => {
    close(); status.textContent = '';
    const query = input.value.trim(), version = generation;
    if (Array.from(query).length < 2) return;
    timer = setTimeout(async () => {
      try {
        const found = await search(query);
        if (disposed || version !== generation || !root.isConnected) return;
        items = found;
        list.innerHTML = items.map((item, i) => '<div role="option" aria-selected="false" id="' + id + '-option-' + i + '" data-index="' + i + '">' + render(item) + '</div>').join('');
        list.hidden = !items.length; input.setAttribute('aria-expanded', String(!!items.length));
        status.textContent = items.length ? 'Найдено: ' + items.length : 'Никого не найдено';
      } catch (e) { if (version === generation && !disposed) status.textContent = e.message; }
    }, delay);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); input.focus(); }
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); highlight((active + (e.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + items.length) % items.length); }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    if (e.key === 'Tab') close();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const option = e.target.closest('[role=option]'); if (option) choose(Number(option.dataset.index)); });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) close(); });
  const outside = (e) => { if (!root.contains(e.target)) close(); };
  document.addEventListener('click', outside);
  return { root, input, close, destroy() { disposed = true; close(); document.removeEventListener('click', outside); } };
}

export function userPicker(options) {
  return searchPicker({ ...options, render: personHTML, search: async (q) => {
    const result = await req('GET', '/api/admin/users/search?q=' + encodeURIComponent(q) + '&limit=10' + (options.ownersOnly ? '&owners=1' : ''));
    if (!result.ok) throw new Error('Не удалось найти пользователей');
    return result.data.filter((u) => !options.exclude?.(u));
  } });
}
