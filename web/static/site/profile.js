// Профиль: кто ты и что прошёл.
import { api, esc, plural, today, metalName, courseState, avatarHTML, roleName, linkIcon } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';

initSiteSearch();
const app = document.getElementById('app');
const top = siteTop('profile');
let user, courses;
try {
  [user, { courses }] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  render();
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить профиль: ' + esc(e.message) + '</p></main>';
}

function render() {
  const sum = (f) => courses.reduce((s, c) => s + f(c), 0);
  const forged = courses.filter((c) => courseState(c) === 'done').length;
  const forging = courses.filter((c) => courseState(c) === 'active').length;
  const answered = sum((c) => c.solved), right = sum((c) => c.firstRight);
  top.update(user, sum((c) => c.due));
  app.innerHTML = '<main class="site-main">' +
    '<div class="me-h"><span class="me-av" aria-hidden="true">' + avatarHTML(user, 72) + '</span>' +
    '<div class="me-identity"><h1>' + esc(user.name) + '</h1><p class="site-sub">' + roleName(user.role) + '</p></div>' +
    '<a class="btn btn-l me-settings" href="/settings">Настройки</a></div>' +
    chain(forged, forging) +
    '<section class="stats" aria-label="Статистика">' +
      stat('Уроков пройдено', sum((c) => c.type === 'project' ? 0 : c.done)) +
      stat('Частей закрыто', sum((c) => c.parts)) +
      stat('Вопросов отвечено', answered) +
      stat('Первых ответов верно', answered ? Math.round(right / answered * 100) + '%' : '—') +
      stat('Карточек на сегодня', sum((c) => c.due) + ' из ' + sum((c) => c.cards)) +
      stat('Звеньев выковано', forged + ' из ' + courses.length) +
    '</section>' + myCourses() + '</main>';
}

function myCourses() {
  const started = courses.filter((c) => courseState(c) !== 'new');
  return '<section class="my-courses" aria-labelledby="my-courses-title"><h2 id="my-courses-title">Мои курсы</h2>' +
    (started.length ? '<ul class="my-course-list">' + started.map((c) => {
      const done = courseState(c) === 'done';
      const part = c.lessons ? Math.min(1, c.done / c.lessons) : 0;
      const href = (c.type === 'project' ? '/p/' : '/c/') + encodeURIComponent(c.id) + '/';
      const next = !done && c.next ? '#' + encodeURIComponent(c.next.id) : '';
      return '<li class="card my-course-row">' + linkIcon(c.metal, part, 48) +
        '<div class="my-course-info"><a href="' + href + '">' + esc(c.title) + '</a><small>' + c.done + ' из ' + c.lessons + ' ' +
        (c.type === 'project' ? plural(c.lessons, 'шага', 'шагов', 'шагов') : plural(c.lessons, 'урока', 'уроков', 'уроков')) + '</small>' +
        '<div class="bar" role="progressbar" aria-label="' + esc(c.title) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(part * 100) + '"><i style="width:' + part * 100 + '%"></i></div></div>' +
        (done ? '<span class="my-course-done">Пройден</span>' : '<a class="btn btn-l" href="' + href + next + '">Продолжить</a>') + '</li>';
    }).join('') + '</ul>' : '<div class="empty">Пока ничего не начато. <a href="/">Выбери курс в каталоге</a>.</div>') + '</section>';
}

function stat(label, value) {
  return '<div class="card stat"><span class="lbl">' + label + '</span><b>' + value + '</b></div>';
}

// Цепь: звено на курс. Выковано — курс пройден; куётся — дуга по доле пройденных уроков;
// не начат — пунктир. В конце — пустые места под будущие курсы.
function chain(forged, forging) {
  const step = 160, w = 200, slots = 2, n = courses.length + slots;
  const per = 2 * (w - 80) + Math.PI * 80; // периметр звена 200×80 с радиусом 40
  const links = courses.map((c, i) => {
    const x = 20 + i * step, st = courseState(c), part = c.lessons ? c.done / c.lessons : 0;
    const shape = 'x="' + x + '" y="35" width="' + w + '" height="80" rx="40" stroke-width="14"';
    if (st === 'done') return '<g class="metal-' + esc(c.metal) + '"><rect class="lk-metal" ' + shape + '/></g>';
    if (st === 'new') return '<g class="metal-' + esc(c.metal) + '"><rect class="lk-track" ' + shape + ' stroke-dasharray="14 12"/></g>';
    const len = Math.max(per * part, 26);
    return '<g class="metal-' + esc(c.metal) + '"><rect class="lk-track" ' + shape + '/><rect class="lk-metal" ' + shape + ' stroke-dasharray="' + len.toFixed(1) + ' ' + per.toFixed(1) + '"/></g>';
  }).join('');
  let empty = '';
  for (let i = courses.length; i < n; i++) empty += '<rect class="lk-slot" x="' + (20 + i * step) + '" y="35" width="' + w + '" height="80" rx="40" stroke-width="14" stroke-dasharray="14 12"/>';
  const vbw = 20 + (n - 1) * step + w + 20;
  const label = courses.map((c) => c.title + ': ' + ({ done: 'выковано', active: 'куётся', new: 'не начато' }[courseState(c)])).join(', ');
  return '<section class="chain" aria-labelledby="ch">' +
    '<div class="row" style="justify-content:space-between;align-items:flex-end"><div><h2 id="ch">Цепь</h2>' +
      '<p>Звено куётся, пока идёт курс, и замыкается, когда курс пройден.</p></div>' +
      '<p>' + forged + ' ' + plural(forged, 'звено выковано', 'звена выковано', 'звеньев выковано') + (forging ? ' · ' + forging + ' куётся' : '') + '</p></div>' +
    '<div class="chain-scroll" tabindex="0" role="region" aria-label="Цепь курсов · прокручивай по горизонтали"><svg width="' + (vbw * 33 / 150) + '" height="33" viewBox="0 0 ' + vbw + ' 150" role="img" aria-label="Цепь: ' + esc(label) + '">' + links + empty + '</svg></div>' +
    '<div class="chain-cards">' + courses.map((c) => {
      const st = courseState(c);
      return '<a class="chain-card metal-' + esc(c.metal) + '" href="/c/' + encodeURIComponent(c.id) + '/">' +
        '<small>' + esc(metalName(c.metal)) + ' · ' + ({ done: 'выковано', active: 'куётся', new: 'не начато' }[st]) + '</small>' +
        '<b>' + esc(c.title) + '</b><span>' + c.done + ' из ' + c.lessons + ' ' + (c.type === 'project' ? plural(c.lessons, 'шага', 'шагов', 'шагов') : plural(c.lessons, 'урока', 'уроков', 'уроков')) + '</span></a>';
    }).join('') +
    '<div class="chain-card slot">Следующие звенья появятся с новыми курсами</div></div>' +
  '</section>';
}
