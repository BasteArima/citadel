// Движок курса: меню, маршруты, уроки, виджеты, проверки, повторения.
// Прогресс хранится в localStorage под ключом gocourse-v1.
(function () {
  'use strict';
  var C = window.COURSE;
  var KEY = 'gocourse-v1';
  var STAGES = [1, 3, 7];
  var S = load();

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { s = {}; }
    if (!s || typeof s !== 'object') s = {};
    s.lessons = s.lessons || {};
    s.theme = s.theme || 'auto';
    // ui: какие разделы меню раскрыты, режим чтения, скорость озвучки
    s.ui = s.ui || {};
    s.ui.open = s.ui.open || {};
    s.ui.runs = s.ui.runs || {};
    s.ui.rate = s.ui.rate || 1;
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function L(id) { return S.lessons[id] || (S.lessons[id] = { t: {}, h: {} }); }

  // ── утилиты ──
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var usedTerms = null;
  // {{ключ}} и {{ключ|текст}} — термин из словаря; {{>id}} и {{>id|текст}} — ссылка на урок.
  function rich(html) {
    return String(html).replace(/\{\{>([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, function (m, id, txt) {
      var l = meta(id);
      if (!l) return txt || id;
      var name = 'урок ' + l.n + ' «' + esc(l.t) + '»';
      if (!ready(id)) return (txt ? txt + ' — ' : '') + name + ' (скоро)';
      return '<a class="xref" href="#' + id + '">' + (txt ? txt + ' → ' : '') + name + '</a>';
    }).replace(/\{\{([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, function (m, k, txt) {
      var g = C.glossary[k];
      if (!g) return txt || k;
      if (usedTerms) usedTerms[k] = 1;
      return '<button type="button" class="term" data-k="' + k + '">' + (txt || g.t) + '</button>';
    });
  }
  // иконки — тонкие линии в цвет текста
  function ic(d, size) {
    return '<svg class="ic" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  var IC = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/>',
    code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    repeat: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    sound: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    term: '<path d="M4 17l6-5-6-5M12 19h8"/>'
  };
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(iso, n) {
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seeded(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rnd) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // ── план курса ──
  var ALL = [];
  C.sections.forEach(function (sec) {
    sec.lessons.forEach(function (l) { l.sec = sec; ALL.push(l); });
  });
  var TOTAL = ALL.length;
  function meta(id) { for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i]; return null; }
  function ready(id) { return !!C.lessons[id]; }
  function isDone(id) { return !!(S.lessons[id] && S.lessons[id].done); }
  function doneCount(list) { return list.filter(function (l) { return isDone(l.id); }).length; }
  function nextReady(afterN) {
    for (var i = 0; i < ALL.length; i++) if (ALL[i].n > afterN && ready(ALL[i].id)) return ALL[i];
    return null;
  }
  function firstTodo() {
    for (var i = 0; i < ALL.length; i++) if (ready(ALL[i].id) && !isDone(ALL[i].id)) return ALL[i];
    return null;
  }

  // ── тема ──
  function applyTheme() {
    var r = document.documentElement;
    if (S.theme === 'light' || S.theme === 'dark') r.setAttribute('data-theme', S.theme);
    else r.removeAttribute('data-theme');
  }

  // ── шапка ──
  var top = document.getElementById('top');
  var side = document.getElementById('side');
  var page = document.getElementById('page');
  var current = '', currentPart = 1;
  var crumbs = []; // [{ t, href }] — «где я» для шапки, ставит страница

  function renderTop() {
    var due = dueList().length, isLesson = !!(current && ready(current));
    var themes = [['auto', 'Авто', ''], ['light', 'Светлая', IC.sun], ['dark', 'Тёмная', IC.moon]];
    top.innerHTML =
      '<button type="button" class="tb-ic tb-menu" data-act="menu" aria-controls="side" aria-expanded="' + side.classList.contains('open') + '" aria-label="Меню уроков">' + ic(IC.menu, 20) + '</button>' +
      '<a class="tb-brand" href="#"><span class="tb-logo">go</span><span class="tb-name">' + esc(C.title) + '</span></a>' +
      '<nav class="tb-crumbs" aria-label="Где я">' + crumbs.map(function (c, i) {
        var last = i === crumbs.length - 1;
        return '<span class="tb-cr' + (last ? ' last' : '') + '">' + (i ? ic(IC.chev, 14) : '') +
          (c.href && !last ? '<a href="' + c.href + '">' + esc(c.t) + '</a>' : '<span' + (last ? ' aria-current="page"' : '') + '>' + esc(c.t) + '</span>') + '</span>';
      }).join('') + '</nav>' +
      '<div class="tb-tools">' +
        (due ? '<a class="tb-due" href="#" title="Повторить сегодня">' + ic(IC.repeat) + '<span>Повторить</span><b>' + due + '</b></a>' : '') +
        (isLesson ? '<button type="button" class="tb-ic tb-focus" data-act="focus" aria-pressed="' + !!S.ui.focus + '" aria-label="Режим чтения: скрыть меню" title="Режим чтения">' + ic(IC.focus, 18) + '</button>' : '') +
        '<div class="tb-theme" role="group" aria-label="Тема">' + themes.map(function (t) {
          return '<button type="button" data-theme-set="' + t[0] + '" aria-pressed="' + (S.theme === t[0]) + '"' +
            (t[2] ? ' aria-label="' + t[1] + '" title="' + t[1] + '">' + ic(t[2]) : '>' + t[1]) + '</button>';
        }).join('') + '</div>' +
      '</div>';
  }
  top.addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-set]');
    if (b) { S.theme = b.getAttribute('data-theme-set'); save(); applyTheme(); renderTop(); return; }
    var a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.getAttribute('data-act') === 'menu') {
      var open = !side.classList.contains('open');
      side.classList.toggle('open', open);
      a.setAttribute('aria-expanded', String(open));
    }
    if (a.getAttribute('data-act') === 'focus') { S.ui.focus = !S.ui.focus; save(); applyFocus(); renderTop(); }
  });
  function closeMenu() {
    side.classList.remove('open');
    var b = top.querySelector('[data-act="menu"]');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  // режим чтения: только на странице урока, прячет меню и оставляет колонку текста
  function applyFocus() {
    document.body.classList.toggle('reading', !!(S.ui.focus && current && ready(current)));
  }

  // ── меню ──
  function secOpen(sec) {
    if (sec.id in S.ui.open) return S.ui.open[sec.id];
    var m = meta(current);
    return m ? m.sec === sec : sec === C.sections[0];
  }
  function sideLink(id, d, t, extra) {
    return '<li><a class="sd-a" href="#' + id + '"' + (current === id ? ' aria-current="page"' : '') + '>' + ic(d) +
      '<span class="sd-t">' + t + '</span>' + (extra ? '<span class="sd-cnt">' + extra + '</span>' : '') + '</a></li>';
  }
  function lessonItem(l) {
    var cur = current === l.id, ok = isDone(l.id);
    var h = '<li><a class="sd-l' + (ok ? ' ok' : '') + (cur ? ' cur' : '') + '" href="#' + l.id + '"' + (cur ? ' aria-current="page"' : '') + '>' +
      '<span class="sd-st">' + (ok ? ic(IC.check, 12) : cur ? '<i></i>' : '') + '</span><span class="sd-t">' + l.n + ' · ' + esc(l.t) + '</span></a></li>';
    var les = C.lessons[l.id], ps = cur ? partsOf(les) : null;
    if (ps) {
      h += '<li><ol class="sd-parts">' + ps.map(function (p, k) {
        var done = partDone(l.id, k, ps), here = currentPart === k + 1;
        return (p.kind === 'practice' && ps[k - 1].kind === 'theory' ? '<li class="sd-pl">Практика</li>' : '') +
          '<li><a class="sd-p ' + p.kind + (done ? ' ok' : '') + '" href="#' + l.id + '/' + (k + 1) + '"' + (here ? ' aria-current="step"' : '') + '>' +
          '<span class="sd-dot">' + (done ? ic(IC.check, 12) : '') + '</span><span class="sd-t">' + esc(p.title) + '</span>' +
          '<span class="sd-min">' + partMin(les, ps, k) + ' мин</span></a></li>';
      }).join('') + '</ol></li>';
    }
    return h;
  }
  // Пройденные уроки подряд (кроме текущего) сворачиваются в одну строку, неготовые подряд — тоже.
  function sectionItems(sec) {
    var out = '', ls = sec.lessons, i = 0;
    while (i < ls.length) {
      var l = ls[i], j = i;
      if (ready(l.id) && isDone(l.id) && current !== l.id) {
        while (j + 1 < ls.length && ready(ls[j + 1].id) && isDone(ls[j + 1].id) && current !== ls[j + 1].id) j++;
      } else if (!ready(l.id)) {
        while (j + 1 < ls.length && !ready(ls[j + 1].id)) j++;
      }
      var run = ls.slice(i, j + 1), range = run[0].n + (run.length > 1 ? '–' + run[run.length - 1].n : '');
      if (!ready(l.id)) {
        out += '<li><div class="sd-soon"><span class="sd-st"></span><span class="sd-t">' +
          (run.length > 1 ? range + ' · готовятся' : l.n + ' · ' + esc(l.t) + ' · скоро') + '</span></div></li>';
      } else if (run.length > 1) {
        var key = sec.id + ':' + run[0].n, open = !!S.ui.runs[key];
        out += '<li><button type="button" class="sd-run" data-run="' + key + '" aria-expanded="' + open + '"><span class="sd-t">Уроки ' + range + ' пройдены</span>' + ic(open ? IC.down : IC.chev, 14) + '</button></li>';
        if (open) run.forEach(function (x) { out += lessonItem(x); });
      } else {
        out += lessonItem(l);
      }
      i = j + 1;
    }
    return out;
  }
  function renderSide() {
    var done = doneCount(ALL);
    var h = '<div class="sd-prog"><div class="sd-prog-t"><span>Курс</span><span>' + done + ' из ' + TOTAL + '</span></div>' +
      '<div class="bar"><i style="width:' + (done / TOTAL * 100) + '%"></i></div></div>' +
      '<ul class="sd-links">' + sideLink('', IC.home, 'Сегодня') + sideLink('practice', IC.code, 'Практикум') + sideLink('glossary', IC.book, 'Словарь') + '</ul>';
    C.sections.forEach(function (sec) {
      var open = secOpen(sec);
      h += '<div class="sd-sec"><button type="button" class="sd-sec-h" data-sec="' + sec.id + '" aria-expanded="' + open + '">' +
        ic(open ? IC.down : IC.chev, 14) + '<span class="sd-t">' + esc(sec.name) + '</span><span class="sd-cnt">' + doneCount(sec.lessons) + ' / ' + sec.lessons.length + '</span></button>' +
        (open ? '<ul class="sd-list">' + sectionItems(sec) + '</ul>' : '') + '</div>';
    });
    side.innerHTML = h;
  }
  side.addEventListener('click', function (e) {
    var s = e.target.closest('[data-sec]');
    if (s) { var sec = C.sections.filter(function (x) { return x.id === s.getAttribute('data-sec'); })[0]; S.ui.open[sec.id] = !secOpen(sec); save(); renderSide(); return; }
    var r = e.target.closest('[data-run]');
    if (r) { var k = r.getAttribute('data-run'); S.ui.runs[k] = !S.ui.runs[k]; save(); renderSide(); return; }
    if (e.target.closest('a')) closeMenu();
  });

  // ── вопросы ──
  // store: { solved(): bool, solve(): void }
  function normalize(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"'`]/g, '').replace(/\s+/g, ' ').trim(); }

  function renderQ(q, label, store, onSolve) {
    var box = el('div', 'q');
    var head = el('div', 'q-n', '<span>' + label + '</span>');
    box.appendChild(head);
    box.appendChild(el('div', 'q-t', rich(q.q)));
    var whyBox = null;

    function markSolved() {
      box.classList.add('solved');
      if (!head.querySelector('.st')) head.appendChild(el('span', 'st', '· засчитано'));
    }
    function showWhy(ok) {
      if (!whyBox) { whyBox = el('div', 'why'); box.appendChild(whyBox); }
      whyBox.className = 'why ' + (ok ? 'ok' : 'no');
      whyBox.innerHTML = '<b>' + (ok ? 'Верно' : 'Не совсем') + '</b>' + rich(q.why || '');
    }
    function win() {
      if (!store.solved()) { store.solve(); if (onSolve) onSolve(); }
      markSolved();
    }

    if (q.type === 'choice') {
      var opts = el('div', 'opts');
      q.opts.forEach(function (o, i) {
        var b = el('button', 'opt', '<span class="opt-n">' + (i + 1) + '</span><span class="opt-t">' + rich(o) + '</span>');
        b.type = 'button';
        b.setAttribute('data-n', i + 1);
        b.addEventListener('click', function (e) {
          if (e.target.closest('.term')) return;
          if (i === q.a) {
            b.classList.add('right');
            [].forEach.call(opts.children, function (x) { x.disabled = true; });
            showWhy(true); win();
          } else {
            b.classList.add('wrong'); showWhy(false);
          }
        });
        opts.appendChild(b);
      });
      box.appendChild(opts);
      if (store.solved()) {
        opts.children[q.a].classList.add('right');
        [].forEach.call(opts.children, function (x) { x.disabled = true; });
        showWhy(true); markSolved();
      }
    } else if (q.type === 'text') {
      var row = el('div', 'txt-row');
      var inp = el('input'); inp.type = 'text'; inp.placeholder = 'Ответ';
      inp.setAttribute('aria-label', 'Ответ');
      var go = el('button', 'btn pri', 'Ответить'); go.type = 'button';
      function check() {
        var v = normalize(inp.value);
        if (!v) return;
        var ok = q.a.some(function (a) { return normalize(a) === v; });
        showWhy(ok);
        if (ok) { inp.disabled = true; go.disabled = true; win(); }
      }
      go.addEventListener('click', check);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
      row.appendChild(inp); row.appendChild(go); box.appendChild(row);
      if (store.solved()) { inp.value = q.a[0]; inp.disabled = true; go.disabled = true; showWhy(true); markSolved(); }
    } else if (q.type === 'order') {
      var rnd = seeded(hash(q.q));
      var pool = shuffle(q.items.map(function (t, i) { return i; }), rnd);
      if (pool.every(function (v, i) { return v === i; })) pool.reverse();
      var picked = [];
      box.appendChild(el('div', 'cards-l', 'Нажимай на карточки в правильном порядке:'));
      var poolEl = el('div', 'cards'); box.appendChild(poolEl);
      box.appendChild(el('div', 'cards-l', 'Твой порядок (нажми на карточку, чтобы вернуть её):'));
      var pickEl = el('div', 'cards'); box.appendChild(pickEl);
      var row2 = el('div', 'txt-row');
      var chk = el('button', 'btn pri', 'Проверить'); chk.type = 'button';
      var rst = el('button', 'btn', 'Сбросить'); rst.type = 'button';
      row2.appendChild(chk); row2.appendChild(rst); box.appendChild(row2);
      function draw() {
        poolEl.innerHTML = ''; pickEl.innerHTML = '';
        pool.forEach(function (i) {
          if (picked.indexOf(i) >= 0) return;
          var b = el('button', 'card-btn', rich(q.items[i])); b.type = 'button';
          b.addEventListener('click', function () { picked.push(i); draw(); });
          poolEl.appendChild(b);
        });
        picked.forEach(function (i, k) {
          var b = el('button', 'card-btn picked', (k + 1) + '. ' + rich(q.items[i])); b.type = 'button';
          b.addEventListener('click', function () { if (!store.solved()) { picked.splice(k, 1); draw(); } });
          pickEl.appendChild(b);
        });
        if (!picked.length) pickEl.appendChild(el('span', 'card-btn slot', 'пока пусто'));
        chk.disabled = picked.length !== q.items.length || store.solved();
      }
      chk.addEventListener('click', function () {
        var ok = picked.every(function (v, i) { return v === i; });
        showWhy(ok);
        if (ok) { rst.disabled = true; win(); draw(); }
      });
      rst.addEventListener('click', function () { picked = []; if (whyBox) { whyBox.remove(); whyBox = null; } draw(); });
      if (store.solved()) { picked = q.items.map(function (t, i) { return i; }); rst.disabled = true; showWhy(true); markSolved(); }
      draw();
    }
    return box;
  }

  // ── блоки урока ──
  function renderBlock(b) {
    if (b.h) return el('h2', null, rich(b.h));
    if (b.h3) return el('h3', null, rich(b.h3));
    if (b.p) return el('p', null, rich(b.p));
    if (b.list) {
      var ul = el(b.ordered ? 'ol' : 'ul', 'list');
      b.list.forEach(function (li) { ul.appendChild(el('li', null, rich(li))); });
      return ul;
    }
    if (b.code != null) {
      var f = document.createDocumentFragment();
      var cb = el('div', 'codebox');
      cb.appendChild(codeHead(b.file || 'Go', null, b.code));
      var pre = el('pre'); pre.appendChild(el('code', null, esc(b.code)));
      cb.appendChild(pre);
      f.appendChild(cb);
      if (b.cap) f.appendChild(el('div', 'cap', rich(b.cap)));
      return f;
    }
    if (b.predict) return renderPredict(b.predict);
    if (b.table) {
      var t = '<table><thead><tr>' + b.table.head.map(function (x) { return '<th>' + rich(x) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        b.table.rows.map(function (r) { return '<tr>' + r.map(function (x) { return '<td>' + rich(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
      return el('div', 'tbl', t);
    }
    if (b.cs) {
      // врезка про C# — сбоку от основной линии, поэтому свёрнута
      return el('details', 'callout cs', '<summary>' + ic(IC.chev, 16) + '<span>' + esc(b.title || 'Если ты из C#') + '</span><span class="cs-more">развернуть</span></summary>' +
        '<div class="cs-b">' + rich(b.cs) + '</div>');
    }
    if (b.note || b.warn) {
      var kind = b.note ? 'note' : 'warn';
      var label = b.title || { note: 'Важно', warn: 'Осторожно' }[kind];
      return el('div', 'callout ' + kind, '<b>' + esc(label) + '</b>' + rich(b[kind]));
    }
    if (b.scheme) {
      var w = el('div', 'widget');
      w.innerHTML = '<div class="w-head"><div class="kind">Схема</div><div class="w-title">' + rich(b.scheme.title) + '</div></div>' +
        '<div class="w-body">' + rich(b.scheme.html) + (b.scheme.cap ? '<div class="w-cap">' + rich(b.scheme.cap) + '</div>' : '') + '</div>';
      return w;
    }
    if (b.steps) return renderSteps(b.steps);
    if (b.anim) return renderAnim(b.anim);
    return document.createTextNode('');
  }

  // копирование с запасным путём: если буфер обмена недоступен, выделяем текст
  function copyText(text, btn, pre) {
    function done(msg) { btn.setAttribute('data-done', msg); setTimeout(function () { btn.removeAttribute('data-done'); }, 1600); }
    function fallback() {
      if (pre) { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      done('Выделено');
    }
    try { navigator.clipboard.writeText(text).then(function () { done('Скопировано'); }, fallback); } catch (e) { fallback(); }
  }
  // шапка блока кода: имя файла, версия Go (если вывод проверен запуском), копировать
  function codeHead(file, ver, text) {
    var h = el('div', 'code-h', '<span class="code-f">' + esc(file) + '</span>' +
      (ver ? '<span class="code-v">проверено на Go ' + esc(ver) + '</span>' : '') +
      '<button type="button" class="code-cp" aria-label="Скопировать код" title="Скопировать">' + ic(IC.copy, 16) + '</button>');
    var btn = h.querySelector('.code-cp');
    btn.addEventListener('click', function () { copyText(text, btn, h.parentNode && h.parentNode.querySelector('pre')); });
    return h;
  }

  // «Предскажи и запусти»: код с номерами строк, поле прогноза, кнопка показывает
  // вывод, заранее полученный запуском. Сначала прогноз, потом ответ — как в практикуме.
  var predictSeq = 0;
  function renderPredict(p) {
    var w = el('section', 'pr');
    w.setAttribute('aria-label', 'Предскажи и запусти');
    w.appendChild(codeHead(p.file || 'main.go', p.go || C.go, p.code));
    var lines = p.code.split('\n');
    var body = el('div', 'pr-code');
    var gut = el('pre', 'pr-gut', lines.map(function (x, i) { return i + 1; }).join('\n'));
    gut.setAttribute('aria-hidden', 'true');
    var pre = el('pre', 'pr-src'); pre.appendChild(el('code', null, esc(p.code)));
    body.appendChild(gut); body.appendChild(pre);
    w.appendChild(body);
    var id = 'pr' + (++predictSeq);
    var ask = el('div', 'pr-ask',
      '<label for="' + id + '">' + rich(p.q || 'Что выведет программа?') + '</label>' +
      '<div class="pr-row"><input id="' + id + '" type="text" autocomplete="off" placeholder="Твой прогноз">' +
      '<button type="button" class="btn pri">Запустить</button></div>');
    w.appendChild(ask);
    var res = el('div', 'pr-out');
    res.setAttribute('role', 'status');
    res.hidden = true;
    res.innerHTML = '<div class="pr-cmd">' + ic(IC.term, 14) + '<span>' + esc(p.cmd || 'go run .') + '</span></div>' +
      '<pre class="' + (p.err ? 'err' : '') + '"><code>' + esc(p.out) + '</code></pre>' +
      (p.after ? '<p class="pr-after">' + rich(p.after) + '</p>' : '');
    w.appendChild(res);
    var inp = ask.querySelector('input'), go = ask.querySelector('button');
    function run() {
      res.hidden = false;
      go.textContent = 'Запущено';
      go.disabled = true;
      var g = inp.value.trim();
      if (g && !res.querySelector('.pr-guess')) res.insertBefore(el('div', 'pr-guess', 'Твой прогноз: «' + esc(g) + '»'), res.firstChild);
    }
    go.addEventListener('click', run);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    return w;
  }

  // ── анимация ──
  // Сцена из элементов (box, tok, arrow, label, mark). Каждый шаг меняет состояние части элементов:
  // x, y, show, cls, t, s. Состояние шага N = начальное + все изменения шагов 0..N, поэтому «Назад» работает честно.
  var SVGNS = 'http://www.w3.org/2000/svg', animSeq = 0, animStops = [];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function tokWidth(t) { return 22 + String(t).length * 8.6; }

  function renderAnim(a) {
    var uid = 'm' + (++animSeq);
    var w = el('div', 'widget anim');
    w.innerHTML = '<div class="w-head"><div class="kind">Анимация</div><div class="w-title">' + rich(a.title) + '</div></div>';
    var body = el('div', 'w-body'); w.appendChild(body);
    var wrap = el('div', 'sc-wrap');
    // карточка состояния сбоку: a.side = { title, rows: [[имя, значение, класс]] }, шаг может заменить rows
    var sideBox = null;
    if (a.side) {
      var row = el('div', 'sc-row'); body.appendChild(row);
      row.appendChild(wrap);
      sideBox = el('aside', 'sc-side', '<div class="sc-side-t">' + rich(a.side.title) + '</div><dl></dl>');
      row.appendChild(sideBox);
    } else body.appendChild(wrap);
    var root = svg('svg', { viewBox: '0 0 ' + (a.w || 640) + ' ' + (a.h || 260), role: 'img', 'aria-label': a.title.replace(/<[^>]+>/g, '') });
    var defs = svg('defs', {});
    ['mut', 'hot', 'bad', 'ok'].forEach(function (c) {
      var mk = svg('marker', { id: uid + c, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      mk.appendChild(svg('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'mk-' + c }));
      defs.appendChild(mk);
    });
    root.appendChild(defs);
    wrap.appendChild(root);

    var nodes = {};
    a.els.forEach(function (d) {
      var g = svg('g', {}), n = { d: d, g: g };
      if (d.kind === 'box') {
        g.appendChild(svg('rect', { x: 0, y: 0, width: d.w, height: d.h, rx: 10 }));
        n.t = svg('text', { x: d.w / 2, y: d.s ? 26 : d.h / 2 + 5, 'text-anchor': 'middle', 'class': 't' }); g.appendChild(n.t);
        n.s = svg('text', { x: d.w / 2, y: 48, 'text-anchor': 'middle', 'class': 's' }); g.appendChild(n.s);
      } else if (d.kind === 'tok') {
        n.r = svg('rect', { height: 30, rx: 15, y: -15 }); g.appendChild(n.r);
        n.t = svg('text', { x: 0, y: 5, 'text-anchor': 'middle' }); g.appendChild(n.t);
      } else if (d.kind === 'arrow') {
        var len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
        n.len = len;
        n.line = svg('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, 'marker-end': 'url(#' + uid + 'mut)',
          'stroke-dasharray': len, 'stroke-dashoffset': len });
        g.appendChild(n.line);
      } else {
        n.t = svg('text', { x: 0, y: 0, 'text-anchor': d.anchor || 'middle' }); g.appendChild(n.t);
      }
      root.appendChild(g);
      nodes[d.id] = n;
    });

    var cap = el('div', 'sc-cap'); cap.setAttribute('aria-live', 'polite'); body.appendChild(cap);
    var ctl = el('div', 'sc-ctl');
    ctl.innerHTML = '<button class="btn" type="button" data-a="reset" title="С начала" aria-label="С начала">↺</button>' +
      '<button class="btn" type="button" data-a="prev" aria-label="Предыдущий шаг">' + ic(IC.back, 18) + '</button>' +
      '<button class="btn pri" type="button" data-a="play">▶ Пуск</button>' +
      '<button class="btn" type="button" data-a="next" aria-label="Следующий шаг">' + ic(IC.chev, 18) + '</button>' +
      '<span class="sc-bars" aria-hidden="true">' + a.steps.map(function () { return '<i></i>'; }).join('') + '</span>' +
      '<span class="n"></span>';
    body.appendChild(ctl);
    body.appendChild(el('div', 'sc-hint', 'Стрелки ← → на клавиатуре листают шаги, когда анимация в фокусе.'));

    var i = 0, n = a.steps.length, timer = null;
    function sideAt(k) {
      var rows = a.side.rows;
      for (var j = 0; j <= k; j++) if (a.steps[j].side) rows = a.steps[j].side;
      return rows;
    }

    function stateAt(k) {
      var st = {};
      a.els.forEach(function (d) {
        st[d.id] = { x: d.x || 0, y: d.y || 0, show: d.hide ? 0 : 1, cls: d.cls || '', t: d.t || '', s: d.s || '' };
      });
      for (var j = 0; j <= k; j++) {
        var set = a.steps[j].set || {};
        for (var id in set) for (var p in set[id]) st[id][p] = set[id][p];
      }
      return st;
    }
    function setText(node, txt) {
      var lines = String(txt).split('\n');
      if (node.getAttribute('data-v') === txt) return;
      node.setAttribute('data-v', txt);
      node.textContent = '';
      var x = node.getAttribute('x') || 0;
      lines.forEach(function (ln, k) {
        var ts = svg('tspan', { x: x, dy: k ? '1.35em' : 0 });
        ts.textContent = ln;
        node.appendChild(ts);
      });
    }
    function draw() {
      var st = stateAt(i);
      a.els.forEach(function (d) {
        var nd = nodes[d.id], s = st[d.id];
        nd.g.setAttribute('class', 'sc-el sc-' + d.kind + (s.cls ? ' ' + s.cls : '') + (s.show ? '' : ' off'));
        if (d.kind !== 'arrow') nd.g.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
        if (d.kind === 'arrow') {
          nd.line.style.strokeDashoffset = s.show ? 0 : nd.len;
          nd.line.setAttribute('marker-end', 'url(#' + uid + (/^(hot|bad|ok)$/.test(s.cls) ? s.cls : 'mut') + ')');
        }
        if (nd.t) setText(nd.t, s.t);
        if (nd.s) setText(nd.s, s.s);
        if (d.kind === 'tok') { var tw = tokWidth(s.t); nd.r.setAttribute('width', tw); nd.r.setAttribute('x', -tw / 2); }
      });
      cap.innerHTML = rich(a.steps[i].cap);
      if (sideBox) {
        sideBox.querySelector('dl').innerHTML = sideAt(i).map(function (r) {
          return '<dt>' + rich(r[0]) + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + rich(r[1]) + '</dd>';
        }).join('');
      }
      [].forEach.call(ctl.querySelectorAll('.sc-bars i'), function (b, k) { b.className = k <= i ? 'on' : ''; });
      ctl.querySelector('.n').textContent = (i + 1) + ' / ' + n;
      ctl.querySelector('[data-a="prev"]').disabled = i === 0;
      ctl.querySelector('[data-a="next"]').disabled = i === n - 1;
      ctl.querySelector('[data-a="play"]').textContent = timer ? '⏸ Пауза' : (i === n - 1 ? '▶ Ещё раз' : '▶ Пуск');
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    animStops.push(stop);
    function play() {
      if (i === n - 1) i = 0;
      timer = setInterval(function () {
        if (i < n - 1) { i++; draw(); }
        if (i === n - 1) { stop(); draw(); }
      }, a.speed || 2800);
      draw();
    }
    ctl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var act = b.getAttribute('data-a');
      if (act === 'play') { if (timer) stop(); else play(); draw(); return; }
      stop();
      if (act === 'next') i = Math.min(n - 1, i + 1);
      if (act === 'prev') i = Math.max(0, i - 1);
      if (act === 'reset') i = 0;
      draw();
    });
    // клавиатура: стрелки листают шаги, пока фокус внутри анимации
    w.tabIndex = -1;
    w.addEventListener('click', function (e) { if (!e.target.closest('button, a')) w.focus({ preventScroll: true }); });
    w.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (e.target.closest('input, textarea')) return;
      e.preventDefault(); stop();
      i = e.key === 'ArrowRight' ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
      draw();
    });
    if (reduceMotion) ctl.querySelector('[data-a="play"]').hidden = true;
    draw();
    return w;
  }

  function renderSteps(st) {
    var w = el('div', 'widget');
    var i = 0, n = st.items.length;
    w.innerHTML = '<div class="w-head"><div class="kind">Пошагово</div><div class="w-title">' + rich(st.title) + '</div></div>';
    var body = el('div', 'w-body'); w.appendChild(body);
    function draw() {
      var it = st.items[i];
      body.innerHTML = '<div class="w-bars">' + st.items.map(function (x, k) { return '<i' + (k <= i ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' +
        '<div class="w-step-n">Шаг ' + (i + 1) + ' из ' + n + '</div>' +
        '<div class="w-step-t">' + rich(it.t) + '</div>' +
        '<p>' + rich(it.d) + '</p>' +
        (it.code ? '<pre><code>' + esc(it.code) + '</code></pre>' : '') +
        '<div class="w-nav"><button class="btn" type="button" data-d="-1"' + (i === 0 ? ' disabled' : '') + '>← Назад</button>' +
        '<button class="btn pri" type="button" data-d="1"' + (i === n - 1 ? ' disabled' : '') + '>Далее →</button></div>';
    }
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      i = Math.max(0, Math.min(n - 1, i + (+b.getAttribute('data-d'))));
      draw();
    });
    draw();
    return w;
  }

  function cmdBlock(text) {
    var row = el('div', 'cmd');
    var pre = el('pre'); pre.appendChild(el('code', null, esc(text)));
    var cp = el('button', 'copy', 'Копировать'); cp.type = 'button';
    cp.addEventListener('click', function () { copyText(text, cp, pre); });
    row.appendChild(pre); row.appendChild(cp);
    return row;
  }

  // ── страница урока ──
  // Урок можно разбить на части маркерами { part: 'Название' } в blocks. Тогда теория идёт
  // по частям-страницам, а «Сделай руками» и «Проверка» становятся отдельными частями практики.
  // Урок без маркеров показывается одной страницей, как раньше.
  function partsOf(les) {
    if (!les.blocks.some(function (b) { return b.part; })) return null;
    var parts = [], cur = null;
    les.blocks.forEach(function (b) {
      if (b.part) { cur = { title: b.part, kind: 'theory', blocks: [] }; parts.push(cur); return; }
      if (!cur) { cur = { title: 'Введение', kind: 'theory', blocks: [] }; parts.push(cur); }
      cur.blocks.push(b);
    });
    if (les.hands) parts.push({ title: 'Сделай руками', kind: 'practice', type: 'hands' });
    parts.push({ title: 'Проверка', kind: 'practice', type: 'test' });
    return parts;
  }
  // Часть теории засчитывается ответами на её вопросы «Проверь себя» (вопросы теста с полем part = номер части).
  // Если своих вопросов у части нет — когда страница дочитана до конца, но не в момент открытия.
  function ownQuestions(les, k) {
    return les.test.map(function (q, i) { return { q: q, i: i }; }).filter(function (x) { return x.q.part === k + 1; });
  }
  function partDone(id, k, parts) {
    var les = C.lessons[id], st = S.lessons[id] || {}, p = parts[k];
    if (p.type === 'test') return !!st.done;
    if (p.type === 'hands' && les.hands.check) return les.hands.check.every(function (q, i) { return st.h && st.h[i]; });
    var own = ownQuestions(les, k);
    if (own.length) return own.every(function (x) { return st.t && st.t[x.i]; });
    return !!(st.seen && st.seen[k]);
  }
  function markIfDone(les, st) {
    if (!st.done && les.test.every(function (q, i) { return st.t[i]; })) {
      st.done = today(); st.rev = [0, 0, 0]; save();
    }
  }

  // время чтения: ~150 слов в минуту по тексту блоков; практика — по числу шагов и вопросов
  function textOf(x) {
    if (typeof x === 'string') return x.replace(/<[^>]+>/g, ' ');
    if (Array.isArray(x)) return x.map(textOf).join(' ');
    if (x && typeof x === 'object') return Object.keys(x).map(function (k) { return k === 'els' ? '' : textOf(x[k]); }).join(' ');
    return '';
  }
  function partMin(les, parts, k) {
    var p = parts[k];
    if (p.type === 'hands') return Math.max(5, les.hands.steps.length * 3);
    if (p.type === 'test') return Math.max(3, Math.round(les.test.filter(function (q) { return !q.part; }).length * 0.75));
    var words = textOf(p.blocks).split(/\s+/).filter(Boolean).length + (k === 0 ? textOf([les.lead, les.simple]).split(/\s+/).length : 0);
    return Math.max(1, Math.round(words / 150));
  }

  // «Простыми словами» и отдельно «Скажи на собесе». Фразу берём из les.say или из абзаца simple,
  // который начинается с «Как сказать на собесе:».
  var SAY_RE = /^\s*<b>\s*Как сказать на собесе:?\s*<\/b>\s*/;
  function appendSimple(to, les) {
    to.appendChild(el('p', 'lead', rich(les.lead)));
    if (!les.simple) return;
    var say = les.say || '', paras = les.simple.filter(function (p) {
      if (SAY_RE.test(p)) { say = say || p.replace(SAY_RE, ''); return false; }
      return true;
    });
    var box = el('section', 'simple');
    box.setAttribute('aria-label', 'Коротко');
    box.innerHTML = '<div class="simple-b"><div class="kind">Простыми словами</div>' + paras.map(function (p) { return '<p>' + rich(p) + '</p>'; }).join('') + '</div>' +
      (say ? '<div class="say"><div class="say-t"><div class="kind">Скажи на собесе</div><p>' + rich(say) + '</p></div>' +
        '<button type="button" class="btn say-cp">' + ic(IC.copy) + '<span>Скопировать</span></button></div>' : '');
    var cp = box.querySelector('.say-cp');
    if (cp) cp.addEventListener('click', function () { copyText(box.querySelector('.say p').innerText, cp, box.querySelector('.say p')); });
    to.appendChild(box);
  }

  // partsMode: вопросы, привязанные к частям теории, на финальной странице не повторяются,
  // но считаются в общем «Решено N из M».
  function appendTest(to, les, st, partsMode, onChange) {
    if (les.summary) {
      to.appendChild(el('h2', null, 'Главное из урока'));
      var ul = el('ul', 'list');
      les.summary.forEach(function (s) { ul.appendChild(el('li', null, rich(s))); });
      to.appendChild(ul);
    }
    var shown = les.test.map(function (q, i) { return { q: q, i: i }; })
      .filter(function (x) { return !(partsMode && x.q.part); });
    var inParts = les.test.length - shown.length;
    to.appendChild(el('h2', null, 'Проверка'));
    to.appendChild(el('p', null, 'Вопрос засчитывается после верного ответа, урок — когда засчитаны все вопросы' +
      (inParts ? ', включая ' + inParts + ' ' + plural(inParts, 'вопрос', 'вопроса', 'вопросов') + ' «Проверь себя» в частях теории' : '') +
      '. После каждого ответа появляется объяснение: читай его, даже если ответил верно. Ошибся — разберись по объяснению и ответь ещё раз.'));
    var tally = el('div', 'tally');
    var doneBox = el('div');
    function upd() {
      var solved = les.test.filter(function (q, i) { return st.t[i]; }).length;
      tally.textContent = 'Решено ' + solved + ' из ' + les.test.length + (inParts ? ' — вместе с вопросами в частях теории' : '');
      markIfDone(les, st);
      renderSide();
      if (onChange) onChange();
      doneBox.innerHTML = st.done ? '<div class="done-msg"><b>Урок пройден.</b> Его вопросы вернутся на главную через 1, 3 и 7 дней — в блоке «Повторить сегодня».</div>' : '';
    }
    shown.forEach(function (x, j) {
      to.appendChild(renderQ(x.q, 'Вопрос ' + (j + 1) + ' из ' + shown.length, {
        solved: function () { return !!st.t[x.i]; },
        solve: function () { st.t[x.i] = 1; save(); }
      }, upd));
    });
    to.appendChild(tally); to.appendChild(doneBox); upd();
    if (inParts) {
      var left = les.test.map(function (q, i) { return { q: q, i: i }; }).filter(function (x) { return x.q.part && !st.t[x.i]; });
      if (left.length) {
        var parts = {};
        left.forEach(function (x) { parts[x.q.part] = 1; });
        to.appendChild(el('div', 'callout note', '<b>Ещё не отвечено</b>Вопросы «Проверь себя» в ' +
          Object.keys(parts).map(function (n) { return 'части ' + n; }).join(', ') + '. Урок засчитается, когда будут решены и они.'));
      }
    }
  }

  function appendNextLesson(to, m) {
    var nx = nextReady(m.n);
    if (nx) to.appendChild(el('a', 'next', '<span><small>Следующий урок · ' + nx.n + '</small><b>' + esc(nx.t) + '</b></span>' + ic(IC.arrow, 20))).href = '#' + nx.id;
    else to.appendChild(el('div', 'next', '<span><small>Дальше</small><b>Следующие уроки скоро появятся</b></span>'));
  }

  // «Видео по теме»: les.videos = [{ url, title, channel, dur, why, part }]; без part — на странице проверки
  function appendVideos(to, les, k, parts) {
    var vs = (les.videos || []).filter(function (v) {
      return v.part ? v.part === k + 1 : (!parts || parts[k].type === 'test');
    });
    if (!vs.length) return;
    var sec = el('section', 'vids');
    sec.innerHTML = '<h3>Видео по теме</h3><p class="vids-sub">Если удобнее посмотреть. Открывается на YouTube в новой вкладке.</p>' +
      '<div class="vid-list">' + vs.map(function (v) {
        var id = (String(v.url).match(/[?&]v=([\w-]{6,})|youtu\.be\/([\w-]{6,})/) || []);
        var yt = id[1] || id[2];
        return '<a class="vid" href="' + esc(v.url) + '" target="_blank" rel="noopener">' +
          '<span class="vid-img">' + (yt ? '<img src="https://i.ytimg.com/vi/' + yt + '/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">' : '') +
          (v.dur ? '<span class="vid-dur">' + esc(v.dur) + '</span>' : '') + '</span>' +
          '<span class="vid-t">' + esc(v.title) + '</span>' +
          '<span class="vid-c">' + esc(v.channel || '') + (v.why ? ' · ' + esc(v.why) : '') + '</span></a>';
      }).join('') + '</div>';
    to.appendChild(sec);
  }

  function fillTerms(slot, label) {
    var keys = Object.keys(usedTerms);
    if (keys.length) {
      slot.innerHTML = '<details class="terms"><summary>' + label + ': ' + keys.length + ' ' + plural(keys.length, 'термин', 'термина', 'терминов') + '</summary><ul>' +
        keys.map(function (k) { return '<li><button type="button" class="term" data-k="' + k + '">' + esc(C.glossary[k].t) + '</button></li>'; }).join('') + '</ul></details>';
    }
  }

  // полоса частей: отрезок на часть — зелёный засчитана, синий — ты здесь
  function partBar(id, parts, k) {
    var nav = el('nav', 'segbar', parts.map(function (p, i) {
      var ok = partDone(id, i, parts);
      return '<a class="seg-i' + (ok ? ' ok' : '') + (i === k ? ' cur' : '') + '" href="#' + id + '/' + (i + 1) + '"' + (i === k ? ' aria-current="step"' : '') + '>' +
        '<span class="seg-line"></span><span class="seg-k">' + (p.kind === 'theory' ? 'Теория' : 'Практика') + ' · ' + (i + 1) +
        (ok ? ' · засчитана' : i === k ? ' · сейчас' : '') + '</span><span class="seg-t">' + esc(p.title) + '</span></a>';
    }).join(''));
    nav.setAttribute('aria-label', 'Части урока');
    return nav;
  }

  // ── озвучка ──
  // Голос браузера читает абзацы части по очереди; код, схемы и вопросы остаются на экране.
  var speech = { on: false, paused: false, items: [], i: 0, btn: null };
  var canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function speakStop() {
    if (!canSpeak) return;
    speech.on = false; speech.paused = false; speech.cur = null;
    window.speechSynthesis.cancel();
    speakMark(null);
    speakUi();
  }
  function speakMark(node) {
    [].forEach.call(document.querySelectorAll('.reading-now'), function (x) { x.classList.remove('reading-now'); });
    if (node) node.classList.add('reading-now');
  }
  function ruVoice() {
    var vs = window.speechSynthesis.getVoices();
    return vs.filter(function (v) { return /^ru/i.test(v.lang); })[0] || null;
  }
  function speakNext() {
    if (!speech.on) return;
    if (speech.i >= speech.items.length) { speakStop(); return; }
    var node = speech.items[speech.i];
    var u = new SpeechSynthesisUtterance(node.innerText.replace(/\s+/g, ' '));
    u.lang = 'ru-RU'; u.rate = S.ui.rate;
    var v = ruVoice(); if (v) u.voice = v;
    speech.cur = u;
    u.onend = function () { if (speech.cur === u && speech.on && !speech.paused) { speech.i++; speakNext(); } };
    speakMark(node);
    window.speechSynthesis.speak(u);
  }
  function speakUi() {
    var row = speech.row;
    if (!row) return;
    row.querySelector('[data-sp="play"]').innerHTML = speech.on && !speech.paused ? ic(IC.pause) + '<span>Пауза</span>' :
      ic(IC.sound) + '<span>' + (speech.on ? 'Продолжить' : 'Слушать часть · ' + row.getAttribute('data-min') + ' мин') + '</span>';
    row.querySelector('[data-sp="stop"]').hidden = !speech.on;
    row.querySelector('[data-sp="rate"]').textContent = String(S.ui.rate).replace('.', ',') + '×';
  }
  function listenRow(body, min) {
    if (!canSpeak) return null;
    var row = el('div', 'listen');
    row.setAttribute('data-min', min);
    row.innerHTML = '<button type="button" class="btn listen-b" data-sp="play"></button>' +
      '<button type="button" class="btn" data-sp="stop" aria-label="Остановить" hidden>' + ic(IC.stop) + '</button>' +
      '<button type="button" class="btn listen-r" data-sp="rate" title="Скорость"></button>' +
      '<span class="listen-n">читает голос браузера, код и схемы — на экране</span>';
    row.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sp]');
      if (!b) return;
      var a = b.getAttribute('data-sp'), ss = window.speechSynthesis;
      if (a === 'rate') {
        var rates = [1, 1.25, 1.5, 0.9];
        S.ui.rate = rates[(rates.indexOf(S.ui.rate) + 1) % rates.length]; save();
        if (speech.on && !speech.paused) { speech.cur = null; ss.cancel(); speakNext(); }
      } else if (a === 'stop') speakStop();
      else if (!speech.on) {
        speech.items = [].slice.call(body.querySelectorAll('h3, p, li, .cs-b')).filter(function (x) {
          return !x.closest('.q, .pr, .widget, .segbar, .pt-foot, .listen, details.terms, .say, .vids') && x.innerText.trim();
        });
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

  function renderLesson(id, pn) {
    var les = C.lessons[id], m = meta(id), st = L(id), parts = partsOf(les);
    usedTerms = {};
    page.innerHTML = '';
    crumbs = [{ t: m.sec.name, href: '#' }, { t: 'Урок ' + m.n, href: '#' + id }];
    var crumb = el('div', 'crumb', '<span>Урок ' + m.n + ' · ' + esc(m.sec.name) + '</span>' + (les.time ? '<span>' + esc(les.time) + '</span>' : ''));
    page.appendChild(crumb);
    page.appendChild(el('h1', 'title', esc(m.t)));

    if (!parts) {
      appendSimple(page, les);
      var slot = el('div'); page.appendChild(slot);
      les.blocks.forEach(function (b) { page.appendChild(renderBlock(b)); });
      if (les.hands) page.appendChild(renderHands(les.hands, id, st));
      appendTest(page, les, st, false);
      appendVideos(page, les, 0, null);
      appendNextLesson(page, m);
      fillTerms(slot, 'Словарь урока');
      usedTerms = null;
      return;
    }

    var k = Math.min(Math.max(pn || 1, 1), parts.length) - 1, part = parts[k];
    var min = partMin(les, parts, k);
    st.seen = st.seen || {};
    crumbs.push({ t: 'Часть ' + (k + 1) });

    var bar = partBar(id, parts, k);
    page.appendChild(bar);
    var body = el('div', 'part-body'); page.appendChild(body);
    body.appendChild(el('div', 'pt-meta', 'Часть ' + (k + 1) + ' из ' + parts.length + ' · ' + (part.kind === 'theory' ? 'теория' : 'практика') + ' · ≈ ' + min + ' мин'));
    body.appendChild(el('h2', 'pt-title', esc(part.title)));
    if (part.kind === 'theory') { var lr = listenRow(body, min); if (lr) body.appendChild(lr); }
    if (k === 0) appendSimple(body, les);
    var termsSlot = el('div'); body.appendChild(termsSlot);

    var foot = el('div', 'pt-foot');
    var status = el('div', 'pt-status');
    status.setAttribute('role', 'status');
    // честный статус части внизу: что ещё нужно, чтобы её засчитать
    function setStatus() {
      var done = partDone(id, k, parts), txt;
      if (done) txt = part.type === 'test' ? 'Урок пройден' : 'Часть засчитана';
      else if (part.type === 'test') {
        var left = les.test.filter(function (q, i) { return !st.t[i]; }).length;
        txt = 'Осталось ' + left + ' ' + plural(left, 'вопрос', 'вопроса', 'вопросов') + ' — и урок пройден';
      } else if (part.type === 'hands') {
        var hl = (les.hands.check || []).filter(function (q, i) { return !(st.h && st.h[i]); }).length;
        txt = 'Ответь на ' + hl + ' ' + plural(hl, 'вопрос', 'вопроса', 'вопросов') + ' «Проверь, что понял» — и задание засчитано';
      } else {
        var own = ownQuestions(les, k), ol = own.filter(function (x) { return !st.t[x.i]; }).length;
        txt = own.length ? 'Ответь ещё на ' + ol + ' ' + plural(ol, 'вопрос', 'вопроса', 'вопросов') + ' — и часть засчитана' : 'Часть засчитается, когда дочитаешь до конца';
      }
      status.className = 'pt-status' + (done ? ' ok' : '');
      status.innerHTML = '<span class="pt-st-ic">' + (done ? ic(IC.check, 13) : '') + '</span><span>' + txt + '</span>';
    }
    function refreshBar() {
      var nb = partBar(id, parts, k);
      bar.replaceWith(nb); bar = nb;
      setStatus();
      renderSide();
    }

    if (part.type === 'hands') body.appendChild(renderHands(les.hands, id, st, refreshBar));
    else if (part.type === 'test') appendTest(body, les, st, true, refreshBar);
    else {
      part.blocks.forEach(function (b) { body.appendChild(renderBlock(b)); });
      var own = ownQuestions(les, k);
      if (own.length) {
        body.appendChild(el('div', 'qs-head self-check', '<h3>Проверь себя</h3><p>' +
          (own.length === 1 ? 'Вопрос' : own.length + ' ' + plural(own.length, 'вопрос', 'вопроса', 'вопросов')) +
          ' по этой части. Часть засчитается, когда ответишь верно. Эти вопросы входят в проверку урока.</p>' +
          '<p class="kbd-hint">Цифры 1–9 выбирают ответ в вопросе, где курсор. Enter — к следующему вопросу.</p>'));
        own.forEach(function (x, j) {
          body.appendChild(renderQ(x.q, 'Вопрос ' + (j + 1) + ' из ' + own.length, {
            solved: function () { return !!st.t[x.i]; },
            solve: function () { st.t[x.i] = 1; save(); }
          }, function () { markIfDone(les, st); refreshBar(); }));
        });
      }
    }
    appendVideos(body, les, k, parts);

    var nav = el('div', 'part-nav');
    if (k > 0) nav.appendChild(el('a', 'back', '<small>← Часть ' + k + '</small><b>' + esc(parts[k - 1].title) + '</b>')).href = '#' + id + '/' + k;
    if (k < parts.length - 1) {
      var nx = parts[k + 1];
      nav.appendChild(el('a', 'fwd', '<span><small>Дальше · часть ' + (k + 2) + ' · ≈ ' + partMin(les, parts, k + 1) + ' мин</small><b>' + esc(nx.title) + '</b></span>' + ic(IC.arrow, 20))).href = '#' + id + '/' + (k + 2);
    }
    foot.appendChild(status);
    foot.appendChild(nav);
    body.appendChild(foot);
    setStatus();
    if (k === parts.length - 1) appendNextLesson(body, m);

    // теория без своих вопросов засчитывается, когда дочитана до кнопок внизу
    if (part.kind === 'theory' && !ownQuestions(les, k).length && !st.seen[k] && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) {
          st.seen[k] = 1; save(); io.disconnect(); refreshBar();
        }
      });
      io.observe(status);
      animStops.push(function () { io.disconnect(); });
    }

    fillTerms(termsSlot, 'Термины этой части');
    usedTerms = null;
  }

  function renderHands(hd, id, st, onChange) {
    var w = el('div', 'widget hands');
    w.innerHTML = '<div class="w-head"><div class="kind">Сделай руками</div><div class="w-title">' + rich(hd.title) + '</div></div>';
    var body = el('div', 'w-body'); w.appendChild(body);
    body.appendChild(el('p', null, rich(hd.goal)));
    var ol = el('ol', 'hs');
    hd.steps.forEach(function (s) {
      var li = el('li');
      li.appendChild(el('div', 'hs-t', rich(s.t)));
      if (s.d) li.appendChild(el('p', null, rich(s.d)));
      if (s.cmd) li.appendChild(cmdBlock(s.cmd));
      if (s.code) { var pre = el('pre'); pre.appendChild(el('code', null, esc(s.code))); li.appendChild(pre); }
      if (s.out) {
        li.appendChild(el('div', 'out-l', 'Что должно получиться'));
        var o = el('pre', 'out'); o.appendChild(el('code', null, esc(s.out))); li.appendChild(o);
      }
      if (s.after) li.appendChild(el('p', null, rich(s.after)));
      ol.appendChild(li);
    });
    body.appendChild(ol);
    if (hd.trouble) {
      body.appendChild(el('div', 'trouble', '<div class="kind">Если не получается</div><ul>' +
        hd.trouble.map(function (t) { return '<li>' + rich(t) + '</li>'; }).join('') + '</ul>'));
    }
    if (hd.check) {
      body.appendChild(el('div', 'qs-head', '<div class="kind">Проверь, что понял</div><p>Отвечай по тому, что увидел у себя. Задание засчитывается, когда на все вопросы дан верный ответ.</p>'));
      hd.check.forEach(function (q, i) {
        body.appendChild(renderQ(q, 'Вопрос ' + (i + 1) + ' из ' + hd.check.length, {
          solved: function () { return !!st.h[i]; },
          solve: function () { st.h[i] = 1; save(); }
        }, function () { if (onChange) onChange(); else renderSide(); }));
      });
    }
    return w;
  }

  // ── главная ──
  var revMem = {};
  function dueList() {
    var t = today(), out = [];
    Object.keys(S.lessons).forEach(function (id) {
      var st = S.lessons[id];
      if (!st.done || !ready(id)) return;
      st.rev = st.rev || [0, 0, 0];
      var k = st.rev.indexOf(0);
      if (k < 0) return;
      if (t >= addDays(st.done, STAGES[k])) out.push({ id: id, k: k });
    });
    return out;
  }

  function renderHome() {
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>Главная</span>'));
    page.appendChild(el('h1', 'title', esc(C.title)));
    page.appendChild(el('p', 'lead', 'Курс по Go от слайсов до рантайма, бэкенда и system design: ' + TOTAL + ' уроков, в каждом — объяснение «почему», схемы, задание руками и проверка. Плюс практикум, где ты строишь сервисы.'));

    var todo = firstTodo();
    if (todo) {
      var started = doneCount(ALL) > 0;
      var a = el('a', 'start', '<small>' + (started ? 'Продолжить' : 'Начать') + '</small><b>Урок ' + todo.n + '. ' + esc(todo.t) + ' →</b>');
      a.href = '#' + todo.id; page.appendChild(a);
    }

    page.appendChild(el('h2', null, 'Повторить сегодня'));
    var due = dueList();
    if (!due.length) {
      page.appendChild(el('div', 'review-empty', 'Сегодня повторять нечего. Пройди урок — через день его вопросы появятся здесь, потом ещё через 3 и 7 дней после прохождения.'));
    }
    due.forEach(function (d) {
      var les = C.lessons[d.id], m = meta(d.id);
      var key = d.id + ':' + d.k + ':' + today();
      revMem[key] = revMem[key] || {};
      var rnd = seeded(hash(key));
      var pick = shuffle(les.test.map(function (q, i) { return i; }), rnd).slice(0, Math.min(3, les.test.length));
      var card = el('div', 'rev-card', '<div class="kind">Повтор ' + (d.k + 1) + ' из 3</div><div class="w-title">Урок ' + m.n + '. ' + esc(m.t) + '</div>');
      pick.forEach(function (qi, j) {
        card.appendChild(renderQ(les.test[qi], 'Вопрос ' + (j + 1) + ' из ' + pick.length, {
          solved: function () { return !!revMem[key][qi]; },
          solve: function () {
            revMem[key][qi] = 1;
            var all = pick.every(function (x) { return revMem[key][x]; });
            if (all) { S.lessons[d.id].rev[d.k] = 1; save(); card.appendChild(el('div', 'done-msg', '<b>Повтор засчитан.</b>')); }
          }
        }));
      });
      page.appendChild(card);
    });

    var grid = el('div', 'cards-grid');
    C.sections.forEach(function (sec) {
      var dn = doneCount(sec.lessons);
      grid.appendChild(el('div', 'sec-card', '<h3 class="k-' + sec.kind + '">' + esc(sec.name) + ' — ' + sec.lessons.length + ' ' + plural(sec.lessons.length, 'урок', 'урока', 'уроков') + '</h3>' +
        '<div class="bar"><i style="width:' + (dn / sec.lessons.length * 100) + '%"></i></div>' +
        '<div class="bar-t">Пройдено ' + dn + ' из ' + sec.lessons.length + '</div><p>' + esc(sec.about) + '</p>'));
    });
    page.appendChild(grid);
    var pr = el('a', 'sec-card practice', '<h3 class="k-backend">Практикум — сервисы своими руками</h3><p>Лестница: 8 уровней по 8 шагов, от первого endpoint до профилирования. Плюс задачи «предскажи вывод» и задания из уроков.</p>');
    pr.href = '#practice'; pr.style.display = 'block'; pr.style.marginTop = '12px'; pr.style.textDecoration = 'none'; pr.style.color = 'inherit';
    page.appendChild(pr);

    page.appendChild(el('h2', null, 'Как заниматься'));
    var how = el('ul', 'list');
    [
      'Цель — понять, а не прочитать. Схема на каждый урок: прочитал → сделал задание руками → ответил на вопросы «Проверь, что понял» → прошёл проверку урока.',
      'Слова, подчёркнутые пунктиром, — термины. Нажми на такое слово — появится определение. Все термины собраны в <a href="#glossary">словаре курса</a>.',
      'Задания руками лежат в папке <code>study/practice</code> репозитория. Запускай из неё: <code>go run ./i1</code>. Каждый вывод в уроках получен запуском.',
      'После каждого ответа в проверке показывается объяснение — и когда ответ верный, и когда нет.',
      'Через 1, 3 и 7 дней после того, как урок пройден, здесь появится «Повторить сегодня» — 3 вопроса из этого урока.',
      'Один урок за заход. Пропустил неделю — ничего не сгорело, продолжаешь с того же места.'
    ].forEach(function (t) { how.appendChild(el('li', null, t)); });
    page.appendChild(how);
  }

  // ── словарь ──
  function renderGlossary() {
    var refs = {};
    Object.keys(C.lessons).forEach(function (id) {
      var txt = JSON.stringify(C.lessons[id]), re = /\{\{([a-z0-9-]+)/g, m;
      while ((m = re.exec(txt))) { (refs[m[1]] = refs[m[1]] || {})[id] = 1; }
    });
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>Словарь</span>'));
    page.appendChild(el('h1', 'title', 'Словарь курса'));
    var keys = Object.keys(C.glossary).sort(function (a, b) { return C.glossary[a].t.localeCompare(C.glossary[b].t, 'ru'); });
    page.appendChild(el('p', 'lead', keys.length + ' ' + plural(keys.length, 'термин', 'термина', 'терминов') + '. Словарь пополняется вместе с уроками.'));
    var dl = el('dl', 'gloss');
    keys.forEach(function (k) {
      var g = C.glossary[k];
      var r = refs[k] ? Object.keys(refs[k]).map(function (id) { var m = meta(id); return '<a href="#' + id + '">урок ' + m.n + '</a>'; }).join(', ') : '';
      dl.appendChild(el('dt', null, esc(g.t) + (g.en ? '<small>' + esc(g.en) + '</small>' : '')));
      dl.appendChild(el('dd', null, esc(g.d) + (r ? '<span class="ref">Встречается: ' + r + '</span>' : '')));
    });
    page.appendChild(dl);
  }

  // ── практикум ──
  function renderPractice() {
    page.innerHTML = '';
    page.appendChild(el('div', 'crumb', '<span>Практикум</span>'));
    page.appendChild(el('h1', 'title', 'Практикум'));
    page.appendChild(el('p', 'lead', 'Здесь ты не читаешь, а пишешь код. Всё лежит у тебя в репозитории и работает без интернета.'));
    page.appendChild(el('h2', null, 'Лестница — сервисы с нуля'));
    page.appendChild(el('p', null, '8 уровней по 8 шагов: каталог товаров, корзина на Redis, заказы и транзакции, гонки на складе, Kafka, индексы, саги, профилирование. У каждого шага — ТЗ, критерий готовности и вопросы на защиту.'));
    var a = el('a', 'start', '<small>Открыть</small><b>Лестница бэкендера →</b>');
    a.href = '/ladder.html'; page.appendChild(a);
    page.appendChild(el('h2', null, 'Задания к урокам'));
    page.appendChild(el('p', null, 'Запускай из папки <code>study/practice</code>. Сначала предскажи или напиши, потом запусти.'));
    var t = '<table><thead><tr><th>Команда</th><th>Тема</th><th>Урок</th></tr></thead><tbody>' +
      [['go run ./s1', 'Модель слайса: заголовок, len и cap', 3],
       ['go run ./s2', 'Нарезка и общий массив', 4],
       ['go run ./s3', 'append и функции', 5],
       ['go run ./s4', 'copy, удаление, nil, range', 5],
       ['go run ./s5', 'Слайсы и память', 26],
       ['go run ./i1', 'Stringer и наборы методов', 10],
       ['go test ./i2', 'Развязать сервис и базу: интерфейс и фейк', 11],
       ['go run ./i3', 'Цена упаковки и type switch', 12],
       ['go run ./i4', 'typed nil и сравнение интерфейсов', 13]
      ].map(function (r) {
        var m = ALL.filter(function (x) { return x.n === r[2]; })[0];
        var link = m && ready(m.id) ? '<a href="#' + m.id + '">' + r[2] + '</a>' : r[2];
        return '<tr><td><code>' + r[0] + '</code></td><td>' + r[1] + '</td><td>' + link + '</td></tr>';
      }).join('') + '</tbody></table>';
    page.appendChild(el('div', 'tbl', t));
  }

  // ── всплывающее определение ──
  var pop = document.getElementById('pop');
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.term');
    if (t) {
      e.preventDefault(); e.stopPropagation();
      var g = C.glossary[t.getAttribute('data-k')];
      if (!g) return;
      pop.innerHTML = '<b>' + esc(g.t) + '</b>' + (g.en ? '<small>' + esc(g.en) + '</small>' : '') + '<p>' + esc(g.d) + '</p><p><a href="#glossary">Весь словарь →</a></p>';
      pop.hidden = false;
      var r = t.getBoundingClientRect();
      var left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12);
      pop.style.left = Math.max(8, left) + 'px';
      pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
      return;
    }
    if (!e.target.closest('#pop')) pop.hidden = true;
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.hidden = true; });

  // ── маршруты ──
  // ── клавиатура в вопросах ──
  // Цифры выбирают вариант в вопросе, где фокус (или в первом нерешённом на экране), Enter — к следующему.
  function activeQ() {
    var f = document.activeElement && document.activeElement.closest && document.activeElement.closest('.q');
    if (f) return f;
    var qs = [].slice.call(page.querySelectorAll('.q:not(.solved)'));
    return qs.filter(function (q) { var r = q.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; })[0] || null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, .widget.anim')) return;
    if (/^[1-9]$/.test(e.key)) {
      var q = activeQ(), b = q && q.querySelector('.opt[data-n="' + e.key + '"]');
      if (b && !b.disabled) { e.preventDefault(); b.focus(); b.click(); }
    } else if (e.key === 'Enter' && t && t.closest && t.closest('.q .opt')) {
      var cur = t.closest('.q'), all = [].slice.call(page.querySelectorAll('.q'));
      var nx = all.slice(all.indexOf(cur) + 1).filter(function (x) { return !x.classList.contains('solved'); })[0];
      if (nx && cur.classList.contains('solved')) {
        e.preventDefault();
        nx.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        var o = nx.querySelector('.opt, input, .card-btn'); if (o) o.focus({ preventScroll: true });
      }
    }
  });

  // ── маршруты ──
  function route() {
    pop.hidden = true;
    speakStop(); speech.row = null;
    animStops.forEach(function (f) { f(); });
    animStops = [];
    var seg = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    var id = seg[0];
    current = id;
    currentPart = parseInt(seg[1], 10) || 1;
    crumbs = [];
    if (id === 'glossary') { crumbs = [{ t: 'Словарь' }]; renderGlossary(); }
    else if (id === 'practice') { crumbs = [{ t: 'Практикум' }]; renderPractice(); }
    else if (id && ready(id)) renderLesson(id, currentPart);
    else { current = ''; crumbs = [{ t: 'Сегодня' }]; renderHome(); }
    renderSide();
    renderTop();
    applyFocus();
    closeMenu();
    window.scrollTo(0, 0);
    var m = meta(current);
    document.title = (m ? m.t + ' · ' : '') + C.title;
  }
  window.addEventListener('hashchange', route);
  applyTheme();
  route();
})();
