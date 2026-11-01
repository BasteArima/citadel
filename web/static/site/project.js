// Страница проекта (решение 0016): уровни и шаги, а по #<шаг> — ТЗ шага.
// Проект хранится как курс особого вида; ТЗ шага — один блок spec, формат — docs/dev/CONTENT-FORMAT.md.
// Отметки: done:<шаг> — дата закрытия (0 — вернули в работу), seen:<шаг>:d<N> — пункт «Готово, когда»,
// seen:<шаг>:h<N> — открытая подсказка, seen:<шаг>:repo — ссылка на коммит, card:<шаг>:<id> — карточка.
import { api, esc, today, addDays, courseText } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';
import { loadState } from '../engine/progress.js';
import { levelBars, HELP, helpRanges } from './projects-ui.js';

initSiteSearch();

const app = document.getElementById('app');
const top = siteTop('projects');
const id = decodeURIComponent(location.pathname.split('/')[2] || '');

let P, S, links = {}, levels = [], steps = [], picked = null;
const opened = {}; // раскрытые ответы и подводные камни: переживают перерисовку

function index() {
  levels = (P.root || []).filter((n) => n.kind === 'section').map((s, l) => {
    const level = { node: s, idx: l, steps: [] };
    (s.children || []).forEach((n, k) => {
      const step = { node: n, level, num: (l + 1) + '.' + (k + 1), spec: (n.blocks || []).find((b) => b.type === 'spec') || null };
      level.steps.push(step);
      steps.push(step);
    });
    return level;
  });
}

const T = (html) => courseText(html, P);
const closed = (st) => !!S.get('done:' + st.node.id);
const current = () => steps.find((st) => st.spec && !closed(st)) || null;
const brief = (st) => !st.spec || !(st.spec.hints || []).length;
const closedIn = (lv) => lv.steps.filter(closed).length;

function draw(focus) {
  const st = steps.find((x) => x.node.id === decodeURIComponent(location.hash.slice(1)));
  app.innerHTML = st ? stepPage(st) : homePage();
  if (focus) { const f = app.querySelector(focus); if (f) f.focus(); }
}

// ── страница проекта ──

function homePage() {
  const now = current();
  const done = steps.filter(closed).length;
  if (picked === null) picked = now ? now.level.idx : 0;
  const ranges = helpRanges(levels.map((l) => l.node.tag));
  return '<main class="site-main pj">' +
    '<div class="pj-head"><div class="pj-head-l"><a href="/projects">← Все проекты</a><h1>' + esc(P.title) + '</h1>' +
      (P.about ? '<p class="site-sub">' + T(P.about) + '</p>' : '') + '</div>' +
      '<div class="pj-count"><span>шагов закрыто</span><b>' + String(done).padStart(2, '0') + '</b><span>из ' + steps.length + '</span></div></div>' +
    (now ? '<section class="card pj-now" aria-label="Сейчас"><div><div class="lbl pj-acc">Сейчас</div><h2>Шаг ' + now.num + '. ' + esc(now.node.title) + '</h2>' +
        '<p>' + (now.node.time ? esc(now.node.time) + '. ' : '') + 'Один шаг за заход: закрыл — остановись, даже если идёт легко.</p></div>' +
        '<a class="btn btn-l pri" href="#' + esc(now.node.id) + '">Открыть ТЗ</a></section>'
      : '<section class="card pj-now"><div><div class="lbl pj-acc">Проект пройден</div><h2>Все шаги закрыты</h2><p>Звено выковано. Самое время рассказать об этом сервисе на собеседовании.</p></div></section>') +
    '<section aria-labelledby="pj-lv" class="pj-sec"><h2 id="pj-lv">Уровни</h2>' +
      '<div class="pj-cols" role="group" aria-label="Выбор уровня">' + levels.map(levelButton).join('') + '</div>' +
      levelPanel(levels[picked], now) + '</section>' +
    (ranges.length ? '<section aria-labelledby="pj-help" class="pj-sec"><div><h2 id="pj-help">Помощи сначала много, потом меньше</h2>' +
        '<p class="site-sub">В начале ты ещё не видел, как это пишется, поэтому ТЗ подробное, а в подсказках есть код. К концу задача выглядит как настоящий тикет.</p></div>' +
        '<div class="pj-grid">' + ranges.map((r) => '<div class="card pj-tier"><div class="pj-acc pj-tier-n">Уровни ' + r.from + (r.to > r.from ? '–' + r.to : '') + '</div><b>' + esc(HELP[r.tag].title) + '</b><p>' + esc(HELP[r.tag].text) + '</p></div>').join('') + '</div></section>' : '') +
    ((P.howto || []).length ? '<section aria-labelledby="pj-rules" class="pj-sec"><h2 id="pj-rules">Правила, чтобы не бросить</h2><div class="pj-grid">' +
        P.howto.map((r) => '<div class="card pj-rule">' + T(r) + '</div>').join('') + '</div></section>' : '') +
    '</main>';
}

