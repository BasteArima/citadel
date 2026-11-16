// Главная: текущее обучение, повторение и каталог по направлениям.
import { api, esc, plural, today, courseState, lastPlace } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';
import { projectCard } from './projects-ui.js';
import { courseTile, soonCourseTile, authorContext } from './tiles.js';

initSiteSearch();
const app = document.getElementById('app');
const top = siteTop('catalog');
const FILTERS = [['all', 'Все статусы'], ['active', 'В процессе'], ['new', 'Не начатые'], ['done', 'Пройденные']];
let filter = 'all', direction = 'all';
try {
  filter = sessionStorage.getItem('citadel-catalog-filter') || 'all';
  direction = sessionStorage.getItem('citadel-catalog-direction') || 'all';
} catch (e) { /* без хранилища */ }
if (!FILTERS.some(([id]) => id === filter)) filter = 'all';

try {
  const [user, ov] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  render(user, ov.courses, ov.soon || [], ov.directions || []);
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить курсы: ' + esc(e.message) + '</p></main>';
}

function render(user, everything, allSoon, directions) {
  const projects = everything.filter((c) => c.type === 'project');
  const courses = everything.filter((c) => c.type !== 'project');
  const soon = allSoon.filter((c) => c.type !== 'project');
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  const all = [...courses, ...soon.map((c) => ({ ...c, soon: true }))];
  const groups = directions.map((d) => ({ ...d, courses: all.filter((c) => c.direction === d.id) })).filter((d) => d.courses.length);
  const without = all.filter((c) => !c.direction);
  if (without.length) groups.push({ id: '', title: 'Без направления', courses: without });
  if (direction !== 'all' && !groups.some((g) => g.id === direction)) direction = 'all';
  top.update(user, everything.reduce((s, c) => s + c.due, 0));
  const now = continueCard(courses, byId) + projectCard(projects);
  app.innerHTML = '<main class="site-main"><h1 class="visually-hidden">Курсы</h1>' +
    '<section class="catalog-section" aria-labelledby="now-title"><h2 id="now-title">Сейчас</h2><div class="top-cards">' +
    (now || '<section class="card top-card"><h2>С чего начать</h2><p>Выбери курс в каталоге и открой первый урок.</p></section>') + '</div>' + reviewRow(everything) + '</section>' +
    '<section class="catalog-section" aria-labelledby="catalog-title"><div class="catalog-toolbar"><h2 id="catalog-title">Каталог</h2><div class="catalog-filters">' +
    '<div class="direction-chips" role="group" aria-label="Направление курсов">' + directionChip('all', 'Все') +
    groups.filter((g) => g.id || directions.length).map((g) => directionChip(g.id, g.title + ' · ' + g.courses.length)).join('') + '</div>' +
    '<label class="catalog-status"><span class="visually-hidden">Статус курса</span><select id="catalog-status">' + FILTERS.map(([id, title]) => '<option value="' + id + '"' + (id === filter ? ' selected' : '') + '>' + title + '</option>').join('') + '</select></label></div></div>' +
    '<div class="catalog-section" id="catalog-groups"></div></section></main>';

  const box = document.getElementById('catalog-groups');
  const save = () => {
    try {
      sessionStorage.setItem('citadel-catalog-filter', filter);
      sessionStorage.setItem('citadel-catalog-direction', direction);
    } catch (e) { /* без хранилища */ }
  };
  const draw = () => {
    const selected = groups.filter((g) => direction === 'all' || direction === g.id);
    const rank = (c) => c.soon ? 3 : { active: 0, new: 1, done: 2 }[courseState(c)];
    const shown = selected.map((g) => ({ ...g, courses: g.courses.filter((c) => c.soon ? filter === 'all' || filter === 'new' : filter === 'all' || courseState(c) === filter).sort((a, b) => rank(a) - rank(b)) })).filter((g) => g.courses.length);
    const grouped = direction === 'all' && groups.length > 1;
    const context = authorContext(shown.flatMap((g) => grouped ? g.courses.slice(0, 6) : g.courses), user);
    box.innerHTML = shown.map((g) => '<section class="catalog-section">' + (grouped ? '<div class="catalog-group-head"><h3>' + esc(g.title) + '</h3><button type="button" class="catalog-all" data-direction="' + esc(g.id) + '">Все ' + g.courses.length + ' →</button></div>' : '') +
      '<div class="tiles">' + (grouped ? g.courses.slice(0, 6) : g.courses).map((c) => c.soon ? soonCourseTile(c) : courseTile(c, byId, context)).join('') + '</div></section>').join('') ||
      '<div class="empty">' + ({ done: 'Пока ни одного пройденного курса. Первое звено ещё куётся.', active: 'Ни один курс ещё не начат.', new: 'Все курсы уже начаты.' }[filter] || 'Курсов пока нет.') + '</div>';
    app.querySelectorAll('.direction-chips [data-direction]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.direction === direction)));
    fitReviewChips();
  };
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-direction]');
    if (!b) return;
    const fromGroup = b.classList.contains('catalog-all');
    direction = b.dataset.direction;
    save(); draw();
    if (fromGroup) [...app.querySelectorAll('.direction-chips button')].find((chip) => chip.dataset.direction === direction)?.focus();
  });
  app.querySelector('#catalog-status').addEventListener('change', (e) => { filter = e.target.value; save(); draw(); });
  draw();
  const chips = app.querySelector('.review-chips');
  if (chips) new ResizeObserver(fitReviewChips).observe(chips);
}

