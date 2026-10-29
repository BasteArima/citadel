// Движок курса: шапка, меню, маршруты, страницы урока, главная, словарь, страницы курса,
// озвучка и повторения. Курс приходит из API в формате v1, блоки рисуют модули из blocks/.
import { el, esc, ic, IC, today, addDays, hash, seeded, shuffle, plural, copyText, reduceMotion, onLeave, leave, readable } from './util.js';
import { renderBlock, speakables, questionsOf, renderQuestion } from './blocks/index.js';
import { indexCourse } from './course.js';
import { loadState } from './progress.js';
import { initRich, rich, trackTerms, takeTerms } from './rich.js';
import { linkIcon, metalName } from '../site/shared.js';

// course — курс v1, user — кто вошёл, catalog — список курсов (для «Опирается на» и «Что дальше»).
export function start(course, user, catalog) {
  const X = indexCourse(course);
  const C = course;
  const STAGES = X.review;
  const S = loadState(C.id, STAGES, {
    onRemote: () => route(),
    onStatus: () => syncUi(),
    onSignedOut: () => { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); }
  });
  const save = S.save;
  const ALL = X.all, TOTAL = X.total;
  const lessonLabel = (C.labels && C.labels.lesson) || 'Урок';
  const blockCtx = { tool: C.tool };
  initRich(X);

  const meta = X.meta, ready = X.ready;
  const isDone = (id) => !!(S.lessons[id] && S.lessons[id].done);
  const doneCount = (list) => list.filter((l) => isDone(l.id)).length;
  function nextReady(afterN) {
    for (let i = 0; i < ALL.length; i++) if (ALL[i].n > afterN && ready(ALL[i].id)) return ALL[i];
    return null;
  }
  function firstTodo() {
    for (let i = 0; i < ALL.length; i++) if (ready(ALL[i].id) && !isDone(ALL[i].id)) return ALL[i];
    return null;
  }
  // «через день, потом ещё через 3 и 7 дней» — из интервалов повторений курса
  function daysList(ds) { return ds.length > 1 ? ds.slice(0, -1).join(', ') + ' и ' + ds[ds.length - 1] : String(ds[0]); }
  function inDays(d) { return d === 1 ? 'через день' : 'через ' + d + ' ' + plural(d, 'день', 'дня', 'дней'); }

  // ── тема ──
  function applyTheme() {
    const r = document.documentElement;
    if (S.theme === 'light' || S.theme === 'dark') r.setAttribute('data-theme', S.theme);
    else r.removeAttribute('data-theme');
  }

  // ── шапка ──
  const top = document.getElementById('top');
  const side = document.getElementById('side');
  const page = document.getElementById('page');
  let current = '', currentPart = 1;

  function renderTop() {
    const due = dueList().length, isLesson = !!(current && ready(current));
    const themes = [['auto', 'Авто', ''], ['light', 'Светлая', IC.sun], ['dark', 'Тёмная', IC.moon]];
    // общая шапка сайта, как в каталоге и профиле; курс и путь внутри него — в меню слева
    top.innerHTML =
      '<button type="button" class="tb-ic tb-menu" data-act="menu" aria-controls="side" aria-expanded="' + side.classList.contains('open') + '" aria-label="Меню уроков">' + ic(IC.menu, 20) + '</button>' +
      '<a class="tb-home" href="/"><svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><rect x="2" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--dim)" stroke-width="2.5"/><rect x="13" y="4" width="15" height="12" rx="6" fill="none" stroke="var(--acc-fill)" stroke-width="2.5"/></svg><span>Citadel</span></a>' +
      '<nav class="tb-nav" aria-label="Разделы"><a href="/" aria-current="page">Курсы</a><a href="/profile">Профиль</a></nav>' +
      '<div class="tb-tools">' +
        (due ? '<a class="tb-due" href="#review" title="Повторить сегодня">' + ic(IC.repeat) + '<span>Повторить</span><b>' + due + '</b></a>' : '') +
        (isLesson ? '<button type="button" class="tb-ic tb-focus" data-act="focus" aria-pressed="' + !!S.ui.focus + '" aria-label="Режим чтения: скрыть меню" title="Режим чтения">' + ic(IC.focus, 18) + '</button>' : '') +
        '<div class="tb-theme" role="group" aria-label="Тема">' + themes.map((t) =>
          '<button type="button" data-theme-set="' + t[0] + '" aria-pressed="' + (S.theme === t[0]) + '"' +
          (t[2] ? ' aria-label="' + t[1] + '" title="' + t[1] + '">' + ic(t[2]) : '>' + t[1]) + '</button>').join('') + '</div>' +
        '<a class="tb-me" href="/profile" aria-label="Профиль: ' + esc(user.name) + '">' + esc(user.name.slice(0, 1).toUpperCase()) + '</a>' +
      '</div>';
  }
  top.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (b) { S.theme = b.getAttribute('data-theme-set'); save(); applyTheme(); renderTop(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.getAttribute('data-act') === 'menu') {
      const open = !side.classList.contains('open');
      side.classList.toggle('open', open);
      a.setAttribute('aria-expanded', String(open));
    }
    if (a.getAttribute('data-act') === 'focus') { S.ui.focus = !S.ui.focus; save(); applyFocus(); renderTop(); }
  });
  function closeMenu() {
    side.classList.remove('open');
    const b = top.querySelector('[data-act="menu"]');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  // режим чтения: только на странице урока, прячет меню и оставляет колонку текста
  function applyFocus() {
    document.body.classList.toggle('reading', !!(S.ui.focus && current && ready(current)));
  }

  // ── меню ──
  function secOpen(sec) {
    if (sec.id in S.ui.open) return S.ui.open[sec.id];
    const m = meta(current);
    return m ? m.sec === sec : sec === X.sections[0];
  }
  function sideLink(id, d, t, extra) {
    return '<li><a class="sd-a" href="#' + id + '"' + (current === id ? ' aria-current="page"' : '') + '>' + ic(d) +
      '<span class="sd-t">' + t + '</span>' + (extra ? '<span class="sd-cnt">' + extra + '</span>' : '') + '</a></li>';
  }
  function lessonItem(l) {
    const cur = current === l.id, ok = isDone(l.id);
    let h = '<li><a class="sd-l' + (ok ? ' ok' : '') + (cur ? ' cur' : '') + '" href="#' + l.id + '"' + (cur ? ' aria-current="page"' : '') + '>' +
      '<span class="sd-st">' + (ok ? ic(IC.check, 12) : cur ? '<i></i>' : '') + '</span><span class="sd-t">' + l.n + ' · ' + esc(l.t) + '</span></a></li>';
    const les = X.lesson(l.id), ps = cur ? les.parts : null;
    if (ps) {
      h += '<li><ol class="sd-parts">' + ps.map((p, k) => {
        const done = partDone(les, k), here = currentPart === k + 1;
        return (p.kind === 'practice' && ps[k - 1].kind === 'theory' ? '<li class="sd-pl">Практика</li>' : '') +
          '<li><a class="sd-p ' + p.kind + (done ? ' ok' : '') + '" href="#' + l.id + '/' + (k + 1) + '"' + (here ? ' aria-current="step"' : '') + '>' +
          '<span class="sd-dot">' + (done ? ic(IC.check, 12) : '') + '</span><span class="sd-t">' + esc(p.title) + '</span>' +
          '<span class="sd-min">' + partMin(les, k) + ' мин</span></a></li>';
      }).join('') + '</ol></li>';
    }
    return h;
  }
  // Пройденные уроки подряд (кроме текущего) сворачиваются в одну строку, неготовые подряд — тоже.
  function sectionItems(sec) {
    let out = '', i = 0;
    const ls = sec.lessons;
    while (i < ls.length) {
      const l = ls[i];
      let j = i;
      if (ready(l.id) && isDone(l.id) && current !== l.id) {
        while (j + 1 < ls.length && ready(ls[j + 1].id) && isDone(ls[j + 1].id) && current !== ls[j + 1].id) j++;
      } else if (!ready(l.id)) {
        while (j + 1 < ls.length && !ready(ls[j + 1].id)) j++;
      }
      const run = ls.slice(i, j + 1), range = run[0].n + (run.length > 1 ? '–' + run[run.length - 1].n : '');
      if (!ready(l.id)) {
        out += '<li><div class="sd-soon"><span class="sd-st"></span><span class="sd-t">' +
          (run.length > 1 ? range + ' · готовятся' : l.n + ' · ' + esc(l.t) + ' · скоро') + '</span></div></li>';
      } else if (run.length > 1) {
        const key = sec.id + ':' + run[0].n, open = !!S.ui.runs[key];
        out += '<li><button type="button" class="sd-run" data-run="' + key + '" aria-expanded="' + open + '"><span class="sd-t">Уроки ' + range + ' пройдены</span>' + ic(open ? IC.down : IC.chev, 14) + '</button></li>';
        if (open) run.forEach((x) => { out += lessonItem(x); });
      } else {
        out += lessonItem(l);
      }
      i = j + 1;
    }
    return out;
  }
  function renderSide() {
    const done = doneCount(ALL);
    let h = '<div class="sd-prog"><div class="sd-prog-t"><span>Курс</span><span>' + done + ' из ' + TOTAL + '</span></div>' +
      '<div class="bar"><i style="width:' + (done / TOTAL * 100) + '%"></i></div></div>' +
      '<ul class="sd-links"><li><a class="sd-a" href="/">' + ic(IC.back) + '<span class="sd-t">Все курсы</span></a></li>' +
      '<li><a class="sd-a sd-course" href="#"' + (current === '' ? ' aria-current="page"' : '') + '>' + ic(IC.home) + '<span class="sd-t">' + esc(C.title) + '</span></a></li>' +
      X.pages.map((p) => sideLink(p.id, IC[p.icon] || IC.book, esc(p.title))).join('') +
      (X.hasGlossary ? sideLink('glossary', IC.book, 'Словарь') : '') + '</ul>';
    X.sections.forEach((sec) => {
      const open = secOpen(sec);
      h += '<div class="sd-sec"><button type="button" class="sd-sec-h" data-sec="' + sec.id + '" aria-expanded="' + open + '">' +
        ic(open ? IC.down : IC.chev, 14) + '<span class="sd-t">' + esc(sec.name) + '</span><span class="sd-cnt">' + doneCount(sec.lessons) + ' / ' + sec.lessons.length + '</span></button>' +
        (open ? '<ul class="sd-list">' + sectionItems(sec) + '</ul>' : '') + '</div>';
    });
    h += '<div class="sd-user"><div class="sd-user-t"><span class="sd-user-n">' + esc(user.name) + '</span>' +
      '<span class="sd-sync" id="sd-sync" role="status"></span></div>' +
      '<button type="button" class="btn sd-out" data-act="logout">Выйти</button></div>';
    side.innerHTML = h;
    syncUi();
  }
  // состояние синхронизации прогресса — под именем в меню
  function syncUi() {
    const s = document.getElementById('sd-sync');
    if (!s) return;
    const st = S.sync.state;
    s.className = 'sd-sync' + (st === 'offline' || st === 'signed-out' ? ' warn' : '');
    s.textContent = {
      busy: 'синхронизирую…',
      ok: 'прогресс сохранён на сервере',
      offline: 'нет связи: прогресс сохранён здесь и уйдёт позже',
      'signed-out': 'нужно войти снова'
    }[st] || '';
  }
  side.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="logout"]')) {
      fetch('/api/logout', { method: 'POST' }).finally(() => { location.href = '/login'; });
      return;
    }
    const s = e.target.closest('[data-sec]');
    if (s) { const sec = X.sections.find((x) => x.id === s.getAttribute('data-sec')); S.ui.open[sec.id] = !secOpen(sec); save(); renderSide(); return; }
    const r = e.target.closest('[data-run]');
    if (r) { const k = r.getAttribute('data-run'); S.ui.runs[k] = !S.ui.runs[k]; save(); renderSide(); return; }
    if (e.target.closest('a')) closeMenu();
  });

  // ── прохождение ──
  // хранилище вопроса: решённые вопросы урока лежат в st.t по id вопроса
  function qStore(st, q) {
    return { solved: () => !!st.t[q.id], solve: () => { st.t[q.id] = 1; save(); } };
  }
  // Часть теории засчитывается ответами на её вопросы «Проверь себя» (их отдают модули блоков).
  // Если своих вопросов у части нет — когда страница дочитана до конца, но не в момент открытия.
  // «Сделай руками» — ответами на «Проверь, что понял»; «Проверка» — когда пройден весь урок.
  function partQuestions(les, k) {
    const p = les.parts[k];
    if (p.type === 'hands') return p.hands ? questionsOf(p.hands) : [];
    if (p.type === 'test') return [];
    return p.questions.concat(...p.blocks.map(questionsOf));
  }
  function partDone(les, k) {
    const st = S.lessons[les.id] || {}, p = les.parts[k];
    if (p.type === 'test') return !!st.done;
    const own = partQuestions(les, k);
    if (own.length) return own.every((q) => st.t && st.t[q.id]);
    return !!(st.seen && st.seen[k]);
  }
  function markIfDone(les, st) {
    if (!st.done && les.questions.every((q) => st.t[q.id])) {
      st.done = today(); st.rev = STAGES.map(() => 0); save();
    }
  }

  // время чтения: ~150 слов в минуту по тексту блоков; практика — по числу шагов и вопросов
  function textOf(x) {
    if (typeof x === 'string') return x.replace(/<[^>]+>/g, ' ');
    if (Array.isArray(x)) return x.map(textOf).join(' ');
    if (x && typeof x === 'object') return Object.keys(x).map((k) => (k === 'els' || k === 'type' || k === 'kind') ? '' : textOf(x[k])).join(' ');
    return '';
  }
  function partMin(les, k) {
    const p = les.parts[k];
    if (p.type === 'hands') return Math.max(5, p.hands.steps.length * 3);
    if (p.type === 'test') return Math.max(3, Math.round(p.questions.length * 0.75));
    const words = textOf(p.blocks).split(/\s+/).filter(Boolean).length + (k === 0 ? textOf([les.lead, les.simple]).split(/\s+/).length : 0);
    return Math.max(1, Math.round(words / 150));
  }

  // «Простыми словами» — в начале урока. Фраза «Скажи на собесе» живёт в правой колонке:
  // берём её из les.say или из абзаца simple, который начинается с «Как сказать на собесе:».
  const SAY_RE = /^\s*<b>\s*Как сказать на собесе:?\s*<\/b>\s*/;
  function sayOf(les) {
    if (les.say) return les.say;
    const p = (les.simple || []).find((x) => SAY_RE.test(x));
    return p ? p.replace(SAY_RE, '') : '';
  }
  // Возвращает элементы для озвучки.
  function appendSimple(to, les) {
    const lead = el('p', 'lead', rich(les.lead));
    to.appendChild(lead);
    const paras = (les.simple || []).filter((p) => !SAY_RE.test(p));
    if (!paras.length) return [lead];
    const box = el('section', 'simple');
    box.setAttribute('aria-label', 'Коротко');
    box.innerHTML = '<div class="simple-b"><div class="kind">Простыми словами</div>' + paras.map((p) => '<p>' + rich(p) + '</p>').join('') + '</div>';
    to.appendChild(box);
    return [lead].concat(readable(box.querySelector('.simple-b')));
  }

  // Урок: колонка текста и правая колонка. На узком экране правая уходит под текст.
  function lessonFrame() {
    const frame = el('div', 'ls'), main = el('div', 'ls-main'), rail = el('aside', 'ls-rail');
    rail.setAttribute('aria-label', 'К уроку');
    frame.appendChild(main); frame.appendChild(rail);
    page.appendChild(frame);
    return { main, rail };
  }

  // Правая колонка: на что опирается урок, термины на странице, фраза для собеса.
  function fillRail(rail, les, termsLabel) {
    const deps = (les.node.deps || []).map(meta).filter(Boolean);
    if (deps.length) {
      rail.appendChild(el('section', 'card rail-card', '<h2 class="lbl">Опирается на</h2>' +
        deps.map((d) => ready(d.id) ? '<a href="#' + d.id + '">' + lessonLabel + ' ' + d.n + ' · ' + esc(d.t) + '</a>' : '<span>' + lessonLabel + ' ' + d.n + ' · ' + esc(d.t) + ' (скоро)</span>').join('') + '</section>'));
    }
    const keys = takeTerms();
    if (keys.length) {
      rail.appendChild(el('section', 'card rail-card', '<h2 class="lbl">' + termsLabel + ' · ' + keys.length + '</h2><div class="rail-terms">' +
        keys.map((k) => '<button type="button" class="term chip" data-k="' + k + '">' + esc(C.glossary[k].t) + '</button>').join('') + '</div>'));
    }
    const say = sayOf(les);
    if (say) {
      const card = el('section', 'card rail-card rail-say', '<h2 class="lbl">Скажи на собесе</h2><p>' + rich(say) + '</p>' +
        '<button type="button" class="btn say-cp">' + ic(IC.copy) + '<span>Скопировать</span></button>');
      const cp = card.querySelector('.say-cp');
      cp.addEventListener('click', () => copyText(card.querySelector('p').innerText, cp, card.querySelector('p')));
      rail.appendChild(card);
    }
  }

  // Блоки по порядку; возвращает элементы, которые читает озвучка.
  function appendBlocks(to, blocks, ctx) {
    const voice = [];
    blocks.forEach((b) => {
      const node = renderBlock(b, ctx || blockCtx);
      voice.push(...speakables(b, node));
      to.appendChild(node);
    });
    return voice;
  }

  // partsMode: вопросы, привязанные к частям теории, на финальной странице не повторяются,
  // но считаются в общем «Решено N из M».
  function appendTest(to, les, st, partsMode, onChange) {
    if (les.summary) {
      to.appendChild(el('h2', null, 'Главное из урока'));
      const ul = el('ul', 'list');
      les.summary.forEach((s) => ul.appendChild(el('li', null, rich(s))));
      to.appendChild(ul);
    }
    const shown = les.questions.filter((q) => !(partsMode && les.partOf[q.id]));
    const inParts = les.questions.length - shown.length;
    to.appendChild(el('h2', null, 'Проверка'));
    to.appendChild(el('p', null, 'Вопрос засчитывается после верного ответа, урок — когда засчитаны все вопросы' +
      (inParts ? ', включая ' + inParts + ' ' + plural(inParts, 'вопрос', 'вопроса', 'вопросов') + ' «Проверь себя» в частях теории' : '') +
      '. После каждого ответа появляется объяснение: читай его, даже если ответил верно. Ошибся — разберись по объяснению и ответь ещё раз.'));
    const tally = el('div', 'tally');
    const doneBox = el('div');
    function upd() {
      const solved = les.questions.filter((q) => st.t[q.id]).length;
      tally.textContent = 'Решено ' + solved + ' из ' + les.questions.length + (inParts ? ' — вместе с вопросами в частях теории' : '');
      markIfDone(les, st);
      renderSide();
      if (onChange) onChange();
      doneBox.innerHTML = st.done ? '<div class="done-msg"><b>Урок пройден.</b> Его вопросы вернутся на главную через ' + daysList(STAGES) + ' ' + plural(STAGES[STAGES.length - 1], 'день', 'дня', 'дней') + ' — в блоке «Повторить сегодня».</div>' : '';
    }
    shown.forEach((q, j) => {
      to.appendChild(renderBlock(q, Object.assign({}, blockCtx, { label: 'Вопрос ' + (j + 1) + ' из ' + shown.length, store: qStore(st, q), onSolve: upd })));
    });
    to.appendChild(tally); to.appendChild(doneBox); upd();
    if (inParts) {
      const left = les.questions.filter((q) => les.partOf[q.id] && !st.t[q.id]);
      if (left.length) {
        const parts = {};
        left.forEach((q) => { parts[les.partOf[q.id]] = 1; });
        to.appendChild(el('div', 'callout note', '<b>Ещё не отвечено</b>Вопросы «Проверь себя» в ' +
          Object.keys(parts).map((n) => 'части ' + n).join(', ') + '. Урок засчитается, когда будут решены и они.'));
      }
    }
  }

  function appendNextLesson(to, m) {
    const nx = nextReady(m.n);
    if (nx) to.appendChild(el('a', 'next', '<span><small>Следующий урок · ' + nx.n + '</small><b>' + esc(nx.t) + '</b></span>' + ic(IC.arrow, 20))).href = '#' + nx.id;
    else to.appendChild(el('div', 'next', '<span><small>Дальше</small><b>Следующие уроки скоро появятся</b></span>'));
  }

  // «Видео по теме»: les.videos = [{ url, title, channel, dur, why, part }]; без part — на странице проверки
  function appendVideos(to, les, k) {
    const parts = les.parts;
    const vs = (les.videos || []).filter((v) => v.part ? v.part === k + 1 : (!parts || parts[k].type === 'test'));
    if (!vs.length) return;
    const sec = el('section', 'vids');
    sec.innerHTML = '<h3>Видео по теме</h3><p class="vids-sub">Если удобнее посмотреть. Открывается на YouTube в новой вкладке.</p>' +
      '<div class="vid-list">' + vs.map((v) => {
        const id = (String(v.url).match(/[?&]v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/) || []);
        const yt = id[1] || id[2];
        return '<a class="vid" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
          '<span class="vid-img">' + (yt ? '<img src="https://i.ytimg.com/vi/' + yt + '/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">' : '') +
          (v.dur ? '<span class="vid-dur">' + esc(v.dur) + '</span>' : '') + '</span>' +
          '<span class="vid-t">' + esc(v.title) + '</span>' +
          '<span class="vid-c">' + esc(v.channel || '') + (v.why ? ' · ' + esc(v.why) : '') + '</span></a>';
      }).join('') + '</div>';
    to.appendChild(sec);
  }

  // части урока таблетками: засчитанная — зелёная с галочкой, текущая — залитая
  function partBar(les, k) {
    const nav = el('nav', 'pills', '<ol>' + les.parts.map((p, i) => {
      const ok = partDone(les, i);
      return '<li><a class="pill' + (ok ? ' ok' : '') + (i === k ? ' cur' : '') + '" href="#' + les.id + '/' + (i + 1) + '"' + (i === k ? ' aria-current="step"' : '') +
        ' title="' + (p.kind === 'theory' ? 'Теория' : 'Практика') + (ok ? ', засчитана' : '') + '">' +
        (ok ? ic(IC.check, 13) : '') + '<span>' + (i + 1) + ' ' + esc(p.title) + '</span></a></li>';
    }).join('') + '</ol>');
    nav.setAttribute('aria-label', 'Части урока');
    return nav;
  }

  // ── озвучка ──
  // Голос браузера читает текст части по очереди; код, схемы и вопросы остаются на экране.
  // Что читать, решают модули блоков (speak) — список собирается при отрисовке части.
  const speech = { on: false, paused: false, items: [], i: 0, row: null, cur: null };
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function speakStop() {
    if (!canSpeak) return;
    speech.on = false; speech.paused = false; speech.cur = null;
    window.speechSynthesis.cancel();
    speakMark(null);
    speakUi();
  }
  function speakMark(node) {
    [].forEach.call(document.querySelectorAll('.reading-now'), (x) => x.classList.remove('reading-now'));
    if (node) node.classList.add('reading-now');
  }
  function ruVoice() {
    return window.speechSynthesis.getVoices().filter((v) => /^ru/i.test(v.lang))[0] || null;
  }
  function speakNext() {
    if (!speech.on) return;
    if (speech.i >= speech.items.length) { speakStop(); return; }
    const node = speech.items[speech.i];
    const u = new SpeechSynthesisUtterance(node.innerText.replace(/\s+/g, ' '));
    u.lang = 'ru-RU'; u.rate = S.ui.rate;
    const v = ruVoice(); if (v) u.voice = v;
    speech.cur = u;
    u.onend = () => { if (speech.cur === u && speech.on && !speech.paused) { speech.i++; speakNext(); } };
    speakMark(node);
    window.speechSynthesis.speak(u);
  }
  function speakUi() {
    const row = speech.row;
    if (!row) return;
    row.querySelector('[data-sp="play"]').innerHTML = speech.on && !speech.paused ? ic(IC.pause) + '<span>Пауза</span>' :
      ic(IC.sound) + '<span>' + (speech.on ? 'Продолжить' : 'Слушать часть · ' + row.getAttribute('data-min') + ' мин') + '</span>';
    row.querySelector('[data-sp="stop"]').hidden = !speech.on;
    row.querySelector('[data-sp="rate"]').textContent = String(S.ui.rate).replace('.', ',') + '×';
  }
  function listenRow(min, voice) {
    if (!canSpeak) return null;
    const row = el('div', 'listen');
    row.setAttribute('data-min', min);
    row.innerHTML = '<button type="button" class="btn listen-b" data-sp="play"></button>' +
      '<button type="button" class="btn" data-sp="stop" aria-label="Остановить" hidden>' + ic(IC.stop) + '</button>' +
      '<button type="button" class="btn listen-r" data-sp="rate" title="Скорость"></button>' +
      '<span class="listen-n">читает голос браузера, код и схемы — на экране</span>';
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sp]');
      if (!b) return;
      const a = b.getAttribute('data-sp'), ss = window.speechSynthesis;
      if (a === 'rate') {
        const rates = [1, 1.25, 1.5, 0.9];
        S.ui.rate = rates[(rates.indexOf(S.ui.rate) + 1) % rates.length]; save();
        if (speech.on && !speech.paused) { speech.cur = null; ss.cancel(); speakNext(); }
      } else if (a === 'stop') speakStop();
      else if (!speech.on) {
        speech.items = voice.filter((x) => x.isConnected && x.innerText.trim());
        speech.on = true; speech.paused = false; speech.i = 0;
        speech.cur = null; ss.cancel(); speakNext();
      } else if (speech.paused) { speech.paused = false; ss.resume(); }
      else { speech.paused = true; ss.pause(); }
      speakUi();
    });
    speech.row = row;
    speakUi();
    return row;
  }

  // ── урок ──
  function renderLesson(id, pn) {
    const les = X.lesson(id), m = meta(id), st = S.lesson(id), parts = les.parts;
    trackTerms();
    page.innerHTML = '';
    const { main, rail } = lessonFrame();
    main.appendChild(el('div', 'crumb', '<span>' + esc(m.sec.name) + ' · ' + lessonLabel + ' ' + m.n + '</span>' + (les.time ? '<span>' + esc(les.time) + '</span>' : '')));
    main.appendChild(el('h1', 'title', esc(m.t)));

    if (!parts) {
      rememberPlace('#' + id, lessonLabel + ' ' + m.n + '. ' + m.t);
      appendSimple(main, les);
      appendBlocks(main, les.blocks);
      if (les.hands) main.appendChild(renderHands(les.hands, st, () => renderSide()));
      appendTest(main, les, st, false);
      appendVideos(main, les, 0);
      appendNextLesson(main, m);
      fillRail(rail, les, 'Термины урока');
      return;
    }

    const k = Math.min(Math.max(pn || 1, 1), parts.length) - 1, part = parts[k];
    rememberPlace('#' + id + '/' + (k + 1), lessonLabel + ' ' + m.n + '. ' + m.t + ' · часть ' + (k + 1));
    const min = partMin(les, k);
    st.seen = st.seen || {};

    let bar = partBar(les, k);
    main.appendChild(bar);
    const body = el('div', 'part-body'); main.appendChild(body);
    body.appendChild(el('div', 'pt-meta', 'Часть ' + (k + 1) + ' из ' + parts.length + ' · ' + (part.kind === 'theory' ? 'теория' : 'практика') + ' · ≈ ' + min + ' мин'));
    body.appendChild(el('h2', 'pt-title', esc(part.title)));
    const voice = [];
    if (part.kind === 'theory') { const lr = listenRow(min, voice); if (lr) body.appendChild(lr); }
    if (k === 0) voice.push(...appendSimple(body, les));

    const foot = el('div', 'pt-foot');
    const status = el('div', 'pt-status');
    status.setAttribute('role', 'status');
    // честный статус части внизу: что ещё нужно, чтобы её засчитать
    function setStatus() {
      const done = partDone(les, k);
      let txt;
      if (done) txt = part.type === 'test' ? 'Урок пройден' : 'Часть засчитана';
      else if (part.type === 'test') {
        const left = les.questions.filter((q) => !st.t[q.id]).length;
        txt = 'Осталось ' + left + ' ' + plural(left, 'вопрос', 'вопроса', 'вопросов') + ' — и урок пройден';
      } else if (part.type === 'hands') {
        const hl = partQuestions(les, k).filter((q) => !st.t[q.id]).length;
        txt = 'Ответь на ' + hl + ' ' + plural(hl, 'вопрос', 'вопроса', 'вопросов') + ' «Проверь, что понял» — и задание засчитано';
      } else {
        const own = partQuestions(les, k), ol = own.filter((q) => !st.t[q.id]).length;
        txt = own.length ? 'Ответь ещё на ' + ol + ' ' + plural(ol, 'вопрос', 'вопроса', 'вопросов') + ' — и часть засчитана' : 'Часть засчитается, когда дочитаешь до конца';
      }
      status.className = 'pt-status' + (done ? ' ok' : '');
      status.innerHTML = '<span class="pt-st-ic">' + (done ? ic(IC.check, 13) : '') + '</span><span>' + txt + '</span>';
    }
    function refreshBar() {
      const nb = partBar(les, k);
      bar.replaceWith(nb); bar = nb;
      setStatus();
      renderSide();
    }

    if (part.type === 'hands') body.appendChild(renderHands(part.hands, st, refreshBar));
    else if (part.type === 'test') appendTest(body, les, st, true, refreshBar);
    else {
      voice.push(...appendBlocks(body, part.blocks));
      const own = part.questions;
      if (own.length) {
        const head = el('div', 'qs-head self-check', '<h3>Проверь себя</h3><p>' +
          (own.length === 1 ? 'Вопрос' : own.length + ' ' + plural(own.length, 'вопрос', 'вопроса', 'вопросов')) +
          ' по этой части. Часть засчитается, когда ответишь верно. Эти вопросы входят в проверку урока.</p>' +
          '<p class="kbd-hint">Цифры 1–9 выбирают ответ в вопросе, где курсор. Enter — к следующему вопросу.</p>');
        body.appendChild(head);
        voice.push(...readable(head));
        own.forEach((q, j) => {
          body.appendChild(renderBlock(q, Object.assign({}, blockCtx, {
            label: 'Вопрос ' + (j + 1) + ' из ' + own.length,
            store: qStore(st, q),
            onSolve: () => { markIfDone(les, st); refreshBar(); }
          })));
        });
      }
    }
    appendVideos(body, les, k);

    // низ части одной строкой: назад · что осталось · дальше
    if (k > 0) {
      const back = foot.appendChild(el('a', 'btn pf-back', '← Часть ' + k));
      back.href = '#' + id + '/' + k;
      back.title = parts[k - 1].title;
    }
    foot.appendChild(status);
    if (k < parts.length - 1) {
      const nx = parts[k + 1];
      const fwd = foot.appendChild(el('a', 'btn pri pf-fwd', '<span>Часть ' + (k + 2) + '<span class="pf-t"> · ' + esc(nx.title) + '</span></span>' + ic(IC.arrow, 18)));
      fwd.href = '#' + id + '/' + (k + 2);
      fwd.title = 'Дальше · ≈ ' + partMin(les, k + 1) + ' мин';
    }
    body.appendChild(foot);
    setStatus();
    if (k === parts.length - 1) appendNextLesson(body, m);

    // теория без своих вопросов засчитывается, когда дочитана до кнопок внизу
    if (part.kind === 'theory' && !partQuestions(les, k).length && !st.seen[k] && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) {
          st.seen[k] = 1; save(); io.disconnect(); refreshBar();
        }
      });
      io.observe(status);
      onLeave(() => io.disconnect());
    }

    fillRail(rail, les, 'Термины части');
  }

  function renderHands(hd, st, onChange) {
    return renderBlock(hd, Object.assign({}, blockCtx, { store: (q) => qStore(st, q), onChange }));
  }

  // ── главная ──
  const revMem = {};
  function dueList() {
    const t = today(), out = [];
    Object.keys(S.lessons).forEach((id) => {
      const st = S.lessons[id];
      if (!st.done || !ready(id)) return;
      st.rev = st.rev || STAGES.map(() => 0);
      const k = st.rev.indexOf(0);
      if (k < 0) return;
      if (t >= addDays(st.done, STAGES[k])) out.push({ id, k });
    });
    return out;
  }

  // ── страница курса: паспорт, прогресс, повторения, разделы; сбоку — связи с другими курсами ──
  function renderHome() {
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>О курсе</span>'));
    const done = doneCount(ALL), pct = TOTAL ? Math.round(done / TOTAL * 100) : 0;
    const hero = el('section', 'cp-hero metal-' + esc(C.metal));
    hero.innerHTML = '<div class="cp-title">' + linkIcon(C.metal, TOTAL ? done / TOTAL : 0, 64) + '<h1 class="title">' + esc(C.title) + '</h1></div>' +
      (C.about ? '<p class="lead">' + rich(C.about) + '</p>' : '') +
      '<ul class="chips">' +
        '<li class="chip">' + esc(C.tool.name + ' ' + C.tool.version) + '</li>' +
        '<li class="chip">' + X.sections.length + ' ' + plural(X.sections.length, 'раздел', 'раздела', 'разделов') + '</li>' +
        '<li class="chip">' + TOTAL + ' ' + plural(TOTAL, 'урок', 'урока', 'уроков') + '</li>' +
        '<li class="chip"><span class="dot"></span>звено: ' + esc(metalName(C.metal)) + '</li>' +
        '<li class="chip">повторения: ' + STAGES.join(' · ') + ' ' + plural(STAGES[STAGES.length - 1], 'день', 'дня', 'дней') + '</li>' +
      '</ul>';
    page.appendChild(hero);

    // прогресс и куда идти дальше
    const todo = firstTodo(), last = lastPlace(), due = dueList();
    const prog = el('section', 'card cp-prog');
    let go = '';
    if (last) go = '<a class="btn pri" href="' + esc(last.hash) + '">Продолжить: ' + esc(last.label) + '</a>';
    else if (todo) go = '<a class="btn pri" href="#' + todo.id + '">' + (done ? 'Продолжить' : 'Начать') + ': ' + lessonLabel.toLowerCase() + ' ' + todo.n + '</a>';
    prog.innerHTML = '<div class="prog"><div class="prog-t"><span>Пройдено ' + done + ' из ' + TOTAL + ' ' + plural(TOTAL, 'урока', 'уроков', 'уроков') + '</span><span>' + pct + '%</span></div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Прогресс курса"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="cp-go">' + go + (due.length ? '<a class="btn" href="#review">Повторить сегодня · ' + due.length + '</a>' : '') +
      (X.hasGlossary ? '<a class="btn" href="#glossary">' + ic(IC.book) + ' Словарь</a>' : '') +
      X.pages.map((p) => '<a class="btn" href="#' + p.id + '">' + ic(IC[p.icon] || IC.book) + ' ' + esc(p.title) + '</a>').join('') + '</div>';
    page.appendChild(prog);

    const grid = el('div', 'cp-grid');
    const main = el('div', 'cp-main');
    grid.appendChild(main);
    grid.appendChild(courseAside());
    page.appendChild(grid);

    const rev = el('section', 'cp-rev');
    rev.id = 'rev';
    rev.appendChild(el('h2', null, 'Повторить сегодня'));
    main.appendChild(rev);
    if (!due.length) {
      rev.appendChild(el('div', 'review-empty', 'Сегодня повторять нечего. Пройди урок — ' + inDays(STAGES[0]) + ' его вопросы появятся здесь' +
        (STAGES.length > 1 ? ', потом ещё через ' + daysList(STAGES.slice(1)) + ' ' + plural(STAGES[STAGES.length - 1], 'день', 'дня', 'дней') + ' после прохождения' : '') + '.'));
    }
    due.forEach((d) => {
      const les = X.lesson(d.id), m = meta(d.id);
      const key = d.id + ':' + d.k + ':' + today();
      revMem[key] = revMem[key] || {};
      const rnd = seeded(hash(key));
      const pick = shuffle(les.questions, rnd).slice(0, Math.min(3, les.questions.length));
      const card = el('div', 'rev-card', '<div class="kind">Повтор ' + (d.k + 1) + ' из ' + STAGES.length + '</div><div class="w-title">' + lessonLabel + ' ' + m.n + '. ' + esc(m.t) + '</div>');
      pick.forEach((q, j) => {
        card.appendChild(renderQuestion(q, 'Вопрос ' + (j + 1) + ' из ' + pick.length, {
          solved: () => !!revMem[key][q.id],
          solve: () => {
            revMem[key][q.id] = 1;
            if (pick.every((x) => revMem[key][x.id])) { S.lessons[d.id].rev[d.k] = 1; save(); card.appendChild(el('div', 'done-msg', '<b>Повтор засчитан.</b>')); renderTop(); }
          }
        }));
      });
      rev.appendChild(card);
    });

    // разделы: раскрыт тот, где ты сейчас (первый непройденный)
    main.appendChild(el('h2', null, 'Разделы'));
    const openSec = X.sections.find((s) => doneCount(s.lessons) < s.lessons.length) || X.sections[0];
    const secs = el('div', 'card cp-secs');
    X.sections.forEach((sec, i) => {
      const dn = doneCount(sec.lessons), ls = sec.lessons;
      const d = el('details', 'cp-sec');
      d.open = sec === openSec;
      d.innerHTML = '<summary><span class="cp-num">' + (i + 1) + '</span><span class="cp-sec-t"><b class="k-' + esc(sec.kind || '') + '">' + esc(sec.name) + '</b>' +
        '<small>' + (ls.length > 1 ? ls[0].n + '–' + ls[ls.length - 1].n : ls[0].n) + '</small></span>' +
        '<span class="cp-cnt">' + dn + ' из ' + ls.length + '</span>' + ic(IC.down, 18) + '</summary>' +
        (sec.about ? '<p class="cp-about">' + esc(sec.about) + '</p>' : '') +
        '<ol class="cp-ls">' + ls.map(lessonRow).join('') + '</ol>';
      secs.appendChild(d);
    });
    main.appendChild(secs);

    // страницы курса с описанием — карточкой под разделами
    X.pages.filter((p) => p.about).forEach((p) => {
      const card = el('a', 'sec-card practice', '<h3 class="k-' + esc(p.tag || '') + '">' + esc(p.title) + '</h3><p>' + rich(p.about) + '</p>');
      card.href = '#' + p.id; card.style.display = 'block'; card.style.marginTop = '12px'; card.style.textDecoration = 'none'; card.style.color = 'inherit';
      main.appendChild(card);
    });

    if (C.howto && C.howto.length) {
      main.appendChild(el('h2', null, 'Как заниматься'));
      const how = el('ul', 'list');
      C.howto.forEach((t) => how.appendChild(el('li', null, rich(t))));
      main.appendChild(how);
    }
    main.appendChild(importBox());
  }

  // строка урока на странице курса: пройден, начат, готов или ещё пишется
  function lessonRow(l) {
    if (!ready(l.id)) {
      return '<li><div class="cp-l soon"><span class="cp-st"></span><span class="cp-n">' + l.n + '</span><span class="cp-t">' + esc(l.t) + '</span><span class="cp-s">скоро</span></div></li>';
    }
    const st = S.lessons[l.id], ok = isDone(l.id);
    const started = !ok && st && (Object.keys(st.t || {}).length || Object.keys(st.seen || {}).length);
    return '<li><a class="cp-l' + (ok ? ' ok' : started ? ' cur' : '') + '" href="#' + l.id + '">' +
      '<span class="cp-st">' + (ok ? ic(IC.check, 12) : started ? '<i></i>' : '') + '</span>' +
      '<span class="cp-n">' + l.n + '</span><span class="cp-t">' + esc(l.t) + '</span>' +
      '<span class="cp-s">' + (ok ? 'пройден' : started ? 'начат' : esc(l.node.time || '')) + '</span></a></li>';
  }

  // сбоку: на какие курсы опирается, какие опираются на него, что значит «пройдено»
  function courseAside() {
    const byId = Object.fromEntries(catalog.map((c) => [c.id, c]));
    const link = (c) => '<a class="cp-link metal-' + esc(c.metal) + '" href="/c/' + encodeURIComponent(c.id) + '/">' + linkIcon(c.metal, 1, 40) +
      '<span>' + esc(c.title) + '</span></a>';
    const needs = (C.requires || []).map((id) => byId[id] ? link(byId[id]) : '<span>' + esc(id) + '</span>');
    const next = catalog.filter((c) => (c.requires || []).includes(C.id)).map(link);
    const aside = el('aside', 'cp-aside');
    aside.innerHTML =
      '<section class="card"><h2 class="lbl">Опирается на</h2>' +
        (needs.length ? needs.join('') : '<p>Ни на что: это стартовый курс.</p>') + '</section>' +
      (next.length ? '<section class="card"><h2 class="lbl">Что дальше</h2>' + next.join('') + '</section>' : '') +
      '<section class="card"><h2 class="lbl">Как засчитывается</h2><ul>' +
        '<li>Часть — когда ответил на её вопросы «Проверь себя» или дочитал её до конца.</li>' +
        '<li>Урок — когда решены все его вопросы.</li>' +
        '<li>Курс — когда пройдены все уроки. Тогда звено выковано.</li>' +
        '<li>Пройденный урок возвращается на повторение через ' + daysList(STAGES) + ' ' + plural(STAGES[STAGES.length - 1], 'день', 'дня', 'дней') + '.</li>' +
      '</ul></section>';
    return aside;
  }

  // последнее место в этом курсе — для «Продолжить» здесь и в каталоге
  function lastPlace() {
    try {
      const l = JSON.parse(localStorage.getItem('citadel-last') || 'null');
      return l && l.course === C.id && l.hash && ready(l.hash.replace(/^#/, '').split('/')[0]) ? l : null;
    } catch (e) { return null; }
  }
  function rememberPlace(hash, label) {
    try { localStorage.setItem('citadel-last', JSON.stringify({ course: C.id, hash, label, at: Date.now() })); } catch (e) { /* не страшно */ }
  }

  // Перенос прогресса из прежней версии курса: в ней на главной есть кнопка «Скачать прогресс».
  function importBox() {
    const box = el('details', 'terms import');
    box.innerHTML = '<summary>Перенести прогресс из прежней версии курса</summary>' +
      '<p>В прежней версии на главной нажми «Скачать прогресс для Citadel» и выбери этот файл. Отметки добавятся к текущим, ничего не сотрётся.</p>' +
      '<label class="btn import-f">Выбрать файл<input type="file" accept="application/json,.json" hidden></label>' +
      '<p class="import-r" role="status"></p>';
    const out = box.querySelector('.import-r');
    box.querySelector('input').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        const n = S.importV0(JSON.parse(txt), (id) => ready(id));
        out.textContent = n ? 'Перенесено отметок: ' + n + '.' : 'Новых отметок в файле нет.';
        if (n) { renderSide(); renderTop(); }
      }).catch(() => { out.textContent = 'Не получилось прочитать файл: это должен быть файл прогресса из прежней версии курса.'; });
    });
    return box;
  }

  // ── словарь ──
  function renderGlossary() {
    const refs = {};
    ALL.filter((l) => ready(l.id)).forEach((l) => {
      const txt = JSON.stringify(l.node), re = /\{\{([a-z0-9-]+)/g;
      let m;
      while ((m = re.exec(txt))) { (refs[m[1]] = refs[m[1]] || {})[l.id] = 1; }
    });
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>Словарь</span>'));
    page.appendChild(el('h1', 'title', 'Словарь курса'));
    const keys = Object.keys(C.glossary).sort((a, b) => C.glossary[a].t.localeCompare(C.glossary[b].t, 'ru'));
    page.appendChild(el('p', 'lead', keys.length + ' ' + plural(keys.length, 'термин', 'термина', 'терминов') + '. Словарь пополняется вместе с уроками.'));
    const dl = el('dl', 'gloss');
    keys.forEach((k) => {
      const g = C.glossary[k];
      const r = refs[k] ? Object.keys(refs[k]).map((id) => '<a href="#' + id + '">урок ' + meta(id).n + '</a>').join(', ') : '';
      dl.appendChild(el('dt', null, esc(g.t) + (g.en ? '<small>' + esc(g.en) + '</small>' : '')));
      dl.appendChild(el('dd', null, esc(g.d) + (r ? '<span class="ref">Встречается: ' + r + '</span>' : '')));
    });
    page.appendChild(dl);
  }

  // ── страница курса (практикум, инструменты…) — те же блоки, что в уроках ──
  function renderPage(p) {
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>' + esc(p.title) + '</span>'));
    page.appendChild(el('h1', 'title', esc(p.title)));
    if (p.lead) page.appendChild(el('p', 'lead', rich(p.lead)));
    appendBlocks(page, p.blocks || []);
  }

  // ── всплывающее определение ──
  const pop = document.getElementById('pop');
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.term');
    if (t) {
      e.preventDefault(); e.stopPropagation();
      const g = C.glossary[t.getAttribute('data-k')];
      if (!g) return;
      pop.innerHTML = '<b>' + esc(g.t) + '</b>' + (g.en ? '<small>' + esc(g.en) + '</small>' : '') + '<p>' + esc(g.d) + '</p>' +
        (X.hasGlossary ? '<p><a href="#glossary">Весь словарь →</a></p>' : '');
      pop.hidden = false;
      const r = t.getBoundingClientRect();
      const left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12);
      pop.style.left = Math.max(8, left) + 'px';
      pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
      return;
    }
    if (!e.target.closest('#pop')) pop.hidden = true;
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  // ── клавиатура в вопросах ──
  // Цифры выбирают вариант в вопросе, где фокус (или в первом нерешённом на экране), Enter — к следующему.
  function activeQ() {
    const f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.q');
    if (f) return f;
    const qs = [].slice.call(page.querySelectorAll('.q:not(.solved)'));
    return qs.filter((q) => { const r = q.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; })[0] || null;
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, .widget.anim')) return;
    if (/^[1-9]$/.test(e.key)) {
      const q = activeQ(), b = q && q.querySelector('.opt[data-n="' + e.key + '"]');
      if (b && !b.disabled) { e.preventDefault(); b.focus(); b.click(); }
    } else if (e.key === 'Enter' && t && t.closest && t.closest('.q .opt')) {
      const cur = t.closest('.q'), all = [].slice.call(page.querySelectorAll('.q'));
      const nx = all.slice(all.indexOf(cur) + 1).filter((x) => !x.classList.contains('solved'))[0];
      if (nx && cur.classList.contains('solved')) {
        e.preventDefault();
        nx.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        const o = nx.querySelector('.opt, input, .card-btn'); if (o) o.focus({ preventScroll: true });
      }
    }
  });

  // ── маршруты ──
  function route() {
    pop.hidden = true;
    speakStop(); speech.row = null;
    leave();
    takeTerms();
    const seg = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    const id = seg[0];
    current = id;
    currentPart = parseInt(seg[1], 10) || 1;
    const pg = X.page(id);
    if (id === 'glossary' && X.hasGlossary) renderGlossary();
    else if (pg) renderPage(pg);
    else if (id && ready(id)) renderLesson(id, currentPart);
    else { current = ''; renderHome(); }
    renderSide();
    renderTop();
    applyFocus();
    closeMenu();
    window.scrollTo(0, 0);
    // #review — страница курса сразу на повторениях (ссылка из каталога)
    if (id === 'review') { const r = document.getElementById('rev'); if (r) r.scrollIntoView(); }
    const m = meta(current);
    document.title = (m ? m.t + ' · ' : '') + C.title;
  }
  window.addEventListener('hashchange', route);
  applyTheme();
  route();
  S.startSync();
}