function levelButton(lv) {
  const now = current();
  return '<button type="button" class="pj-col" data-level="' + lv.idx + '" aria-pressed="' + (lv.idx === picked) + '">' +
    levelBars(lv.steps.length, closedIn(lv), now && now.level === lv ? closedIn(lv) : -1) +
    '<span class="pj-col-n">' + String(lv.idx + 1).padStart(2, '0') + '</span><span class="pj-col-t">' + esc(lv.node.title) + '</span></button>';
}

function levelPanel(lv, now) {
  const s = lv.node, help = HELP[s.tag];
  return '<div class="pj-level"><article class="card pj-info">' +
      '<div class="lbl">Уровень ' + (lv.idx + 1) + ' · закрыто ' + closedIn(lv) + ' из ' + lv.steps.length + '</div>' +
      '<h3>' + esc(s.title) + '</h3>' +
      (s.about ? '<p class="pj-pain">' + T(s.about) + '</p>' : '') +
      (s.lead ? '<p>' + T(s.lead) + '</p>' : '') +
      (help ? '<ul class="chips"><li class="chip acc">' + esc(help.title) + '</li></ul>' : '') +
      (P.labels && P.labels.interview === s.id ? '<p class="note-ok">С этого уровня пора ходить на собеседования: настоящий собес находит дыры быстрее самопроверки.</p>' : '') +
    '</article><ol class="card pj-steps" aria-label="Шаги уровня">' + lv.steps.map((st) => {
      const isNow = st === now, done = closed(st);
      return '<li><a class="pj-step-row' + (isNow ? ' now' : '') + '" href="#' + esc(st.node.id) + '"' + (isNow ? ' aria-current="step"' : '') + '>' + dot(done, isNow) +
        '<span class="pj-step-t"><small>Шаг ' + st.num + '</small><b>' + esc(st.node.title) + '</b></span>' +
        (st.spec && st.spec.kind === 'incident' ? '<span class="chip pj-inc">инцидент</span>' : '') +
        '<span class="pj-step-k">' + (done ? 'закрыт' : isNow ? 'сейчас' : brief(st) ? 'бриф' : 'полное ТЗ') + '</span></a></li>';
    }).join('') + '</ol></div>';
}

const dot = (done, now) => '<span class="pj-dot' + (done ? ' ok' : now ? ' cur' : '') + '" aria-hidden="true"></span>';

// ── страница шага ──

