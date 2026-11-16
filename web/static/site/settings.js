// Настройки аккаунта отдельно от учебного профиля.
import { api, esc, today, readUI, applyTheme, UI_KEY, syncNote, avatarHTML } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop, readTheme } from './topbar.js';
import { confirmLogout } from './logout.js';

initSiteSearch();
const app = document.getElementById('app'), top = siteTop('settings');
const FILE_FORMAT = 'citadel-progress';
let user, courses, photo = null, photoGeneration = 0;
try {
  [user, { courses }] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  render();
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить настройки: ' + esc(e.message) + '</p></main>';
}

async function refresh() {
  ({ courses } = await api('/api/overview?today=' + today()));
  top.update(user, courses.reduce((sum, c) => sum + c.due, 0));
  document.getElementById('sync-status').innerHTML = syncNote();
}

function render() {
  top.update(user, courses.reduce((sum, c) => sum + c.due, 0));
  app.innerHTML = '<main class="site-main"><h1>Настройки</h1><div class="settings-layout">' +
    '<nav class="settings-nav" aria-label="Разделы настроек"><a href="#account">Аккаунт</a><a href="#security">Безопасность</a><a href="#appearance">Внешний вид</a><a href="#data">Данные</a></nav>' +
    '<div class="settings-sections">' +
      '<section class="card panel settings-section" id="account" aria-labelledby="account-title"><h2 id="account-title">Аккаунт</h2>' +
        '<div class="settings-field avatar-field"><h3>Аватар</h3><span class="me-av settings-avatar" id="avatar-preview" aria-hidden="true">' + avatarHTML(user, 96) + '</span>' +
        '<p id="avatar-help">PNG или JPEG до 2 МБ. Обрежем по центру в квадрат.</p>' +
        '<input type="file" id="avatar-file" accept="image/png,image/jpeg" hidden>' +
        '<div class="row"><button type="button" class="btn btn-l" id="avatar-upload" aria-describedby="avatar-help">Загрузить фото</button><button type="button" class="btn btn-l" id="avatar-remove"' + (!user.avatar ? ' hidden' : '') + '>Убрать</button></div>' +
        '<div class="row" id="avatar-confirm" hidden><button type="button" class="btn btn-l pri" id="avatar-save">Сохранить фото</button><button type="button" class="btn btn-l" id="avatar-cancel">Отмена</button></div><p id="avatar-status" role="status" hidden></p></div>' +
        '<div class="settings-field"><label class="lbl" for="account-login">Логин</label><input class="inp" id="account-login" value="' + esc(user.login) + '" readonly aria-describedby="login-help"><p id="login-help">Логин не меняется: по нему ты входишь.</p></div>' +
        '<form id="name-form" class="account-form settings-field"><label class="lbl" for="account-name">Имя</label><input class="inp" id="account-name" name="name" value="' + esc(user.name) + '" maxlength="40" autocomplete="nickname" required>' +
        '<button class="btn btn-l" type="submit">Сохранить имя</button><p id="name-status" role="status" hidden></p></form></section>' +
      '<section class="card panel settings-section" id="security" aria-labelledby="security-title"><h2 id="security-title">Безопасность</h2>' +
        '<form id="password-form" class="account-form settings-field"><h3>Сменить пароль</h3>' +
        '<label class="lbl" for="old-password">Текущий пароль</label><input class="inp" id="old-password" type="password" autocomplete="current-password" required>' +
        '<label class="lbl" for="new-password">Новый пароль</label><input class="inp" id="new-password" type="password" autocomplete="new-password" aria-describedby="password-help" required>' +
        '<label class="lbl" for="repeat-password">Повтори новый пароль</label><input class="inp" id="repeat-password" type="password" autocomplete="new-password" required>' +
        '<p id="password-help">От 10 до 256 символов. Пароль не должен совпадать с логином. После смены пароля остальные устройства выйдут из аккаунта.</p>' +
        '<button class="btn btn-l" type="submit">Сменить пароль</button><p id="password-status" role="status" hidden></p></form>' +
        '<div class="settings-field"><button class="btn btn-l account-danger" type="button" id="logout-all">Выйти на всех устройствах</button></div></section>' +
      '<section class="card panel settings-section" id="appearance" aria-labelledby="appearance-title"><h2 id="appearance-title">Внешний вид</h2>' +
        '<div class="settings-field"><div class="lbl" id="theme-label">Тема</div><div class="segs" role="group" aria-labelledby="theme-label" id="theme">' +
        [['light', 'Светлая'], ['dark', 'Тёмная'], ['auto', 'Как в системе']].map((t) => '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (readTheme() === t[0]) + '">' + t[1] + '</button>').join('') + '</div></div>' +
        '<div class="settings-field"><label class="lbl" for="rate">Скорость озвучки</label><select id="rate" class="sel">' +
        [0.8, 0.9, 1, 1.25, 1.5, 1.75, 2].map((rate) => '<option value="' + rate + '"' + ((readUI().rate || 1) === rate ? ' selected' : '') + '>' + String(rate).replace('.', ',') + '×</option>').join('') + '</select></div></section>' +
      '<section class="card panel settings-section" id="data" aria-labelledby="data-title"><h2 id="data-title">Данные</h2>' +
        '<p>Прогресс хранится на сервере и в браузере. Без сети курс работает, отметки уходят на сервер при подключении. Файл — на всякий случай или чтобы перенести прогресс на другой сервер Citadel.</p>' +
        '<div id="sync-status" role="status">' + syncNote() + '</div><div class="row"><button type="button" class="btn btn-l" id="export">Скачать прогресс</button>' +
        '<button type="button" class="btn btn-l" id="import-button">Загрузить из файла</button><input type="file" id="import" accept="application/json,.json" hidden></div><p id="io" role="status" hidden></p>' +
        '<p>Прогресс из прежней версии курса, если она была, переносится на странице этого курса, внизу.</p></section>' +
    '</div></div></main>';
  wire();
  wireAvatar();
}

function updateAvatar() {
  document.getElementById('avatar-preview').innerHTML = avatarHTML(user, 96);
  document.getElementById('avatar-remove').hidden = !user.avatar;
  document.getElementById('avatar-confirm').hidden = true;
  photo = null;
  photoGeneration++;
}

function wireAvatar() {
  const file = document.getElementById('avatar-file');
  const status = document.getElementById('avatar-status');
  const say = (text, bad = false) => { status.textContent = text; status.hidden = false; status.className = bad ? 'note-bad' : 'note-ok'; };
  document.getElementById('avatar-upload').addEventListener('click', () => file.click());
  const cancel = () => { updateAvatar(); say('Выбор фото отменён.'); document.getElementById('avatar-upload').focus(); };
  document.getElementById('avatar-cancel').addEventListener('click', cancel);
  document.querySelector('.avatar-field').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && photo) { e.preventDefault(); cancel(); }
  });
  file.addEventListener('change', () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    updateAvatar();
    const generation = photoGeneration;
    if (!['image/png', 'image/jpeg'].includes(selected.type)) { say('Выбери картинку PNG или JPEG.', true); return; }
    if (selected.size > 2 * 1024 * 1024) { say('Картинка больше 2 МБ.', true); return; }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (generation !== photoGeneration) return;
      photo = selected;
      const preview = document.createElement('img');
      preview.alt = ''; preview.width = 96; preview.height = 96; preview.src = reader.result;
      document.getElementById('avatar-preview').replaceChildren(preview);
      document.getElementById('avatar-confirm').hidden = false;
      say('Предпросмотр. Сохрани фото, чтобы оно появилось в профиле.');
      document.getElementById('avatar-save').focus();
    });
    reader.addEventListener('error', () => { if (generation === photoGeneration) say('Не получилось прочитать файл.', true); });
    reader.readAsDataURL(selected);
  });
  const change = async (remove) => {
    if (!remove && !photo) return;
    const buttons = [...document.querySelectorAll('.avatar-field button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await api('/api/me/avatar', remove ? { method: 'DELETE' } : { method: 'PUT', headers: { 'Content-Type': photo.type }, body: photo });
      user = await api('/api/me');
      updateAvatar();
      top.update(user, courses.reduce((sum, c) => sum + c.due, 0));
      say(remove ? 'Фото убрано.' : 'Фото сохранено.');
    } catch (err) { say(err.message, true); }
    finally {
      buttons.forEach((button) => { button.disabled = false; });
      document.getElementById(photo ? 'avatar-save' : 'avatar-upload').focus();
    }
  };
  document.getElementById('avatar-save').addEventListener('click', () => change(false));
  document.getElementById('avatar-remove').addEventListener('click', () => change(true));
}

