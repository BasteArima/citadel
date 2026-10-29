// Профиль: цепь из звеньев-курсов, сводка, перенос прогресса файлом, тема и выход.
import { api, esc, plural, today, header, metalName, courseState, readUI, applyTheme, UI_KEY } from './shared.js';

const app = document.getElementById('app');
const FILE_FORMAT = 'citadel-progress';

let user, courses;
try {
  [user, { courses }] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  render();
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить профиль: ' + esc(e.message) + '</p></main>';
}

async function refresh() {
  ({ courses } = await api('/api/overview?today=' + today()));
  render();
}

function render() {
  const sum = (f) => courses.reduce((s, c) => s + f(c), 0);
  const forged = courses.filter((c) => courseState(c) === 'done').length;
  const forging = courses.filter((c) => courseState(c) === 'active').length;
  const answered = sum((c) => c.solved), right = sum((c) => c.firstRight);
  app.innerHTML = header(user, 'profile', sum((c) => c.due)) +
    '<main class="site-main">' +
      '<div class="me-h"><span class="me-av" aria-hidden="true">' + esc(user.name.slice(0, 1).toUpperCase()) + '</span>' +
        '<div><h1>' + esc(user.name) + '</h1><p class="site-sub">' + (user.role === 'admin' ? 'Ученик и админ' : 'Ученик') + '</p></div></div>' +
      chain(forged, forging) +
      '<div class="stats">' +
        stat('Уроков пройдено', sum((c) => c.done)) +
        stat('Частей закрыто', sum((c) => c.parts)) +
        stat('Вопросов отвечено', answered) +
        stat('Первых ответов верно', answered ? Math.round(right / answered * 100) + '%' : '—') +
        stat('Карточек на сегодня', sum((c) => c.due) + ' из ' + sum((c) => c.cards)) +
        stat('Звеньев выковано', forged + ' из ' + courses.length) +
      '</div>' +
      '<div class="panels">' +
        '<section class="card panel" aria-labelledby="pr"><h2 id="pr">Прогресс</h2>' +
          '<p>Хранится на сервере и в браузере. Без сети курс работает, отметки уходят на сервер при подключении. Файл — на всякий случай или чтобы перенести прогресс на другой сервер Citadel.</p>' +
          syncNote() +
          '<div class="row"><button type="button" class="btn btn-l" id="export">Скачать прогресс</button>' +
          '<label class="btn btn-l">Загрузить из файла<input type="file" id="import" accept="application/json,.json" hidden></label></div>' +
          '<p id="io" role="status" hidden></p>' +
          '<p>Файл из прежней версии Go-курса загружается на странице курса, внизу.</p></section>' +
        '<section class="card panel" aria-labelledby="st"><h2 id="st">Настройки</h2>' +
          '<div><div class="lbl" id="thl">Тема</div><div class="segs" role="group" aria-labelledby="thl" id="theme" style="margin-top:6px">' +
            [['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', 'Как в системе']].map((t) =>
              '<button type="button" data-t="' + t[0] + '" aria-pressed="' + ((readUI().theme || 'auto') === t[0]) + '">' + t[1] + '</button>').join('') +
          '</div></div>' +
          '<div><label class="lbl" for="rate">Скорость озвучки</label><select id="rate" class="sel" style="margin-top:6px">' +
            [0.9, 1, 1.25, 1.5].map((r) => '<option value="' + r + '"' + ((readUI().rate || 1) === r ? ' selected' : '') + '>' + String(r).replace('.', ',') + '×</option>').join('') +
          '</select></div>' +
          '<div><button type="button" class="btn btn-l" id="logout" style="color:var(--rose)">Выйти</button></div></section>' +
      '</div>' +
    '</main>';
  wire();
}

// Состояние синхронизации по данным движка в этом браузере: есть ли неотправленные отметки
// и когда был последний обмен с сервером.
function syncNote() {
  let pending = 0, last = 0;
  for (const c of courses) {
    try {
      const p = JSON.parse(localStorage.getItem('citadel-progress:' + c.id) || '{}') || {};
      if (p.dirty) pending++;
      last = Math.max(last, p.syncedAt || 0);
    } catch (e) { /* нет данных — ничего не показываем */ }
  }
  if (pending) return '<p class="note-bad">В этом браузере есть отметки, которые ещё не дошли до сервера. Они уйдут, когда откроешь курс при подключении.</p>';
  if (!last) return '';
  const min = Math.round((Date.now() - last) / 60000);
  const ago = min < 1 ? 'только что' : min < 60 ? min + ' ' + plural(min, 'минуту', 'минуты', 'минут') + ' назад' :
    new Date(last).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return '<p class="note-ok">Всё сохранено на сервере · последний обмен ' + ago + '</p>';
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
    '<svg viewBox="0 0 ' + vbw + ' 150" role="img" aria-label="Цепь: ' + esc(label) + '">' + links + empty + '</svg>' +
    '<div class="chain-cards">' + courses.map((c) => {
      const st = courseState(c);
      return '<a class="chain-card metal-' + esc(c.metal) + '" href="/c/' + encodeURIComponent(c.id) + '/">' +
        '<small>' + esc(metalName(c.metal)) + ' · ' + ({ done: 'выковано', active: 'куётся', new: 'не начато' }[st]) + '</small>' +
        '<b>' + esc(c.title) + '</b><span>' + c.done + ' из ' + c.lessons + ' ' + plural(c.lessons, 'урока', 'уроков', 'уроков') + '</span></a>';
    }).join('') +
    '<div class="chain-card slot">Следующие звенья появятся с новыми курсами</div></div>' +
  '</section>';
}

function wire() {
  // элемент ищем каждый раз: после загрузки файла страница перерисовывается
  const say = (text, bad) => {
    const io = document.getElementById('io');
    io.hidden = false; io.className = bad ? 'note-bad' : 'note-ok'; io.textContent = text;
  };

  document.getElementById('export').addEventListener('click', async () => {
    try {
      const out = { format: FILE_FORMAT, version: 1, exported: new Date().toISOString(), user: user.name, courses: {} };
      for (const c of courses) out.courses[c.id] = (await api('/api/progress/' + encodeURIComponent(c.id))).items;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = 'citadel-progress-' + today() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say('Файл с прогрессом скачан.');
    } catch (e) {
      say('Не получилось скачать: ' + e.message, true);
    }
  });

  // Загрузка сливает отметки с сервером по тем же правилам, что и синхронизация: свежая побеждает.
  document.getElementById('import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== FILE_FORMAT || !data.courses) throw new Error('это не файл прогресса Citadel');
      let n = 0, skipped = 0;
      for (const id of Object.keys(data.courses)) {
        if (!courses.some((c) => c.id === id)) { skipped++; continue; }
        const items = data.courses[id] || {};
        await api('/api/progress/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        n += Object.keys(items).length;
      }
      await refresh();
      say('Загружено отметок: ' + n + (skipped ? '. Курсов, которых здесь нет: ' + skipped : '') + '. Совпадающие отметки не задвоились.');
    } catch (err) {
      say('Не получилось загрузить: ' + err.message, true);
    }
  });

  document.getElementById('theme').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const ui = readUI();
    ui.theme = b.getAttribute('data-t');
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (err) { /* тема только на этот раз */ }
    applyTheme(ui.theme);
    document.querySelectorAll('#theme button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  document.getElementById('rate').addEventListener('change', (e) => {
    const ui = readUI();
    ui.rate = parseFloat(e.target.value);
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (err) { /* только на этот раз */ }
  });

  document.getElementById('logout').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).finally(() => { location.href = '/login'; });
  });
}