function stepPage(st) {
  const lv = st.level, sp = st.spec || { done: [] }, nid = st.node.id, now = current();
  const help = HELP[lv.node.tag];
  const strip = '<div class="cont-strip" role="img" aria-label="Закрыто ' + closedIn(lv) + ' из ' + lv.steps.length + '">' +
    lv.steps.map((x) => '<i class="' + (closed(x) ? 'ok' : x === now ? 'cur' : '') + '"></i>').join('') + '</div>';
  return '<div class="pj-layout"><aside class="pj-side" aria-label="Шаги уровня">' +
      '<a class="pj-back" href="#">← ' + esc(P.title) + '</a>' +
      '<div class="pj-side-h"><div class="lbl">Уровень ' + (lv.idx + 1) + ' из ' + levels.length + '</div><b>' + esc(lv.node.title) + '</b>' + strip + '</div>' +
      '<ol>' + lv.steps.map((x) => '<li><a class="pj-step-row' + (x === st ? ' now' : '') + '" href="#' + esc(x.node.id) + '"' + (x === st ? ' aria-current="step"' : '') + '>' + dot(closed(x), x === st) +
        '<span class="pj-step-t"><small>Шаг ' + x.num + '</small><b>' + esc(x.node.title) + '</b></span></a></li>').join('') + '</ol>' +
    '</aside><main class="pj-main"><article class="pj-article">' +
      '<div class="pj-phone"><a href="#">← ' + esc(P.title) + '</a><span>Уровень ' + (lv.idx + 1) + ' · ' + esc(lv.node.title) + '</span>' + strip + '</div>' +
      '<div class="pj-title"><div class="pj-eyebrow"><b>Шаг ' + st.num + '</b>' + (st.node.time ? '<span>' + esc(st.node.time) + '</span>' : '') + (help ? '<span>' + esc(help.title) + '</span>' : '') + (closed(st) ? '<span class="pj-ok">закрыт</span>' : '') + '</div>' +
        '<h1>' + esc(st.node.title) + '</h1>' +
        (st.spec ? '<div class="card pj-task"><div class="lbl' + (sp.kind === 'incident' ? ' pj-inc-l' : '') + '">' + (sp.kind === 'incident' ? 'Инцидент' : 'Задача от техлида') + '</div><p>' + T(sp.task) + '</p></div>' : '') + '</div>' +
      (st.spec && brief(st) ? '<p class="pj-note">Это бриф: цель и критерий готовности. Полное ТЗ с файлами, API и подсказками появится, когда дойдёшь до шага: так оно учтёт код, который ты уже написал.</p>' : '') +
      list('Что построить', sp.build) +
      apiTable(sp.api) +
      (sp.files && sp.files.length ? '<section class="pj-sec"><h2>Файлы</h2><ul class="pj-plain">' + sp.files.map((f) => '<li>' + T(f) + '</li>').join('') + '</ul></section>' : '') +
      whereToLook(sp) +
      hints(sp, nid) +
      doneList(sp, nid) +
      (sp.traps && sp.traps.length ? '<details class="card pj-traps" data-open="traps"' + (opened.traps ? ' open' : '') + '><summary><span>Подводные камни</span><small>Лучше смотреть, когда код уже работает</small></summary><ul class="pj-list">' + sp.traps.map((t) => '<li>' + T(t) + '</li>').join('') + '</ul></details>' : '') +
      (sp.skip && sp.skip.length ? '<section class="pj-sec pj-skip"><h2>Чего на этом шаге не делаем</h2><ul class="pj-list">' + sp.skip.map((t) => '<li>' + T(t) + '</li>').join('') + '</ul></section>' : '') +
      (st.spec ? defense(st, sp, nid) : '') +
    '</article></main></div>';
}

function list(title, items) {
  if (!items || !items.length) return '';
  return '<section class="pj-sec"><h2>' + title + '</h2><ul class="pj-list">' + items.map((t) => '<li>' + T(t) + '</li>').join('') + '</ul></section>';
}

function apiTable(api_) {
  if (!api_ || !api_.length) return '';
  return '<section class="pj-sec"><h2>Контракт API</h2><div class="card pj-api"><table><thead><tr><th>Запрос</th><th>Ответ</th></tr></thead><tbody>' +
    api_.map((a) => '<tr><td>' + T(a.req) + '</td><td>' + T(a.res) + '</td></tr>').join('') + '</tbody></table></div></section>';
}

