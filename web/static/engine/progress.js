// Прогресс и настройки.
//
// Настройки (тема, скорость озвучки, режим чтения) — в браузере, общие для всех курсов: ключ citadel-ui.
// Прогресс курса — набор отметок { ключ: { v, at } }, at — когда поставлена (мс).
// Ключи: q:<урок>:<id вопроса> — отвечен (1 — первая попытка верна, 2 — с ошибкой, решение 0008),
// seen:<урок>:<часть> — дочитана, done:<урок> — дата прохождения,
// card:<урок>:<id вопроса | say> — карточка повторения { d: когда показать, i: интервал в днях, s: «Помню» подряд }.
// Отметки лежат в localStorage (citadel-progress:<курс>) и синхронизируются с сервером:
// клиент отправляет все свои, сервер сливает по ключам (более свежая побеждает) и возвращает итог.
// Без сети всё работает, отметки уходят при подключении.
//
// Движок работает с формой S.lessons[урок] = { t, seen, done } и S.cards[ключ];
// save() сравнивает уроки с отметками и ставит время только изменившимся, карточки ставит putCard.
export const UI_KEY = 'citadel-ui';

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function flatten(lessons) {
  const out = {};
  Object.keys(lessons).forEach((lid) => {
    const st = lessons[lid];
    Object.keys(st.t || {}).forEach((qid) => { if (st.t[qid]) out['q:' + lid + ':' + qid] = st.t[qid] === 2 ? 2 : 1; });
    Object.keys(st.seen || {}).forEach((k) => { if (st.seen[k]) out['seen:' + lid + ':' + k] = 1; });
    if (st.done) out['done:' + lid] = st.done;
  });
  return out;
}

// Старые отметки q без первой попытки (значение 1) считаются верными.
function toLessons(items) {
  const L = {};
  const st = (lid) => L[lid] || (L[lid] = { t: {}, seen: {} });
  Object.keys(items).forEach((key) => {
    const p = key.split(':'), v = items[key].v;
    if (p[0] === 'q') st(p[1]).t[p.slice(2).join(':')] = v === 2 ? 2 : 1;
    else if (p[0] === 'seen') st(p[1]).seen[p[2]] = 1;
    else if (p[0] === 'done') st(p[1]).done = v;
  });
  return L;
}

function cardsOf(items) {
  const C = {};
  Object.keys(items).forEach((key) => { if (key.startsWith('card:') && items[key].v && items[key].v.d) C[key] = items[key].v; });
  return C;
}

