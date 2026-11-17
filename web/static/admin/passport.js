import { esc, h, req, toast, METALS, confirmDialog, dialog } from './ui.js';
import { draft, touch } from './draft.js';
import { directionSelect } from './directions.js';
import { userPicker, searchPicker, personHTML } from './picker.js';
import { courseCheck } from './course-check.js';

export function renderPassport(main, courseBar, metadata) {
  const { off } = courseBar(main), c = draft.course;
  const page = h('div', 'ad-page');
  page.innerHTML = '<nav class="ad-form-anchors" aria-label="Разделы настроек"></nav><div class="ad-form-content"><div class="ad-head"><div><h1>Настройки</h1><p class="ad-sub">Как курс выглядит в каталоге и как в нём запускается код.</p></div></div><div class="ad-form passport-form"></div></div><aside class="ad-card ad-pad ad-form ad-form-aside" aria-label="Проверка курса"></aside>';
  main.append(page);
  const stopCheck = courseCheck(page.querySelector('.ad-form-aside'));
  const container = page.querySelector('.passport-form');
  const section = (title) => {
    const card = h('section', 'ad-card ad-pad ad-form', '<h2>' + esc(title) + '</h2>'); card.tabIndex = -1; container.append(card);
    const anchor = h('button', 'ad-anchor', esc(title)); anchor.type = 'button';
    anchor.addEventListener('click', () => { card.scrollIntoView({ block: 'start' }); card.focus({ preventScroll: true }); });
    page.querySelector('.ad-form-anchors').append(anchor); return card;
  };
  let form = section('Каталог');
  const field = (obj, key, label, rows, parse) => {
    const box = h('label', 'ad-f', esc(label));
    const input = h(rows ? 'textarea' : 'input');
    if (rows) input.rows = rows;
    input.value = Array.isArray(obj[key]) ? obj[key].join(key === 'review' || key === 'requires' ? ', ' : '\n') : obj[key] || '';
    box.append(input); form.append(box);
    input.addEventListener('input', () => {
      let value = input.value;
      if (parse) value = parse(value);
      if (value === null) { input.setCustomValidity('Нужны три положительных числа через запятую'); input.reportValidity(); return; }
      input.setCustomValidity('');
      if (value === '' || (Array.isArray(value) && !value.length)) delete obj[key]; else obj[key] = value;
      touch();
    });
  };
  field(c, 'title', 'Название'); field(c, 'subtitle', 'Подзаголовок');
  const metal = h('label', 'ad-f', 'Металл<select>' + Object.entries(METALS).map(([key, title]) => '<option value="' + key + '"' + (c.metal === key ? ' selected' : '') + '>' + title + '</option>').join('') + '</select>');
  metal.querySelector('select').addEventListener('change', (e) => { c.metal = e.target.value; touch(); }); form.append(metal);
  field(c, 'about', 'О курсе · HTML и ссылки {{ключ}}', 4);
  field(c, 'howto', 'Как заниматься · по пункту на строку', 4, (v) => v.split('\n').filter((x) => x.trim()));
  const catalog = form;
  form = section('Запуск кода');
  const toolFields = h('div', 'ad-grid2'); form.append(toolFields); form = toolFields;
  c.tool ||= {};
  for (const [key, label] of [['name', 'Инструмент'], ['version', 'Версия инструмента'], ['file', 'Файл по умолчанию'], ['cmd', 'Команда запуска']]) field(c.tool, key, label);
  form = section('Связи');
  const requires = h('div', 'ad-chips'); form.append(requires);
  let available = [];
  const drawRequires = () => {
    requires.replaceChildren();
    (c.requires || []).forEach((id) => {
      const chip = h('span', 'chip ad-requires-chip', esc(available.find((x) => x.id === id)?.title || id));
      const remove = h('button', 'ad-ib', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Убрать опору ' + id);
      remove.addEventListener('click', () => { c.requires = c.requires.filter((x) => x !== id); touch(); drawRequires(); picker.input.focus(); });
      chip.append(remove); requires.append(chip);
    });
  };
  const picker = searchPicker({ label: 'Опирается на · поиск курса', search: async (q) => available.filter((x) => x.id !== c.id && !(c.requires || []).includes(x.id) && (x.title + ' ' + x.id).toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru'))),
    onSelect: (item) => { c.requires ||= []; if (!c.requires.includes(item.id)) c.requires.push(item.id); touch(); drawRequires(); } });
  form.append(picker.root); drawRequires();
  form = h('details', 'ad-form', '<summary>Дополнительные настройки</summary>'); catalog.append(form);
  c.labels ||= {};
  for (const [key, title] of [['section', 'Раздел'], ['lesson', 'Урок'], ['part', 'Часть'], ['cs', 'Боковая врезка'], ['interview', 'Уровень собеседований (id)']]) field(c.labels, key, 'Подпись · ' + title);
  field(c, 'review', 'Повторения · три интервала в днях через запятую', 0, (v) => {
    if (!v.trim()) return [];
    const n = v.split(',').map(Number); return n.length === 3 && n.every((x) => Number.isInteger(x) && x > 0) ? n : null;
  });
  field(c, 'pages', 'Справочник · по id на строку (notes, glossary, exam, tools)', 3, (v) => v.split('\n').map((x) => x.trim()).filter(Boolean));
  const direction = h('div', 'ad-form'); catalog.querySelector('h2').after(direction);
  Promise.all([req('GET', '/api/directions'), req('GET', '/api/admin/courses'), req('GET', '/api/courses')]).then(([r, list, publicCourses]) => {
    if (!page.isConnected) return;
    if (!r.ok || !list.ok) { direction.textContent = 'Не удалось загрузить направление'; return; }
    available = [...new Map([...(publicCourses.ok ? publicCourses.data : []), ...list.data].map((item) => [item.id, item])).values()]; drawRequires();
    const info = list.data.find((x) => x.id === c.id) || metadata || {};
    direction.innerHTML = directionSelect({ ...info, title: c.title }, r.data);
    const select = direction.querySelector('select'); let before = select.value;
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const result = await req('PUT', '/api/admin/courses/' + encodeURIComponent(c.id) + '/direction', { direction: select.value });
        if (!result.ok) throw new Error(result.data.error || 'Направление не сохранилось');
        before = info.direction = select.value; toast('Направление сохранено', 'good');
      } catch (e) { select.value = before; toast(e.message, 'bad'); }
      finally { select.disabled = false; }
    });
  });
  form = section('Опасная зона');
  const remove = h('button', 'btn ad-danger', 'Удалить курс'); remove.type = 'button'; form.append(remove);
  remove.addEventListener('click', () => {
    const box = h('div', 'ad-form', '<p>Удалятся все версии, прогресс, карточки учеников, правки агентов и озвучка. Отменить это нельзя. Файл на диске останется; вернуть курс можно через «Импорт JSON».</p><label class="ad-f">Для подтверждения введи id курса: <b>' + esc(c.id) + '</b><input autocomplete="off" aria-label="id удаляемого курса"></label>');
    const modal = dialog('Удалить курс «' + c.title + '»?', box, [{ label: 'Отмена' }, { label: 'Удалить навсегда', danger: true, disabled: true, onClick: async (close, d) => {
      if (box.querySelector('input').value !== c.id) return;
      const button = d.querySelector('.ad-danger'); button.disabled = true;
      const result = await req('DELETE', '/api/admin/courses/' + encodeURIComponent(c.id));
      if (!result.ok) { toast(result.data.error || 'Не удалось удалить курс', 'bad'); button.disabled = false; return; }
      draft.dirty = false; draft.course = null; draft.id = null;
      try { localStorage.removeItem('citadel-admin-course'); } catch (_) { /* optional */ }
      close(); toast('Курс удалён', 'good'); location.hash = '#/';
    } }]);
    box.querySelector('input').addEventListener('input', (e) => { modal.querySelector('.ad-danger').disabled = e.target.value !== c.id; });
  });
  return () => { off(); stopCheck(); picker.destroy(); };
}

