import { req, esc, h, when, toast } from './ui.js';
import { roles } from './users.js';

const actions = {
  'user.created': 'Создание аккаунта', 'user.role': 'Смена роли',
  'user.disabled': 'Блокировка', 'user.enabled': 'Разблокировка',
  'user.login': 'Смена логина', 'user.reset_link': 'Ссылка сброса пароля',
  'user.password_reset': 'Сброс пароля', 'user.registered': 'Регистрация',
  'invite.created': 'Создание приглашения', 'invite.revoked': 'Отзыв приглашения',
  'invite.deleted': 'Удаление приглашения', 'user.courses': 'Курсы пользователя',
  'course.users': 'Пользователи курса', 'course.access': 'Доступ курса',
  'user.course_limit': 'Лимит курсов', 'course.owner': 'Владелец курса', 'token.created': 'Выпуск токена',
  'token.revoked': 'Отзыв токена', 'token.deleted': 'Удаление токена',
  'token.review': 'Право проверяющего'
};

function describe(a, courseTitle, userName) {
  const d = a.details || {};
  const list = (v, label) => (v || []).map(label).join(', ') || 'нет';
  const delta = (label) => {
    const before = d.before || [], after = d.after || [];
    const added = after.filter((id) => !before.includes(id)), removed = before.filter((id) => !after.includes(id));
    return [added.length ? 'Выдал доступ: ' + list(added, label) : '', removed.length ? 'Снял доступ: ' + list(removed, label) : ''].filter(Boolean).join('. ') || 'Список доступа сохранён без изменений';
  };
  switch (a.action) {
    case 'user.created': return 'Создал аккаунт: ' + (d.login || '—') + ', роль — ' + (roles[d.role] || d.role);
    case 'user.role': return 'Сменил роль: ' + (roles[d.before] || d.before) + ' → ' + (roles[d.after] || d.after);
    case 'user.disabled': return 'Заблокировал аккаунт и закрыл его сессии';
    case 'user.enabled': return 'Разблокировал аккаунт';
    case 'user.login': return 'Сменил логин: ' + (d.before || 'не задан') + ' → ' + d.after;
    case 'user.reset_link': return 'Создал одноразовую ссылку сброса пароля на 24 часа';
    case 'user.password_reset': return d.source === 'console' ? 'Сбросил пароль из консоли' : 'Задал новый пароль по одноразовой ссылке';
    case 'user.registered': return 'Зарегистрировался по приглашению #' + d.inviteId + '. Роль — ' + (roles[d.role] || d.role) + '. Курсы: ' + list(d.courses, courseTitle);
    case 'invite.created': return 'Создал приглашение' + (d.note ? ' «' + d.note + '»' : '') + '. Роль — ' + (roles[d.role] || d.role) + '. Курсы: ' + list(d.courses, courseTitle) + '. Использований: ' + (d.maxUses == null ? 'без ограничения' : d.maxUses) + '. Срок: ' + (d.expiresAt ? when(d.expiresAt) : 'бессрочно');
    case 'invite.revoked': return 'Отозвал приглашение';
    case 'invite.deleted': return 'Удалил неактивное приглашение';
    case 'user.courses': return delta(courseTitle);
    case 'course.users': return delta(userName);
    case 'course.access': {
      const access = { public: 'публичный', private: 'закрытый' };
      return 'Сменил доступ: ' + (access[d.before] || d.before) + ' → ' + (access[d.after] || d.after);
    }
    case 'user.course_limit': return 'Сменил лимит курсов: ' + d.before + ' → ' + d.after;
    case 'course.owner': return 'Сменил владельца: ' + (d.before ? userName(d.before) : 'платформа') + ' → ' + (d.after ? userName(d.after) : 'платформа');
    case 'token.created': return 'Выпустил токен «' + d.name + '». Права: читать' + (d.propose ? ', предлагать правки' : '') + (d.create ? ', создавать курсы' : '') + (d.review ? ', проверять и публиковать' : '') + '. Курсы: ' + (d.courses?.length ? list(d.courses, courseTitle) : 'все');
    case 'token.revoked': return 'Отозвал токен агента';
    case 'token.deleted': return 'Удалил отозванный токен агента';
    case 'token.review': return d.review ? 'Выдал право проверяющего' : 'Снял право проверяющего';
    default: return 'Действие записано в журнал';
  }
}

export function renderAudit(main) {
  const page = h('div', 'ad-page');
  main.append(page);
  page.innerHTML = '<div class="ad-head"><div><h1>Журнал</h1><p class="ad-sub">Последние 200 действий выбранного типа. Пароли, коды приглашений и токены в журнал не записываются.</p></div><button type="button" class="btn" id="a-refresh">Обновить</button></div>' +
    '<div class="ad-filters"><label class="ad-f">Тип действия<select id="a-action"><option value="">Все действия</option>' + Object.entries(actions).map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('') + '</select></label></div>' +
    '<div class="ad-table-w"><table class="ad-table ad-responsive ad-audit"><thead><tr>' + ['Когда', 'Кто', 'Что', 'Над кем или чем', 'Детали'].map((x) => '<th scope="col">' + x + '</th>').join('') + '</tr></thead><tbody></tbody></table></div>';
  let generation = 0;
  page.querySelector('#a-action').addEventListener('change', load);
  page.querySelector('#a-refresh').addEventListener('click', load);
  load();

  async function load() {
    const current = ++generation, rows = page.querySelector('tbody');
    rows.innerHTML = '<tr><td colspan="5">Загружаю…</td></tr>';
    try {
      const [r, courses, users] = await Promise.all([
        req('GET', '/api/admin/audit?limit=200&action=' + encodeURIComponent(page.querySelector('#a-action').value)),
        req('GET', '/api/admin/courses'), req('GET', '/api/admin/users')
      ]);
      if (current !== generation) return;
      if (!r.ok || !courses.ok || !users.ok) throw new Error('load failed');
      const courseTitle = (id) => courses.data.find((c) => c.id === id)?.title || id;
      const userName = (id) => users.data.users.find((u) => u.id === id)?.name || 'Пользователь #' + id;
      rows.innerHTML = r.data.map((a) => {
        const target = a.action.startsWith('course.') ? courseTitle(a.target) : a.target;
        const values = [when(a.at), a.actor === 'console' ? 'Консоль' : a.actor, actions[a.action] || a.action, target, describe(a, courseTitle, userName)];
        return '<tr>' + values.map((v, i) => '<td data-label="' + ['Когда', 'Кто', 'Что', 'Над кем или чем', 'Детали'][i] + '">' + esc(v) + '</td>').join('') + '</tr>';
      }).join('') || '<tr><td colspan="5">Действий пока нет.</td></tr>';
    } catch (e) {
      if (current !== generation) return;
      rows.innerHTML = '<tr><td colspan="5">Не удалось загрузить журнал. Нажми «Обновить».</td></tr>';
      toast('Не удалось загрузить журнал', 'bad');
    }
  }
}
