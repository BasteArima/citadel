// Окно поиска (Ctrl K) — одно на страницу курса и страницы сайта.
// scopes: [{ id, label, find(q) → Promise<{ places, terms }> }]. Результат — { kind, title, sub, href, course }:
// kind — lesson, part, page, term, course. На странице курса два охвата: «этот курс» ищет в браузере
// (работает без сети), «все курсы» — на сервере (/api/search); на страницах сайта — только «все курсы».
// go(hit) открывает результат; по умолчанию — переход по href.

const ICON = '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const BOOK = ICON + '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/></svg>';
const LENS = '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Поиск по всем курсам на сервере.
export const allCourses = {
  id: 'all', label: 'Все курсы',
  async find(q) {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('сервер ответил ' + r.status);
    return r.json();
  }
};

let box = null;
let lastScope = null;

export function openSearch(opts) {
  if (box) return;
  const scopes = opts.scopes;
  let scope = scopes.find((s) => s.id === lastScope) || scopes[0];
  box = document.createElement('div');
  box.className = 'sk-back';
  box.innerHTML = '<div class="sk" role="dialog" aria-modal="true" aria-label="Поиск">' +
    '<div class="sk-in">' + LENS + '<label for="sk-q" class="sr-only">Поиск по урокам и терминам</label>' +
    '<input id="sk-q" type="search" autocomplete="off" placeholder="Урок, часть или термин"><span class="kbd">Esc</span></div>' +
    '<div class="sk-scope" role="group" aria-label="Где искать">' + scopes.map((s) =>
      (scopes.length > 1 ? '<button type="button" class="chip" data-s="' + esc(s.id) + '">' + esc(s.label) + '</button>' : '<span class="chip acc">' + esc(s.label) + '</span>')).join('') + '</div>' +
    '<div class="sk-res" role="listbox" aria-label="Результаты"></div>' +
    '<div class="sk-foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> выбрать</span><span><span class="kbd">Enter</span> открыть</span><span><span class="kbd">Ctrl K</span> поиск откуда угодно</span></div></div>';
  document.body.appendChild(box);
  const inp = box.querySelector('input'), res = box.querySelector('.sk-res');
  let hits = [], act = 0, seq = 0, timer = 0;

  const drawScope = () => box.querySelectorAll('[data-s]').forEach((b) => {
    const on = b.dataset.s === scope.id;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('acc', on);
  });
  const row = (x, i) => '<a class="sk-r' + (i === act ? ' on' : '') + '" role="option" aria-selected="' + (i === act) + '" data-i="' + i + '" href="' + esc(x.href) + '">' +
    '<span class="sk-ic ' + (x.kind === 'term' ? 'term' : 'les') + '">' + (x.kind === 'term' ? 'Aa' : BOOK) + '</span>' +
    '<span class="sk-t"><b>' + esc(x.title) + '</b><small>' + esc((scope.id === 'all' && x.kind !== 'course' ? x.course + ' · ' : '') + String(x.sub || '').slice(0, 110)) + '</small></span></a>';
  const paint = (q, out) => {
    const places = out.places || [], terms = out.terms || [];
    hits = places.concat(terms);
    act = Math.min(act, Math.max(hits.length - 1, 0));
    res.innerHTML = (places.length ? '<div class="lbl sk-g">' + (!q && scope.id === 'all' ? 'Курсы' : q ? 'Уроки и части' : 'Уроки') + '</div>' + places.map(row).join('') : '') +
      (terms.length ? '<div class="lbl sk-g">Термины</div>' + terms.map((x, j) => row(x, places.length + j)).join('') : '') +
      (!hits.length ? '<p class="sk-none">Ничего не нашлось. Поиск идёт по названиям уроков, частей и словарю' + (scope.id === 'all' ? ' всех курсов' : ' курса') + '.</p>' : '');
  };
  const run = async () => {
    const q = inp.value.trim(), my = ++seq;
    try {
      const out = await scope.find(q);
      if (my === seq && box) paint(q, out);
    } catch (e) {
      if (my === seq && box) res.innerHTML = '<p class="sk-none">Поиск по всем курсам недоступен: ' + esc(e.message) + '. Без сети работает поиск по этому курсу.</p>';
    }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(run, scope.id === 'all' ? 150 : 0); };
  const go = (x) => {
    if (!x) return;
    closeSearch();
    if (opts.go) opts.go(x); else location.href = x.href;
  };
  inp.addEventListener('input', () => { act = 0; later(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(act + 1, hits.length - 1); repaintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(act - 1, 0); repaintActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[act]); }
  });
  function repaintActive() {
    res.querySelectorAll('.sk-r').forEach((a) => {
      const on = +a.dataset.i === act;
      a.classList.toggle('on', on);
      a.setAttribute('aria-selected', String(on));
      if (on) a.scrollIntoView({ block: 'nearest' });
    });
  }
  res.addEventListener('click', (e) => { const a = e.target.closest('[data-i]'); if (a) { e.preventDefault(); go(hits[+a.dataset.i]); } });
  box.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    scope = scopes.find((s) => s.id === b.dataset.s);
    lastScope = scope.id;
    act = 0;
    drawScope();
    run();
    inp.focus();
  }));
  box.addEventListener('click', (e) => { if (e.target === box) closeSearch(); });
  drawScope();
  run();
  inp.focus();
}

export function closeSearch() {
  if (!box) return;
  box.remove();
  box = null;
}

export function searchOpen() { return !!box; }

// Ctrl K (и Ctrl Л в русской раскладке) открывает и закрывает поиск, Esc закрывает.
export function bindSearchKeys(open) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) { e.preventDefault(); if (box) closeSearch(); else open(); }
    else if (e.key === 'Escape' && box) closeSearch();
  });
}

// Страницы сайта (каталог, профиль, повторения): кнопка «Поиск» в шапке и Ctrl K — по всем курсам.
export function initSiteSearch() {
  const open = () => openSearch({ scopes: [allCourses] });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-act="search"]')) open(); });
  bindSearchKeys(open);
}