function whereToLook(sp) {
  const known = (sp.lessons || []).map((r) => links[r.course + ':' + r.id]).filter(Boolean);
  const search = sp.search || [];
  if (!known.length && !search.length) return '';
  return '<section class="pj-sec"><h2>Где разобраться</h2><div class="pj-grid">' +
    (known.length ? '<div class="card pj-where"><div class="lbl">Пригодится из курсов</div><ul>' + known.map((l) => {
      const name = 'Урок ' + l.n + '. ' + esc(l.title);
      return '<li>' + (l.ready ? '<a href="/c/' + encodeURIComponent(l.course) + '/#' + encodeURIComponent(l.id) + '">' + name + '</a>' : name + '<small>пока пишется</small>') + '</li>';
    }).join('') + '</ul></div>' : '') +
    (search.length ? '<div class="card pj-where"><div class="lbl">Что искать</div><ul>' + search.map((q) => '<li>' + esc(q) + '</li>').join('') + '</ul>' +
      '<p>Нейронку спрашивай так: «объясни, как это работает, но код не пиши».</p></div>' : '') +
    '</div></section>';
}

function hints(sp, nid) {
  const hs = sp.hints || [];
  if (!hs.length) return '';
  let open = 0;
  while (open < hs.length && S.get('seen:' + nid + ':h' + open)) open++;
  return '<section class="pj-sec"><div class="pj-sec-h"><h2>Подсказки</h2><span>Открыто ' + open + ' из ' + hs.length + '. Это не штрафуется</span></div>' +
    hs.map((h, i) => {
      if (i < open) return '<div class="card pj-hint"><b>' + (i + 1) + '. ' + esc(h.title) + '</b><p>' + T(h.text) + '</p>' + (h.code ? '<pre><code>' + esc(h.code) + '</code></pre>' : '') + '</div>';
      if (i === open) return '<button type="button" class="pj-hint-b" data-hint="' + i + '">Показать подсказку ' + (i + 1) + ': ' + esc(h.title) + '</button>';
      return '<div class="pj-hint-l">Подсказка ' + (i + 1) + ' откроется после предыдущей</div>';
    }).join('') + '</section>';
}

const doneCount = (sp, nid) => (sp.done || []).filter((_, i) => S.get('seen:' + nid + ':d' + i)).length;

function doneList(sp, nid) {
  const items = sp.done || [];
  if (!items.length) return '';
  return '<section class="pj-sec"><div class="pj-sec-h"><h2>Готово, когда</h2><span>' + doneCount(sp, nid) + ' из ' + items.length + '</span></div><div class="card pj-checks">' +
    items.map((t, i) => '<label><input type="checkbox" id="pj-d' + i + '" data-check="' + i + '"' + (S.get('seen:' + nid + ':d' + i) ? ' checked' : '') + '><span>' + T(t) + '</span></label>').join('') + '</div></section>';
}

function defense(st, sp, nid) {
  const viva = sp.viva || [], next = steps[steps.indexOf(st) + 1];
  const ready = doneCount(sp, nid) === (sp.done || []).length;
  const repo = S.get('seen:' + nid + ':repo') || '';
  return '<section class="card pj-defense"><div><h2>' + (viva.length ? 'Защита' : 'Закрыть шаг') + '</h2>' +
    (viva.length ? '<p>Покажи код и ответь своими словами. Не смог объяснить — шаг остаётся открытым, это нормально.</p>' : '') + '</div>' +
    (viva.length ? '<ul class="pj-viva">' + viva.map((q) => {
      const key = 'card:' + nid + ':' + q.id, has = !!S.cards[key];
      return '<li><div class="pj-viva-q"><span>' + T(q.q) + '</span><button type="button" class="btn pj-card' + (has ? ' on' : '') + '" id="pj-c-' + esc(q.id) + '" data-card="' + esc(q.id) + '" aria-pressed="' + has + '">' + (has ? 'В карточках' : '+ В карточки') + '</button></div>' +
        '<details data-open="' + esc(q.id) + '"' + (opened[q.id] ? ' open' : '') + '><summary>Ответ для самопроверки</summary><p>' + T(q.a) + '</p></details></li>';
    }).join('') + '</ul>' : '') +
    '<div class="pj-repo"><label for="pj-repo">Ссылка на коммит или PR</label><input id="pj-repo" type="url" maxlength="180" placeholder="https://github.com/…" value="' + esc(repo) + '"></div>' +
    (closed(st)
      ? '<div class="pj-closed"><span><b>Шаг закрыт.</b> На сегодня всё, даже если идёт легко.</span><div class="row"><button type="button" class="btn btn-l" id="pj-reopen" data-act="reopen">Вернуть в работу</button>' +
        (next ? '<a class="btn btn-l pri" href="#' + esc(next.node.id) + '">Шаг ' + next.num + ' →</a>' : '') + '</div></div>'
      : '<div class="row"><button type="button" class="btn btn-l pri" id="pj-close" data-act="close"' + (ready ? '' : ' disabled') + '>Закрыть шаг</button><span class="pj-close-h">' +
        (ready ? 'Закрывай после защиты, а не после первого зелёного запуска' : 'Сначала отметь все пункты в «Готово, когда»') + '</span></div>') +
    '</section>';
}