// courseId — курс; hooks.onRemote — пришли отметки с другого устройства,
// hooks.onStatus — сменилось состояние синхронизации, hooks.onSignedOut — сессия закончилась.
export function loadState(courseId, hooks) {
  const KEY = 'citadel-progress:' + courseId;
  const ui = read(UI_KEY), pr = read(KEY);
  let items = pr.items || {};
  // прогресс, сохранённый до синхронизации (без отметок времени), становится отметками
  if (pr.lessons && !pr.items) {
    const now = Date.now(), flat = flatten(pr.lessons);
    Object.keys(flat).forEach((k) => { items[k] = { v: flat[k], at: now }; });
  }
  const S = {
    lessons: toLessons(items),
    cards: cardsOf(items),
    theme: ui.theme || 'auto',
    ui: { open: pr.open || {}, runs: pr.runs || {}, rate: ui.rate || 1, focus: !!ui.focus },
    sync: { state: 'idle', at: pr.syncedAt || 0 }
  };
  let dirty = !!pr.dirty || (pr.lessons && !pr.items);
  let gen = 0; // растёт с каждой новой отметкой: отметку, поставленную во время отправки, отправим следующей

  function persist() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ theme: S.theme, rate: S.ui.rate, focus: S.ui.focus }));
      localStorage.setItem(KEY, JSON.stringify({ items, open: S.ui.open, runs: S.ui.runs, dirty, syncedAt: S.sync.at }));
    } catch (e) { /* приватный режим: работаем без сохранения */ }
  }

  // новые и изменившиеся отметки получают время сейчас
  function stamp() {
    const flat = flatten(S.lessons), now = Date.now();
    let changed = false;
    Object.keys(flat).forEach((k) => {
      if (!items[k] || JSON.stringify(items[k].v) !== JSON.stringify(flat[k])) { items[k] = { v: flat[k], at: now }; changed = true; }
    });
    return changed;
  }

  S.save = function () {
    if (stamp()) { dirty = true; gen++; schedule(1000); }
    persist();
  };

  // карточка повторения: key = card:<урок>:<id вопроса | say>, val = { d, i, s }
  S.putCard = function (key, val) {
    items[key] = { v: val, at: Date.now() };
    S.cards[key] = val;
    dirty = true; gen++;
    persist();
    schedule(1000);
  };

  // убрать карточку: на сервер уходит пустое значение с новым временем — так удаление доходит и до
  // других устройств (более новая отметка побеждает), а пустая карточка нигде не считается
  S.dropCard = function (key) {
    items[key] = { v: {}, at: Date.now() };
    delete S.cards[key];
    dirty = true; gen++;
    persist();
    schedule(1000);
  };

  S.lesson = function (id) {
    const st = S.lessons[id] || (S.lessons[id] = {});
    st.t = st.t || {};
    return st;
  };

  // Перенос прогресса из прежнего курса (файл из legacy/go-course): номер вопроса N в уроке — это id урок.q(N+1).
  // Ставит только отметки, которых ещё нет. Возвращает число перенесённых.
  S.importV0 = function (v0, knownLesson) {
    const lessons = (v0 && v0.lessons) || {}, now = Date.now();
    let n = 0;
    const put = (k, v) => { if (!items[k]) { items[k] = { v, at: now }; n++; } };
    Object.keys(lessons).forEach((lid) => {
      if (!knownLesson(lid)) return;
      const st = lessons[lid] || {};
      Object.keys(st.t || {}).forEach((i) => { if (st.t[i]) put('q:' + lid + ':' + lid + '.q' + (+i + 1), 1); });
      Object.keys(st.h || {}).forEach((i) => { if (st.h[i]) put('q:' + lid + ':' + lid + '.h' + (+i + 1), 1); });
      Object.keys(st.seen || {}).forEach((k) => { if (st.seen[k]) put('seen:' + lid + ':' + k, 1); });
      if (st.done) put('done:' + lid, st.done);

    });
    if (n) {
      replaceLessons();
      dirty = true;
      gen++;
      persist();
      schedule(0);
    }
    return n;
  };

  function replaceLessons() {
    const fresh = toLessons(items);
    Object.keys(S.lessons).forEach((k) => delete S.lessons[k]);
    Object.assign(S.lessons, fresh);
    S.cards = cardsOf(items);
  }

  // ── синхронизация ──
  let timer = null, busy = false, again = false;
  function setStatus(state) {
    S.sync.state = state;
    if (hooks.onStatus) hooks.onStatus(S.sync);
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
  }
  async function sync() {
    if (busy) { again = true; return; }
    busy = true;
    setStatus('busy');
    const sentGen = gen;
    try {
      const r = await fetch('/api/progress/' + encodeURIComponent(courseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (r.status === 401) { setStatus('signed-out'); if (hooks.onSignedOut) hooks.onSignedOut(); return; }
      if (!r.ok) throw new Error('status ' + r.status);
      const body = await r.json();
      let changed = false;
      Object.keys(body.items || {}).forEach((k) => {
        const it = body.items[k];
        if (!items[k] || it.at > items[k].at) { items[k] = it; changed = true; }
      });
      if (gen === sentGen) dirty = false;
      S.sync.at = Date.now();
      persist();
      setStatus('ok');
      if (changed) { replaceLessons(); if (hooks.onRemote) hooks.onRemote(); }
    } catch (e) {
      setStatus('offline');
    } finally {
      busy = false;
      if (again || dirty) { again = false; schedule(dirty ? 15000 : 0); }
    }
  }
  S.startSync = function () {
    sync();
    window.addEventListener('online', () => schedule(0));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
    // уходя со страницы, отправить несохранённое
    window.addEventListener('pagehide', () => {
      if (!dirty) return;
      try {
        fetch('/api/progress/' + encodeURIComponent(courseId), {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });
      } catch (e) { /* отправим при следующем открытии */ }
    });
  };

  persist();
  return S;
}