function wire() {
  const message = (id, text, bad = false) => {
    const el = document.getElementById(id);
    el.textContent = text; el.hidden = false; el.className = bad ? 'note-bad' : 'note-ok';
  };
  document.getElementById('name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button'); button.disabled = true;
    try {
      user = await api('/api/me/name', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('account-name').value }) });
      top.update(user, courses.reduce((sum, c) => sum + c.due, 0));
      if (!photo) updateAvatar();
      message('name-status', 'Имя сохранено.');
    } catch (err) { message('name-status', err.message, true); }
    finally { button.disabled = false; }
  });
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget, button = form.querySelector('button');
    const password = document.getElementById('new-password').value;
    if (password !== document.getElementById('repeat-password').value) { message('password-status', 'Новые пароли не совпадают.', true); return; }
    const length = Array.from(password).length;
    if (length < 10 || length > 256 || password.toLowerCase() === user.login.toLowerCase()) { message('password-status', 'Пароль — от 10 до 256 символов и не должен совпадать с логином.', true); return; }
    button.disabled = true;
    try {
      await api('/api/me/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPassword: document.getElementById('old-password').value, newPassword: password }) });
      form.reset(); message('password-status', 'Пароль изменён. Остальные устройства вышли из аккаунта.');
    } catch (err) { message('password-status', err.message, true); }
    finally { button.disabled = false; }
  });
  document.getElementById('logout-all').addEventListener('click', (e) => confirmLogout(true, e.currentTarget));
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
  document.getElementById('import-button').addEventListener('click', () => document.getElementById('import').click());
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
    top.redraw();
    document.querySelectorAll('#theme button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  document.getElementById('top').addEventListener('click', () => {
    document.querySelectorAll('#theme [data-t]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.t === readTheme())));
  });

  document.getElementById('rate').addEventListener('change', (e) => {
    const ui = readUI();
    ui.rate = parseFloat(e.target.value);
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (err) { /* только на этот раз */ }
  });

}