function directionChip(id, title) {
  return '<button type="button" class="chip" data-direction="' + esc(id) + '" aria-pressed="' + (direction === id) + '">' + esc(title) + '</button>';
}

function reviewRow(courses) {
  const due = courses.filter((c) => c.due > 0), total = due.reduce((s, c) => s + c.due, 0);
  if (!total) return '<p class="review-empty">Сегодня повторять нечего</p>';
  return '<div class="review-row"><span aria-hidden="true">↻</span><span class="review-count">' + total + ' ' + plural(total, 'карточка ждёт', 'карточки ждут', 'карточек ждут') + ' повторения</span>' +
    '<div class="review-chips">' + due.map((c) => '<span class="chip" title="' + esc(c.title) + '">' + esc(c.title) + ' · ' + c.due + '</span>').join('') + '<span class="chip review-more" hidden></span></div>' +
    '<a class="btn btn-l" href="/review">Повторить</a></div>';
}

// Чипы измеряются в доступной ширине, остаток сворачивается в +N.
function fitReviewChips() {
  const box = app.querySelector('.review-chips');
  if (!box) return;
  const more = box.querySelector('.review-more'), chips = [...box.children].filter((c) => c !== more);
  chips.forEach((c) => { c.hidden = false; });
  more.hidden = true;
  let count = chips.length;
  while (count && box.scrollWidth > box.clientWidth) {
    chips[--count].hidden = true;
    more.textContent = '+' + (chips.length - count);
    more.title = chips.slice(count).map((c) => c.title).join(', ');
    more.hidden = false;
  }
}

function continueCard(courses, byId) {
  const last = lastPlace();
  let c = last && byId[last.course];
  if (c && last.label) {
    const parts = Array.isArray(last.parts) ? last.parts : [];
    const strip = parts.length ? '<div class="cont-strip" role="img" aria-label="Закрыто частей: ' + parts.filter((p) => p === 'ok').length + ' из ' + parts.length + '">' +
      parts.map((p) => '<i class="' + (p === 'ok' ? 'ok' : p === 'cur' ? 'cur' : '') + '"></i>').join('') + '</div>' : '';
    return '<section class="card top-card" aria-labelledby="ct"><div class="lbl" id="ct">Продолжить с того же места</div><div><p>' + esc(c.title) + '</p><h2>' + esc(last.label) + '</h2></div>' + strip +
      '<div class="row"><a class="btn btn-l pri" href="/c/' + encodeURIComponent(c.id) + '/' + esc(last.hash || '') + '">Продолжить</a></div></section>';
  }
  c = courses.find((x) => x.started && x.next) || courses.find((x) => x.next);
  if (!c) return '';
  return '<section class="card top-card" aria-labelledby="ct"><div class="lbl" id="ct">' + (c.started ? 'Продолжить с того же места' : 'С чего начать') + '</div><div><p>' + esc(c.title) + '</p><h2>Урок ' + c.next.n + '. ' + esc(c.next.title) + '</h2></div>' +
    '<div class="row"><a class="btn btn-l pri" href="/c/' + encodeURIComponent(c.id) + '/#' + encodeURIComponent(c.next.id) + '">' + (c.started ? 'Продолжить' : 'Начать') + '</a></div></section>';
}
