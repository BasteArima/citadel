import { req, esc, h, when, toast, dialog, confirmDialog } from './ui.js';
import { resetLinkDialog } from './invites.js';

export const roles = { student: 'ученик', author: 'автор', admin: 'админ' };

async function request(method, url, body) {
  try {
    const r = await req(method, url, body);
    if (r.ok) return r.data;
    toast(r.data.error || 'Не удалось сохранить: ' + r.status, 'bad');
  } catch (e) { toast('Нет связи с сервером. Попробуй ещё раз.', 'bad'); }
  return null;
}

// Both grant dialogs retain saved grants hidden by the current public/admin state.
// Filtering hides labels only, so checked entries outside the search stay selected.
function grantDialog(title, description, options, selected, save) {
  const form = h('div', 'ad-form');
  form.innerHTML = '<p class="ad-sub">' + esc(description) + '</p>' +
    '<label class="ad-f">Поиск<input type="search" placeholder="Начни вводить имя или название"></label>' +
    '<div class="ad-grant-list">' + options.map((o) => '<label class="ad-check-l" data-search="' + esc(o.search.toLocaleLowerCase('ru')) + '"><input type="checkbox" value="' + esc(o.id) + '"' + (selected.includes(o.id) ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>').join('') + '</div>' +
    '<p class="ad-mut ad-small ad-grant-empty" hidden>Ничего не найдено.</p>';
  const labels = [...form.querySelectorAll('[data-search]')], empty = form.querySelector('.ad-grant-empty');
  const filter = () => {
    const q = form.querySelector('[type=search]').value.trim().toLocaleLowerCase('ru');
    labels.forEach((l) => { l.hidden = !l.dataset.search.includes(q); });
    empty.hidden = labels.some((l) => !l.hidden);
  };
  form.querySelector('[type=search]').addEventListener('input', filter);
  filter();
  dialog(title, form, [
    { label: 'Отмена' },
    { label: 'Сохранить', primary: true, onClick: async (close, d) => {
      const button = d.querySelector('.ad-dlg-btns button:last-child');
      button.disabled = true;
      try {
        const checked = [...form.querySelectorAll('[type=checkbox]:checked')].map((i) => i.value);
        if (await save(checked)) { close(); toast('Доступ обновлён', 'good'); }
      } finally { button.disabled = false; }
    } }
  ]);
}

export async function courseUsersDialog(course, onChanged) {
  const [users, grants] = await Promise.all([
    request('GET', '/api/admin/users'),
    request('GET', '/api/admin/courses/' + encodeURIComponent(course.id) + '/users')
  ]);
  if (!users || !grants) return;
  const admins = new Set(users.users.filter((u) => u.role === 'admin').map((u) => u.id));
  const retained = grants.users.filter((id) => admins.has(id));
  const options = users.users.filter((u) => u.role !== 'admin').map((u) => ({ id: String(u.id), label: u.name + ' · ' + (u.login || 'без логина') + (u.disabledAt ? ' · заблокирован' : ''), search: u.name + ' ' + u.login }));
  grantDialog('Видят курс · ' + course.title, 'Админы видят все курсы. Выбери учеников и авторов, которым нужен этот курс.', options, grants.users.map(String), async (ids) => {
    const result = await request('PUT', '/api/admin/courses/' + encodeURIComponent(course.id) + '/users', { users: [...retained, ...ids.map(Number)] });
    if (!result) return false;
    await onChanged();
    return true;
  });
}

export async function renderUsers(main) {
  const page = h('div', 'ad-page');
  main.append(page);
  page.innerHTML = '<div class="ad-head"><div><h1>Пользователи</h1><p class="ad-sub">Новые аккаунты — через «Приглашения». Публичные курсы видны всем вошедшим.</p></div></div>' +
    '<div class="ad-filters"><label class="ad-f">Поиск<input type="search" id="u-search" placeholder="Имя или логин"></label>' +
    '<label class="ad-f">Роль<select id="u-role"><option value="">Все роли</option>' + Object.entries(roles).map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('') + '</select></label>' +
    '<label class="ad-f">Статус<select id="u-status"><option value="">Все статусы</option><option value="active">Активные</option><option value="disabled">Заблокированные</option></select></label></div>' +
    '<p class="ad-sub" id="u-count" role="status"></p><div class="ad-table-w"><table class="ad-table ad-responsive ad-users"><thead><tr>' +
    ['Имя', 'Логин', 'Роль', 'Лимит курсов', 'Курсы', 'Откуда', 'Когда был', 'Статус', 'Действия'].map((x) => '<th scope="col">' + x + '</th>').join('') +
    '</tr></thead><tbody><tr><td colspan="9">Загружаю…</td></tr></tbody></table></div>';
  let users = [], courses = [], currentUserId = 0;
  const rows = page.querySelector('tbody');
  const filters = [...page.querySelectorAll('.ad-filters input, .ad-filters select')];
  filters.forEach((f) => f.addEventListener(f.tagName === 'INPUT' ? 'input' : 'change', draw));
  await load();

  async function load() {
    const [u, c] = await Promise.all([request('GET', '/api/admin/users'), request('GET', '/api/admin/courses')]);
    if (!u || !c) { rows.innerHTML = '<tr><td colspan="9">Не удалось загрузить пользователей. Обнови страницу.</td></tr>'; return; }
    users = u.users; currentUserId = u.currentUserId; courses = c;
    draw();
  }

  function draw() {
    const q = filters[0].value.trim().toLocaleLowerCase('ru'), role = filters[1].value, status = filters[2].value;
    const visible = users.filter((u) => (u.name + ' ' + u.login).toLocaleLowerCase('ru').includes(q) && (!role || u.role === role) && (!status || (status === 'disabled') === !!u.disabledAt));
    const activeAdmins = users.filter((u) => u.role === 'admin' && !u.disabledAt).length;
    page.querySelector('#u-count').textContent = 'Показано: ' + visible.length + ' из ' + users.length;
    rows.innerHTML = visible.map((u) => {
      const self = u.id === currentUserId, lastAdmin = u.role === 'admin' && !u.disabledAt && activeAdmins === 1;
      const roleReason = self ? 'Свою роль здесь менять нельзя' : lastAdmin ? 'Нельзя понизить последнего активного админа' : '';
      const blockReason = self ? 'Себя заблокировать нельзя' : lastAdmin ? 'Нельзя заблокировать последнего активного админа' : '';
      const priv = courses.filter((c) => c.access === 'private' && u.courses.includes(c.id));
      const courseCell = u.role === 'admin' ? '<span class="ad-mut">все курсы</span>' :
        '<div class="ad-chips">' + priv.map((c) => '<span class="ad-pill" title="' + esc(c.title) + '">' + esc(c.title) + '</span>').join('') + '</div>' +
        (!priv.length ? '<span class="ad-small ad-mut">только публичные</span> ' : '') + '<button type="button" class="ad-linkbtn ad-grant" data-grant>изменить</button>';
      const cell = (label, html) => '<td data-label="' + label + '">' + html + '</td>';
      return '<tr data-id="' + u.id + '">' + cell('Имя', '<strong>' + esc(u.name) + '</strong>' + (self ? ' <span class="ad-small ad-mut">это ты</span>' : '') + '<br><span class="ad-small ad-mut">Создан: ' + esc(when(u.createdAt)) + '</span>') +
        cell('Логин', esc(u.login || '—')) + cell('Роль', '<span title="' + esc(roleReason) + '"><select aria-label="Роль ' + esc(u.name) + '" data-role' + (roleReason ? ' disabled aria-description="' + esc(roleReason) + '"' : '') + '>' + Object.entries(roles).map(([value, label]) => '<option value="' + value + '"' + (u.role === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></span>') +
        cell('Лимит курсов', u.role === 'author' ? '<input type="number" min="0" step="1" value="' + u.courseLimit + '" aria-label="Лимит курсов ' + esc(u.name) + '" data-limit>' : '—') + cell('Курсы', courseCell) + cell('Откуда', esc(u.inviteNote || (u.inviteId ? 'Приглашение #' + u.inviteId : '—'))) +
        cell('Когда был', esc(u.lastSeenAt ? when(u.lastSeenAt) : 'ещё не входил')) +
        cell('Статус', '<span class="ad-pill ' + (u.disabledAt ? 'bad' : 'good') + '">' + (u.disabledAt ? 'заблокирован' : 'активен') + '</span>') +
        cell('Действия', '<div class="ad-user-actions"><span title="' + (u.disabledAt ? 'Сначала разблокируй пользователя' : '') + '"><button type="button" class="btn" data-reset' + (u.disabledAt ? ' disabled' : '') + '>Ссылка для сброса пароля</button></span>' +
          '<span title="' + esc(blockReason) + '"><button type="button" class="btn' + (!u.disabledAt ? ' ad-danger' : '') + '" data-block' + (blockReason ? ' disabled aria-description="' + esc(blockReason) + '"' : '') + '>' + (u.disabledAt ? 'Разблокировать' : 'Заблокировать') + '</button></span></div>') + '</tr>';
    }).join('') || '<tr><td colspan="9">Никого не найдено. Измени поиск или фильтры.</td></tr>';
    rows.querySelectorAll('tr[data-id]').forEach((tr) => {
      const u = users.find((u) => String(u.id) === tr.dataset.id);
      tr.querySelector('[data-reset]').addEventListener('click', () => resetLinkDialog(u, load));
      tr.querySelector('[data-block]').addEventListener('click', async (e) => {
        const disabled = !u.disabledAt;
        if (!(await confirmDialog((disabled ? 'Заблокировать ' : 'Разблокировать ') + u.name + '?', disabled ? 'Все сессии закроются. Доступ к аккаунту будет закрыт до разблокировки; прогресс сохранится.' : 'Пользователь снова сможет войти в аккаунт.', disabled ? 'Заблокировать' : 'Разблокировать', disabled))) return;
        e.target.disabled = true;
        const r = await request('PUT', '/api/admin/users/' + u.id + '/disabled', { disabled });
        if (r !== null) { toast('Статус изменён', 'good'); await load(); } else e.target.disabled = false;
      });
      tr.querySelector('[data-role]').addEventListener('change', async (e) => {
        const role = e.target.value;
        e.target.value = u.role;
        if (role === u.role || !(await confirmDialog('Изменить роль · ' + u.name, roles[u.role] + ' → ' + roles[role] + (role === 'admin' ? '. Админ получает полный доступ к платформе.' : '. Права изменятся сразу.'), 'Изменить роль', true))) return;
        e.target.disabled = true;
        if (await request('PUT', '/api/admin/users/' + u.id, { role })) { toast('Роль изменена', 'good'); await load(); } else e.target.disabled = false;
      });
      const limit = tr.querySelector('[data-limit]');
      if (limit) limit.addEventListener('change', async () => {
        if (!limit.reportValidity()) return;
        const courseLimit = limit.value === '' ? null : Number(limit.value);
        limit.disabled = true;
        if (await request('PUT', '/api/admin/users/' + u.id + '/course-limit', { courseLimit })) { toast('Лимит обновлён', 'good'); await load(); } else { limit.value = u.courseLimit; limit.disabled = false; }
      });
      const grant = tr.querySelector('[data-grant]');
      if (grant) grant.addEventListener('click', () => {
        const priv = courses.filter((c) => c.access === 'private');
        const retained = u.courses.filter((id) => !priv.some((c) => c.id === id));
        grantDialog('Доступ к курсам · ' + u.name, 'Выбери закрытые курсы. Сохранённые доступы к публичным курсам остаются на случай смены доступа курса.', priv.map((c) => ({ id: c.id, label: c.title, search: c.title + ' ' + c.id })), u.courses, async (ids) => {
          if (!(await request('PUT', '/api/admin/users/' + u.id + '/courses', { courses: [...retained, ...ids] }))) return false;
          await load(); return true;
        });
      });
    });
  }
}