export function renderAccess(main, courseBar) {
  const { off } = courseBar(main), id = draft.id, base = '/api/admin/courses/' + encodeURIComponent(id);
  const page = h('div', 'ad-page ad-access-page');
  page.innerHTML = '<div class="ad-form-content"><div class="ad-head"><div><h1>Доступ</h1><p class="ad-sub">Владелец, публичность и пользователи курса. Изменения сохраняются сразу.</p></div></div><div class="ad-form" id="course-access">Загружаю…</div></div><aside class="ad-card ad-pad ad-form ad-form-aside"><h2>Кто видит курс</h2><p><b>Всем:</b> опубликованный курс виден всем ученикам в каталоге.</p><p><b>По доступу:</b> курс видят только люди из списка доступа и его владелец. Для прохождения нужна опубликованная версия.</p><p>Админы видят все курсы. Отдельные доступы сохраняются и при выборе «Всем».</p></aside>';
  main.append(page);
  let pickers = [], alive = true;
  async function change(suffix, body, method = 'PUT') {
    const result = await req(method, base + '/' + suffix, body);
    if (!result.ok) { toast(result.data.error || 'Не удалось сохранить', 'bad'); return false; }
    return true;
  }
  async function load() {
    const [list, grants] = await Promise.all([req('GET', '/api/admin/courses'), req('GET', base + '/users')]);
    if (!alive) return;
    const form = page.querySelector('#course-access');
    if (!list.ok || !grants.ok) { form.textContent = 'Не удалось загрузить доступ'; return; }
    const c = list.data.find((c) => c.id === id); if (!c) { location.hash = '#/'; return; }
    pickers.forEach((p) => p.destroy()); pickers = [];
    form.innerHTML = '<section class="ad-card ad-pad ad-form"><h2>Владелец</h2><div class="ad-row" data-current-owner></div><div data-owner-picker></div><button type="button" class="btn" data-owner-change disabled>Сменить</button></section><section class="ad-card ad-pad ad-form"><h2>Доступ</h2><div class="ad-row" role="group" aria-label="Доступ к курсу"><button type="button" class="btn" data-access="public">Всем</button><button type="button" class="btn" data-access="private">По доступу</button></div><p class="ad-sub">Админы видят все курсы. Отдельные доступы сохраняются и у публичного курса.</p></section><section class="ad-card ad-pad ad-form"><h2>Люди с доступом</h2><div data-user-picker></div><div class="ad-access-people"></div></section>';
    form.querySelector('[data-current-owner]').innerHTML = c.owner ? personHTML(c.owner) : '<span>Платформа</span>';
    let candidate;
    const ownerButton = form.querySelector('[data-owner-change]');
    form.querySelector('[data-current-owner]').append(ownerButton);
    const ownerPicker = userPicker({ label: 'Новый владелец · логин или имя', ownersOnly: true, exclude: (u) => u.id === c.ownerId, onSelect: (user) => { candidate = user; ownerButton.disabled = false; ownerPicker.input.value = user.name + ' · ' + user.login; return false; } });
    pickers.push(ownerPicker); form.querySelector('[data-owner-picker]').append(ownerPicker.root);
    ownerPicker.input.addEventListener('input', () => { candidate = null; ownerButton.disabled = true; });
    // Preserve the existing ability to transfer a course back to the platform.
    const platform = h('button', 'btn', 'Передать платформе'); platform.type = 'button'; platform.hidden = !c.ownerId;
    form.querySelector('[data-owner-picker]').append(platform);
    const transfer = async (ownerId, name) => {
      if (!(await confirmDialog('Владелец · ' + c.title, 'Передать курс: ' + name + '?', 'Передать'))) return;
      ownerButton.disabled = platform.disabled = true;
      if (await change('owner', { ownerId })) { toast('Владелец обновлён', 'good'); await load(); }
      else { ownerButton.disabled = !candidate; platform.disabled = false; }
    };
    ownerButton.addEventListener('click', () => { if (candidate) transfer(candidate.id, candidate.name); });
    platform.addEventListener('click', () => transfer(0, 'платформа'));
    form.querySelectorAll('[data-access]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.access === c.access));
      button.addEventListener('click', async () => {
        form.querySelectorAll('[data-access]').forEach((b) => { b.disabled = true; });
        if (await change('access', { access: button.dataset.access })) c.access = button.dataset.access;
        form.querySelectorAll('[data-access]').forEach((b) => { b.disabled = false; b.setAttribute('aria-pressed', String(b.dataset.access === c.access)); });
      });
    });
    let people = grants.data.users;
    const peopleBox = form.querySelector('.ad-access-people');
    const drawPeople = () => {
      peopleBox.replaceChildren();
      if (!people.length) { peopleBox.append(h('p', 'ad-mut', 'Пока ни у кого нет отдельного доступа')); return; }
      people.forEach((u) => {
        const row = h('div', 'ad-person-row', personHTML(u));
        const remove = h('button', 'btn', 'Убрать'); remove.type = 'button'; remove.setAttribute('aria-label', 'Убрать доступ: ' + u.name);
        row.append(remove); peopleBox.append(row);
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          if (await change('users/' + u.id, undefined, 'DELETE')) { people = people.filter((x) => x.id !== u.id); drawPeople(); addPicker.input.focus(); }
          else remove.disabled = false;
        });
      });
    };
    const addPicker = userPicker({ label: 'Добавить: логин или имя', exclude: (u) => people.some((p) => p.id === u.id), onSelect: async (u) => {
      if (!(await change('users/' + u.id, {}, 'POST'))) return false;
      if (!alive) return;
      if (!people.some((p) => p.id === u.id)) people.push(u); drawPeople(); toast('Доступ добавлен', 'good');
    } });
    pickers.push(addPicker); form.querySelector('[data-user-picker]').append(addPicker.root); drawPeople();
  }
  load();
  return () => { alive = false; off(); pickers.forEach((p) => p.destroy()); };
}
