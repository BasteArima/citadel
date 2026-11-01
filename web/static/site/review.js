// Повторения: одна очередь карточек из всех курсов (решение 0008).
// Карточка — вопрос, где первая попытка была с ошибкой, или фраза «Скажи на собесе».
// Вспомни вслух → «Показать ответ» → «Забыл / С трудом / Помню»; оценка двигает следующий показ.
import { api, esc, today, nextCard, inDays, courseText } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';

initSiteSearch();

const app = document.getElementById('app');
const top = siteTop('review');
const SAY_RE = /^\s*<b>\s*Как сказать на собесе:?\s*<\/b>\s*/;

let user, overview, queue = [], pos = 0, shown = false, graded = 0;

try {
  [user, { courses: overview }] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  queue = await collect(overview.filter((c) => c.cards > 0));
  render();
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось собрать карточки: ' + esc(e.message) + '</p></main>';
}

// Карточки на сегодня из всех курсов: самые просроченные первыми.
async function collect(courses) {
  const out = [], t = today();
  for (const o of courses) {
    const [course, progress] = await Promise.all([api('/api/courses/' + encodeURIComponent(o.id)), api('/api/progress/' + encodeURIComponent(o.id))]);
    const lessons = indexLessons(course);
    for (const [key, it] of Object.entries(progress.items)) {
      if (!key.startsWith('card:') || !it.v || !it.v.d || it.v.d > t) continue;
      const [, lid, ref] = key.split(':');
      const les = lessons[lid];
      if (!les) continue;
      const card = ref === 'say' ? sayCard(les, course) : questionCard(les, ref, course);
      if (card) out.push(Object.assign(card, { key, value: it.v, course, lesson: les }));
    }
  }
  return out.sort((a, b) => (a.value.d < b.value.d ? -1 : a.value.d > b.value.d ? 1 : 0));
}

function indexLessons(course) {
  const out = {};
  const walk = (ns) => ns.forEach((n) => { if (n.kind === 'lesson') out[n.id] = n; walk(n.children || []); }); // тот же объект, что в course.root: placeOf ищет по нему
  walk(course.root || []);
  return out;
}

// Где лежит карточка: урок курса или шаг проекта (номер шага — уровень и место в нём).
function placeOf(c) {
  if (c.course.type !== 'project') return 'урок ' + c.lesson.n;
  const levels = c.course.root.filter((n) => n.kind === 'section');
  const l = levels.findIndex((s) => (s.children || []).includes(c.lesson));
  return 'шаг ' + (l + 1) + '.' + (levels[l].children.indexOf(c.lesson) + 1);
}

function sayCard(les, course) {
  const say = les.say || ((les.simple || []).find((p) => SAY_RE.test(p)) || '').replace(SAY_RE, '');
  if (!say) return null;
  return { kind: 'Скажи на собесе', front: 'Как ты объяснишь на собесе: «' + esc(les.title) + '»?', back: courseText(say, course) };
}

function questionCard(les, qid, course) {
  let q = null;
  const find = (blocks) => (blocks || []).forEach((b) => {
    if (b.type === 'question' && b.id === qid) q = b;
    if (b.type === 'hands') (b.check || []).forEach((c) => { if (c.id === qid) q = c; });
    if (b.type === 'spec') (b.viva || []).forEach((c) => { if (c.id === qid) q = c; });
  });
  find(les.blocks);
  (les.children || []).forEach((p) => find(p.blocks));
  if (!q) return null;
  if (!q.kind) return { kind: 'Вопрос с защиты', front: courseText(q.q, course), back: '<p>' + courseText(q.a, course) + '</p>' };
  const right = q.kind === 'choice' ? q.opts[q.a] : q.kind === 'text' ? q.a[0] : (q.items || []).map((t, i) => (i + 1) + '. ' + t).join('<br>');
  return {
    kind: 'Вопрос, где ошибся',
    front: courseText(q.q, course),
    back: '<p class="rv-right">' + courseText(right, course) + '</p>' + (q.why ? '<p>' + courseText(q.why, course) + '</p>' : '')
  };
}

function render() {
  const total = queue.length, due = overview.reduce((s, c) => s + c.due, 0);
  const card = queue[pos];
  top.update(user, Math.max(due - graded, 0));
  app.innerHTML =
    '<main class="site-main rv">' +
      '<div class="rv-grid"><div class="rv-main">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-end"><div><h1>Повторить сегодня</h1>' +
        '<p class="site-sub">Одна очередь по всем курсам. Вспомни ответ вслух, потом открой.</p></div>' +
        (total ? '<span class="site-sub">' + pos + ' из ' + total + '</span>' : '') + '</div>' +
        (total ? '<div class="bar rv-bar" role="progressbar" aria-valuenow="' + pos + '" aria-valuemin="0" aria-valuemax="' + total + '" aria-label="Пройдено карточек"><i style="width:' + Math.round(pos / total * 100) + '%"></i></div>' : '') +
        (card ? cardHTML(card) : doneHTML(total)) +
      '</div>' + aside() + '</div>' +
    '</main>';
  wire(card);
}

