// Каталог: «Повторить сегодня» по всем курсам, «Продолжить с того же места» и плитки курсов.
import { api, esc, plural, today, linkIcon, metalName, courseState, lastPlace } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';

initSiteSearch();

const app = document.getElementById('app');
const top = siteTop('catalog');
const FILTERS = [['all', 'Все'], ['active', 'В процессе'], ['new', 'Не начатые'], ['done', 'Пройденные']];
const STATE = { done: ['Пройден', 'good'], active: ['В процессе', 'acc'], new: ['Не начат', ''] };

let filter = 'all';
try { filter = sessionStorage.getItem('citadel-catalog-filter') || 'all'; } catch (e) { /* без хранилища — «Все» */ }

try {
  const [user, ov] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  render(user, ov.courses, ov.soon || []);
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить курсы: ' + esc(e.message) + '</p></main>';
}

function render(user, courses, soon) {
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  top.update(user, courses.reduce((s, c) => s + c.due, 0));
  app.innerHTML =
    '<main class="site-main">' +
      '<div><h1>Курсы</h1><p class="site-sub">Каждый пройденный курс — звено твоей цепи.</p></div>' +
      '<div class="top-cards">' + reviewCard(courses) + continueCard(courses, byId) + '</div>' +
      '<div class="row" style="justify-content:space-between"><h2>Все курсы</h2>' +
        '<div class="segs" role="group" aria-label="Фильтр по статусу">' + FILTERS.map((f) =>
          '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + '</button>').join('') + '</div></div>' +
      '<div class="tiles" id="tiles"></div>' +
    '</main>';
  const tiles = document.getElementById('tiles');
  const draw = () => {
    const shown = courses.filter((c) => filter === 'all' || courseState(c) === filter);
    // неопубликованные курсы — плитками «Скоро»: видно, что готовится, но открыть нельзя
    const later = filter === 'all' || filter === 'new' ? soon : [];
    tiles.innerHTML = shown.length || later.length ? shown.map((c) => tile(c, byId)).join('') + later.map(soonTile).join('') :
      '<div class="empty" style="grid-column:1/-1">' + ({ done: 'Пока ни одного пройденного курса. Первое звено ещё куётся.', active: 'Ни один курс ещё не начат.', new: 'Все курсы уже начаты.' }[filter] || 'Курсов пока нет.') + '</div>';
  };
  app.querySelector('.segs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.getAttribute('data-f');
    try { sessionStorage.setItem('citadel-catalog-filter', filter); } catch (err) { /* не страшно */ }
    app.querySelectorAll('.segs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
  draw();
}

function reviewCard(courses) {
  const due = courses.filter((c) => c.due > 0), total = due.reduce((s, c) => s + c.due, 0);
  const body = total ?
    '<p>' + total + ' ' + plural(total, 'карточка ждёт', 'карточки ждут', 'карточек ждут') + ' повторения. Одна очередь на все курсы.</p>' +
    '<ul class="chips">' + due.map((c) => '<li class="chip metal-' + esc(c.metal) + '"><span class="dot"></span>' + esc(c.title) + ' · ' + c.due + '</li>').join('') + '</ul>' +
    '<div class="row"><a class="btn btn-l pri" href="/review">Начать повторение</a></div>' :
    '<p>Сегодня повторять нечего. Сюда возвращаются вопросы, где первая попытка была с ошибкой, и фразы «Скажи на собесе», отправленные в карточки.</p>';
  return '<section class="card top-card" aria-labelledby="rv"><h2 id="rv">Повторить сегодня</h2>' + body + '</section>';
}

function continueCard(courses, byId) {
  const last = lastPlace();
  let c = last && byId[last.course];
  if (c && last.label) {
    // полоска частей урока: зелёная — засчитана, синяя — где остановился
    const parts = Array.isArray(last.parts) ? last.parts : [];
    const strip = parts.length ? '<div class="cont-strip" role="img" aria-label="Закрыто частей: ' + parts.filter((p) => p === 'ok').length + ' из ' + parts.length + '">' +
      parts.map((p) => '<i class="' + (p === 'ok' ? 'ok' : p === 'cur' ? 'cur' : '') + '"></i>').join('') + '</div>' : '';
    return '<section class="card top-card" aria-labelledby="ct"><div class="lbl" id="ct">Продолжить с того же места</div>' +
      '<div><p>' + esc(c.title) + '</p><h2>' + esc(last.label) + '</h2></div>' + strip +
      '<div class="row"><a class="btn btn-l pri" href="/c/' + encodeURIComponent(c.id) + '/' + esc(last.hash || '') + '">Продолжить</a></div></section>';
  }
  // на этом устройстве ещё не открывали уроков — предлагаем первый непройденный в начатом курсе
  c = courses.find((x) => x.started && x.next) || courses.find((x) => x.next);
  if (!c) return '';
  return '<section class="card top-card" aria-labelledby="ct"><div class="lbl" id="ct">' + (c.started ? 'Продолжить' : 'С чего начать') + '</div>' +
    '<div><p>' + esc(c.title) + '</p><h2>Урок ' + c.next.n + '. ' + esc(c.next.title) + '</h2></div>' +
    '<div class="row"><a class="btn btn-l pri" href="/c/' + encodeURIComponent(c.id) + '/#' + encodeURIComponent(c.next.id) + '">' + (c.started ? 'Продолжить' : 'Начать') + '</a></div></section>';
}

function soonTile(c) {
  return '<article class="card tile tile-soon metal-' + esc(c.metal) + '" aria-label="' + esc(c.title) + ' — скоро">' +
    '<div class="tile-h">' + linkIcon(c.metal, 0) + '<span class="chip">Скоро</span></div>' +
    '<div><h3>' + esc(c.title) + '</h3><p>Курс готовится. Откроется, когда его опубликуют.</p></div>' +
    '<ul class="chips"><li class="chip"><span class="dot"></span>звено: ' + esc(metalName(c.metal)) + '</li></ul>' +
    '</article>';
}

function tile(c, byId) {
  const st = courseState(c), pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
  const href = '/c/' + encodeURIComponent(c.id) + '/';
  const needs = (c.requires || []).map((id) => (byId[id] ? byId[id].title : id));
  return '<article class="card tile metal-' + esc(c.metal) + '">' +
    '<div class="tile-h">' + linkIcon(c.metal, st === 'done' ? 1 : c.lessons ? c.done / c.lessons : 0) +
      '<span class="chip ' + STATE[st][1] + '">' + STATE[st][0] + '</span></div>' +
    '<div><h3><a href="' + href + '">' + esc(c.title) + '</a></h3>' + (c.subtitle ? '<p>' + esc(c.subtitle) + '</p>' : '') + '</div>' +
    '<ul class="chips"><li class="chip">' + esc(c.tool.name + ' ' + c.tool.version) + '</li>' +
      '<li class="chip">' + c.lessons + ' ' + plural(c.lessons, 'урок', 'урока', 'уроков') + (c.ready < c.lessons ? ', готово ' + c.ready : '') + '</li>' +
      '<li class="chip"><span class="dot"></span>звено: ' + esc(metalName(c.metal)) + '</li></ul>' +
    (needs.length ? '<p>Опирается на: ' + needs.map(esc).join(', ') + '</p>' : '') +
    '<div class="prog"><div class="prog-t"><span>Пройдено ' + c.done + ' из ' + c.lessons + '</span><span>' + pct + '%</span></div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Прогресс курса"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="row">' +
      (c.next ? '<a class="btn btn-l pri" href="' + href + '#' + encodeURIComponent(c.next.id) + '">' + (c.started ? 'Продолжить' : 'Начать') + '</a>' : '') +
      '<a class="btn btn-l" href="' + href + '">О курсе</a></div>' +
    '</article>';
}
