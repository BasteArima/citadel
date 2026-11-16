import { esc, h, req, toast, METALS, confirmDialog } from './ui.js';
import { draft, touch } from './draft.js';
import { directionSelect } from './directions.js';

export function renderPassport(main, courseBar, metadata) {
  const { off } = courseBar(main), c = draft.course;
  const page = h('div', 'ad-page');
  page.innerHTML = '<div class="ad-head"><div><h1>Паспорт</h1><p class="ad-sub">Правки сохраняются вместе с курсом. Направление сохраняется сразу.</p></div></div><div class="ad-form ad-card ad-pad passport-form"></div>';
  main.append(page);
  const form = page.querySelector('.ad-form');
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
  c.tool ||= {};
  for (const [key, label] of [['name', 'Инструмент'], ['version', 'Версия инструмента'], ['file', 'Файл по умолчанию'], ['cmd', 'Команда запуска']]) field(c.tool, key, label);
  field(c, 'about', 'О курсе · HTML и ссылки {{ключ}}', 4);
  field(c, 'howto', 'Как заниматься · по пункту на строку', 4, (v) => v.split('\n').filter((x) => x.trim()));
  field(c, 'requires', 'Опирается на · id курсов через запятую', 0, (v) => v.split(',').map((x) => x.trim()).filter(Boolean));
  c.labels ||= {};
  for (const [key, title] of [['section', 'Раздел'], ['lesson', 'Урок'], ['part', 'Часть'], ['cs', 'Боковая врезка'], ['interview', 'Уровень собеседований (id)']]) field(c.labels, key, 'Подпись · ' + title);
  field(c, 'review', 'Повторения · три интервала в днях через запятую', 0, (v) => {
    if (!v.trim()) return [];
    const n = v.split(',').map(Number); return n.length === 3 && n.every((x) => Number.isInteger(x) && x > 0) ? n : null;
  });
  field(c, 'pages', 'Справочник · по id на строку (notes, glossary, exam, tools)', 3, (v) => v.split('\n').map((x) => x.trim()).filter(Boolean));
  const direction = h('div', 'ad-form'); form.prepend(direction);
  Promise.all([req('GET', '/api/directions'), req('GET', '/api/admin/courses')]).then(([r, list]) => {
    if (!page.isConnected) return;
    if (!r.ok || !list.ok) { direction.textContent = 'Не удалось загрузить направление'; return; }
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
  return off;
}

export function renderAccess(main, courseBar) {
  const { off } = courseBar(main), id = draft.id, base = '/api/admin/courses/' + encodeURIComponent(id);
  const page = h('div', 'ad-page');
  page.innerHTML = '<div class="ad-head"><div><h1>Доступ</h1><p class="ad-sub">Владелец, публичность и пользователи курса. Изменения сохраняются сразу.</p></div></div><div class="ad-form ad-card ad-pad" id="course-access">Загружаю…</div>';
  main.append(page); load();
  async function load() {
    const [list, users, grants] = await Promise.all([req('GET', '/api/admin/courses'), req('GET', '/api/admin/users'), req('GET', base + '/users')]);
    if (!page.isConnected) return;
    const form = page.querySelector('#course-access');
    if (!list.ok || !users.ok || !grants.ok) { form.textContent = 'Не удалось загрузить доступ'; return; }
    const c = list.data.find((c) => c.id === id); if (!c) { location.hash = '#/'; return; }
    const owners = users.data.users.filter((u) => ['author', 'admin'].includes(u.role));
    form.innerHTML = '<label class="ad-f">Владелец<select data-owner><option value="0">платформа</option>' + owners.map((u) => '<option value="' + u.id + '"' + (c.ownerId === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select></label>' +
      '<label class="ad-f">Доступ<select data-access><option value="public">всем</option><option value="private">по доступу</option></select></label>' +
      '<p class="ad-sub">Админы видят все курсы. Выбери учеников и авторов, которым нужен этот курс. Сохранённые доступы остаются и у публичного курса.</p><label class="ad-f">Поиск пользователей<input type="search"></label><div class="ad-grant-list"></div><p class="ad-small ad-mut" data-empty hidden>Никого не найдено.</p>';
    const access = form.querySelector('[data-access]'); access.value = c.access;
    const change = async (suffix, body) => {
      const result = await req('PUT', base + '/' + suffix, body);
      if (!result.ok) { toast(result.data.error || 'Не удалось сохранить', 'bad'); return false; }
      toast('Доступ обновлён', 'good'); return true;
    };
    access.addEventListener('change', async () => { access.disabled = true; await change('access', { access: access.value }); await load(); });
    form.querySelector('[data-owner]').addEventListener('change', async (e) => {
      const ownerId = Number(e.target.value); e.target.value = String(c.ownerId || 0);
      if (!(await confirmDialog('Владелец · ' + c.title, 'Передать курс выбранному владельцу?', 'Передать'))) return;
      e.target.disabled = true; await change('owner', { ownerId }); await load();
    });
    const selected = new Set(grants.data.users);
    const box = form.querySelector('.ad-grant-list');
    users.data.users.filter((u) => u.role !== 'admin').forEach((u) => {
      const row = h('label', 'ad-check-l', '<input type="checkbox"' + (selected.has(u.id) ? ' checked' : '') + '><span>' + esc(u.name + ' · ' + (u.login || 'без логина') + (u.disabledAt ? ' · заблокирован' : '')) + '</span>');
      row.dataset.search = (u.name + ' ' + u.login).toLocaleLowerCase('ru'); box.append(row);
      row.querySelector('input').addEventListener('change', async (e) => {
        const checked = e.target.checked; e.target.disabled = true;
        if (checked) selected.add(u.id); else selected.delete(u.id);
        // Serialize the full grant set: no overlapping writes can lose a previous edit.
        box.querySelectorAll('input').forEach((x) => { x.disabled = true; });
        if (!(await change('users', { users: [...selected] }))) { if (checked) selected.delete(u.id); else selected.add(u.id); e.target.checked = !checked; }
        box.querySelectorAll('input').forEach((x) => { x.disabled = false; });
      });
    });
    form.querySelector('[type=search]').addEventListener('input', (e) => {
      const q = e.target.value.toLocaleLowerCase('ru');
      [...box.children].forEach((row) => { row.hidden = !row.dataset.search.includes(q); });
      form.querySelector('[data-empty]').hidden = [...box.children].some((row) => !row.hidden);
    });
  }
  return off;
}