function cardHTML(c) {
  const R = c.course.review && c.course.review.length >= 3 ? c.course.review : [1, 3, 7];
  const remember = nextCard(c.value, 'good', R).i;
  return '<article class="card rv-card metal-' + esc(c.course.metal) + '" aria-live="polite">' +
    '<div class="row"><span class="chip"><span class="dot"></span>' + esc(c.course.title) + ' · ' + placeOf(c) + '</span>' +
    '<span class="chip acc">' + c.kind + '</span></div>' +
    '<h2 class="rv-q">' + c.front + '</h2>' +
    (shown ? '<div class="rv-a"><span class="lbl">Ответ</span>' + c.back +
      '<a href="/c/' + encodeURIComponent(c.course.id) + '/#' + encodeURIComponent(c.lesson.id) + '">' + (c.course.type === 'project' ? 'Открыть шаг' : 'Открыть урок') + ' →</a></div>' : '') +
    '<div class="rv-sp"></div>' +
    (shown ?
      '<div class="rv-grades" role="group" aria-label="Насколько легко вспомнил">' +
        '<button type="button" class="btn" data-g="again"><span>Забыл</span><small>' + inDays(R[0]) + '</small><kbd>1</kbd></button>' +
        '<button type="button" class="btn" data-g="hard"><span>С трудом</span><small>' + inDays(R[1]) + '</small><kbd>2</kbd></button>' +
        '<button type="button" class="btn" data-g="good"><span>Помню</span><small>' + inDays(remember) + '</small><kbd>3</kbd></button></div>' :
      '<div class="row"><button type="button" class="btn pri btn-l" id="show">Показать ответ</button><span class="site-sub"><kbd>Пробел</kbd></span></div>') +
  '</article>';
}

function doneHTML(total) {
  const next = overview.find((c) => c.next && c.type !== 'project');
  return '<div class="card rv-done"><h2>' + (total ? 'На сегодня всё' : 'Сегодня повторять нечего') + '</h2>' +
    '<p class="site-sub">' + (total ? 'Следующие карточки — по расписанию справа.' : 'Карточки появляются из ошибок первой попытки и из фраз «Скажи на собесе», которые отправлены кнопкой «+ В карточки».') + '</p>' +
    (next ? '<a class="btn pri btn-l" href="/c/' + encodeURIComponent(next.id) + '/#' + encodeURIComponent(next.next.id) + '">Продолжить: урок ' + next.next.n + '</a>' : '') + '</div>';
}

function aside() {
  const withCards = overview.filter((c) => c.cards > 0);
  const week = [0, 0, 0, 0, 0, 0, 0];
  overview.forEach((c) => (c.week || []).forEach((n, i) => { week[i] += n; }));
  week[0] = Math.max(week[0] - graded, 0);
  const max = Math.max(1, ...week);
  const days = ['сег', ...[1, 2, 3, 4, 5, 6].map((i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toLocaleDateString('ru-RU', { weekday: 'short' }); })];
  return '<aside class="rv-aside">' +
    '<section class="card panel"><h2 class="lbl">Сегодня по курсам</h2>' +
      (withCards.length ? '<ul class="rv-list">' + withCards.map((c) => '<li class="metal-' + esc(c.metal) + '"><span><span class="chip-dot"></span>' + esc(c.title) + '</span><span>' + c.due + ' из ' + c.cards + '</span></li>').join('') + '</ul>' :
        '<p>Карточек пока нет.</p>') + '</section>' +
    '<section class="card panel"><h2 class="lbl">Неделя вперёд</h2>' +
      '<div class="rv-week" role="img" aria-label="Карточек по дням: ' + week.map((n, i) => days[i] + ' ' + n).join(', ') + '">' +
      week.map((n, i) => '<div><b style="height:' + Math.max(2, Math.round(n / max * 72)) + 'px" class="' + (i === 0 ? 'now' : '') + (n ? '' : ' none') + '"></b><span>' + days[i] + '</span><small>' + n + '</small></div>').join('') + '</div></section>' +
    '<section class="card panel"><h2 class="lbl">Откуда карточки</h2><p>Вопросы, где первая попытка была с ошибкой, и фразы «Скажи на собесе», отправленные кнопкой «+ В карточки». ' +
      'Оценка решает, когда карточка вернётся: «Помню» подряд — всё реже.</p></section>' +
  '</aside>';
}

function wire(card) {
  const show = document.getElementById('show');
  if (show) show.addEventListener('click', () => { shown = true; render(); document.querySelector('.rv-grades button').focus(); });
  app.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => grade(card, b.getAttribute('data-g'))));
}

// Оценка двигает карточку: новое значение уходит на сервер, он сливает по свежести.
async function grade(card, g) {
  const v = nextCard(card.value, g, card.course.review);
  try {
    await api('/api/progress/' + encodeURIComponent(card.course.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: { [card.key]: { v, at: Date.now() } } })
    });
  } catch (e) {
    alert('Не получилось сохранить оценку: ' + e.message);
    return;
  }
  pos++; graded++; shown = false;
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, select'))) return;
  const card = queue[pos];
  if (!card) return;
  if (e.key === ' ' && !shown) { e.preventDefault(); shown = true; render(); }
  else if (shown && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); grade(card, ['again', 'hard', 'good'][+e.key - 1]); }
});
