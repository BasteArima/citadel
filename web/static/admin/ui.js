// Общее для страниц админки: запросы к API, экранирование, диалоги, сообщения.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// Запрос к API: { ok, status, data }. Без сессии — на вход и обратно.
export async function req(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
    return new Promise(() => {});
  }
  let data = null;
  try { data = await r.json(); } catch (e) { /* пустой ответ */ }
  return { ok: r.ok, status: r.status, data: data || {} };
}

// «29.10, 14:20» по часам админа; сегодня — «сегодня, 14:20».
export function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => (n < 10 ? '0' : '') + n, now = new Date();
  const time = p(d.getHours()) + ':' + p(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return 'сегодня, ' + time;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + (d.getFullYear() !== now.getFullYear() ? '.' + d.getFullYear() : '') + ', ' + time;
}

export const METALS = { iron: 'железо', copper: 'медь', bronze: 'бронза', silver: 'серебро', gold: 'золото', steel: 'сталь' };

export function linkIcon(metal, dashed, w) {
  w = w || 36;
  return '<svg class="link-ic metal-' + esc(metal) + '" width="' + w + '" height="' + Math.round(w * 40 / 56) + '" viewBox="0 0 56 40" aria-hidden="true">' +
    '<rect class="lk-metal" x="4" y="6" width="48" height="28" rx="14" stroke-width="5"' + (dashed ? ' stroke-dasharray="6 6"' : '') + '/></svg>';
}

// Итог проверки пилюлей: ошибки важнее предупреждений.
export function checkPill(c) {
  if (!c) return '';
  if (c.errors) return '<span class="ad-pill bad">' + c.errors + ' ' + plural(c.errors, 'ошибка', 'ошибки', 'ошибок') + '</span>';
  if (c.warnings) return '<span class="ad-pill warn">' + c.warnings + ' ' + plural(c.warnings, 'предупреждение', 'предупреждения', 'предупреждений') + '</span>';
  return '<span class="ad-pill good">✓ без ошибок</span>';
}

// Пункты проверки черновика: сервер отдаёт находки списком, здесь они раскладываются по темам.
export const AREAS = [
  ['schema', 'Схема блоков', 'все блоки известных типов, обязательные поля на месте'],
  ['terms', 'Термины', 'все ссылки ведут в словарь'],
  ['links', 'Ссылки на узлы', 'все ссылки и опоры ведут на существующие узлы'],
  ['answers', 'Правильные ответы', 'у каждого вопроса есть верный ответ'],
  ['outputs', 'Выводы программ', 'у каждого «предскажи» есть вывод или ошибка'],
  ['passport', 'Паспорт и дерево', 'название, металл, инструмент, id узлов']
];

export function areaOf(p) {
  const m = p.msg;
  if (/термин/.test(m)) return 'terms';
  if (/несуществующ/.test(m)) return 'links';
  if (/вывода|запуском/.test(m) && !/паспорт/.test(p.path)) return 'outputs';
  if (/вариант|верн|вопрос|пункт/.test(m)) return 'answers';
  if (/блок|поля/.test(m)) return 'schema';
  return 'passport';
}

// Сообщение внизу экрана.
let toastBox = null;
export function toast(msg, kind) {
  if (!toastBox) { toastBox = h('div', 'ad-toasts'); toastBox.setAttribute('role', 'status'); document.body.appendChild(toastBox); }
  const t = h('div', 'ad-toast' + (kind ? ' ' + kind : ''), esc(msg));
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

// Модальный диалог. body — HTML или узел; buttons — [{ label, primary, danger, onClick(close) }].
export function dialog(title, body, buttons) {
  const d = h('dialog', 'ad-dialog');
  d.innerHTML = '<form method="dialog" class="ad-dlg-in"><h2>' + esc(title) + '</h2><div class="ad-dlg-body"></div><div class="ad-dlg-btns"></div></form>';
  const bodyBox = d.querySelector('.ad-dlg-body');
  if (typeof body === 'string') bodyBox.innerHTML = body; else bodyBox.appendChild(body);
  const close = () => { d.close(); d.remove(); };
  const btns = d.querySelector('.ad-dlg-btns');
  (buttons || [{ label: 'Закрыть' }]).forEach((b) => {
    const el = h('button', 'btn' + (b.primary ? ' pri' : '') + (b.danger ? ' ad-danger' : ''), esc(b.label));
    el.type = 'button';
    if (b.disabled) el.disabled = true;
    el.addEventListener('click', () => (b.onClick ? b.onClick(close, d) : close()));
    btns.appendChild(el);
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(d);
  d.showModal();
  return d;
}

export function confirmDialog(title, text, label, danger) {
  return new Promise((resolve) => {
    dialog(title, '<p>' + esc(text) + '</p>', [
      { label: 'Отмена', onClick: (close) => { close(); resolve(false); } },
      { label, primary: !danger, danger, onClick: (close) => { close(); resolve(true); } }
    ]);
  });
}

// Обходит дерево курса: fn(node, parent, depth).
export function walk(nodes, fn, parent, depth) {
  (nodes || []).forEach((n) => {
    fn(n, parent || null, depth || 0);
    walk(n.children, fn, n, (depth || 0) + 1);
  });
}

// Подпись узла для путей и таблиц: «Урок 13 · ч. 2».
export function nodeLabel(course, id) {
  let out = id;
  walk(course.root, (n, parent) => {
    if (n.id !== id) return;
    if (n.kind === 'lesson') out = 'Урок ' + (n.n || '?');
    else if (n.kind === 'part' && parent) out = 'Урок ' + (parent.n || '?') + ' · ч. ' + (parent.children.indexOf(n) + 1);
    else out = n.title;
  });
  return out;
}