// ── действия ──

function stepNow() { return steps.find((x) => x.node.id === decodeURIComponent(location.hash.slice(1))); }

function onClick(e) {
  const lv = e.target.closest('[data-level]');
  if (lv) { picked = +lv.dataset.level; draw('[data-level="' + picked + '"]'); return; }
  const st = stepNow();
  if (!st) return;
  const nid = st.node.id;
  const h = e.target.closest('[data-hint]');
  if (h) { S.put('seen:' + nid + ':h' + h.dataset.hint, 1); draw(); return; }
  const c = e.target.closest('[data-card]');
  if (c) {
    const key = 'card:' + nid + ':' + c.dataset.card, R = P.review && P.review.length ? P.review : [1, 3, 7];
    if (S.cards[key]) S.dropCard(key); else S.putCard(key, { d: addDays(today(), R[0]), i: R[0], s: 0 });
    draw('#pj-c-' + CSS.escape(c.dataset.card));
    return;
  }
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'close') { S.put('done:' + nid, today()); draw('#pj-reopen'); return; }
  if (a && a.dataset.act === 'reopen') { S.put('done:' + nid, 0); draw('#pj-close'); }
}

function onChange(e) {
  const st = stepNow();
  if (!st) return;
  const nid = st.node.id;
  if (e.target.dataset.check !== undefined) {
    S.put('seen:' + nid + ':d' + e.target.dataset.check, e.target.checked ? 1 : 0);
    draw('#pj-d' + e.target.dataset.check);
  } else if (e.target.id === 'pj-repo') {
    S.put('seen:' + nid + ':repo', e.target.value.trim().slice(0, 180));
  }
}

// Запуск — в конце файла: функциям выше нужны объявленные рядом с ними константы.
try {
  const [user, project, lessonLinks, ov] = await Promise.all([
    api('/api/me'),
    api('/api/courses/' + encodeURIComponent(id)),
    api('/api/courses/' + encodeURIComponent(id) + '/links'),
    api('/api/overview?today=' + today())
  ]);
  P = project;
  links = lessonLinks;
  document.title = P.title + ' · Citadel';
  top.update(user, ov.courses.reduce((s, c) => s + c.due, 0));
  index();
  S = loadState(P.id, {
    noUi: true, // тему на этой странице меняет шапка
    onRemote: () => { if (!document.activeElement || document.activeElement.id !== 'pj-repo') draw(); },
    onSignedOut: () => { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); }
  });
  S.startSync();
  app.addEventListener('click', onClick);
  app.addEventListener('change', onChange);
  app.addEventListener('toggle', (e) => { if (e.target.dataset && e.target.dataset.open) opened[e.target.dataset.open] = e.target.open; }, true);
  addEventListener('hashchange', () => { draw(); scrollTo(0, 0); });
  draw();
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить проект: ' + esc(e.message) + '</p></main>';
}
