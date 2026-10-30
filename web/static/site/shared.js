// Общее для страниц вокруг курсов (каталог, профиль): запросы к API, шапка, металлы и звенья цепи.

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Дата по часам ученика: «повторить сегодня» считается от его дня, а не от дня сервера.
export function today() {
  const d = new Date(), p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function addDays(iso, n) {
  const p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + n), z = (x) => (x < 10 ? '0' : '') + x;
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

// Следующий показ карточки по оценке (решение 0008): «Забыл» и «С трудом» — первый и второй
// интервал курса, «Помню» — третий, а «Помню» подряд — вдвое дольше прошлого интервала.
export function nextCard(card, grade, review) {
  const R = review && review.length >= 3 ? review : [1, 3, 7];
  let i, s = 0;
  if (grade === 'again') i = R[0];
  else if (grade === 'hard') i = R[1];
  else { s = (card.s || 0) + 1; i = s >= 2 ? Math.max(R[2], (card.i || R[2]) * 2) : R[2]; }
  return { d: addDays(today(), i), i, s };
}

export function inDays(n) {
  return n === 1 ? 'завтра' : 'через ' + n + ' ' + plural(n, 'день', 'дня', 'дней');
}

// Текст курса вне движка: ссылки на уроки и термины становятся просто словами.
export function courseText(html, course) {
  return String(html || '').replace(/\{\{>([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, (m, id, txt) => txt || id)
    .replace(/\{\{([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, (m, k, txt) => txt || (course.glossary[k] ? course.glossary[k].t : k));
}

// Запрос к API; без сессии — на страницу входа и обратно.
export async function api(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    return new Promise(() => {});
  }
  if (!r.ok) throw new Error('сервер ответил ' + r.status);
  return r.status === 204 ? null : r.json();
}

export const METALS = { iron: 'железо', copper: 'медь', bronze: 'бронза', silver: 'серебро', gold: 'золото', steel: 'сталь' };
export const metalName = (m) => METALS[m] || m;

// Состояние курса для ученика: звено выковано, когда пройдены все уроки плана.
export function courseState(o) {
  if (o.lessons > 0 && o.done >= o.lessons) return 'done';
  return o.started ? 'active' : 'new';
}

// Звено цепи: дорожка и металл. part — доля от 0 до 1, сколько звена уже выковано.
export function linkIcon(metal, part, size) {
  const w = size || 56, h = Math.round(w * 40 / 56);
  const per = 2 * (48 - 28) + Math.PI * 28; // периметр скруглённого прямоугольника 48×28 с радиусом 14
  const dash = part >= 1 ? '' : ' stroke-dasharray="' + Math.max(part * per, part > 0 ? 6 : 0).toFixed(1) + ' ' + per.toFixed(1) + '"';
  return '<svg class="link-ic metal-' + esc(metal) + '" width="' + w + '" height="' + h + '" viewBox="0 0 56 40" aria-hidden="true">' +
    '<rect class="lk-track" x="4" y="6" width="48" height="28" rx="14" stroke-width="5"/>' +
    (part > 0 ? '<rect class="lk-metal" x="4" y="6" width="48" height="28" rx="14" stroke-width="5"' + dash + '/>' : '') + '</svg>';
}

// Шапка сайта: логотип, разделы (у «Повторений» — сколько карточек на сегодня), кто вошёл.
export function header(user, current, due) {
  const nav = [['/', 'Курсы', 'catalog'], ['/review', 'Повторения', 'review'], ['/profile', 'Профиль', 'profile']];
  if (user.role === 'admin') nav.push(['/admin', 'Админка', 'admin']);
  return '<header class="site-top">' +
    '<a class="site-brand" href="/"><svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><rect x="2" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--dim)" stroke-width="2.5"/><rect x="13" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--acc-fill)" stroke-width="2.5"/></svg><span class="site-brand-t">Citadel</span></a>' +
    '<nav class="site-nav" aria-label="Разделы">' + nav.map((n) =>
      '<a href="' + n[0] + '"' + (n[2] === current ? ' aria-current="page"' : '') + '>' + n[1] +
      (n[2] === 'review' && due ? ' <b class="nav-badge">' + due + '</b>' : '') + '</a>').join('') + '</nav>' +
    '<span class="site-sp"></span>' +
    '<button type="button" class="tb-search" data-search aria-label="Поиск по всем курсам, Ctrl K"><svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Поиск</span><span class="kbd">Ctrl K</span></button>' +
    '<a class="site-me" href="/profile" aria-label="Профиль: ' + esc(user.name) + '">' + esc(user.name.slice(0, 1).toUpperCase()) + '</a>' +
    '</header>';
}

// Тема из настроек движка (общих для всех курсов).
export const UI_KEY = 'citadel-ui';
export function readUI() {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; }
}
export function applyTheme(theme) {
  const r = document.documentElement;
  if (theme === 'light' || theme === 'dark') r.setAttribute('data-theme', theme);
  else r.removeAttribute('data-theme');
}

// Последнее место в курсе, его записывает движок: { course, hash, label, at }.
export function lastPlace() {
  try { return JSON.parse(localStorage.getItem('citadel-last') || 'null'); } catch (e) { return null; }
}
