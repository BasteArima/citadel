// Админка: тёмное боковое меню и страницы по адресу после #.
//
//   #/                       курсы
//   #/c/<курс>/edit/<узел>   редактор узла
//   #/c/<курс>/questions     вопросы и словарь (#/c/<курс>/glossary — сразу словарь)
//   #/c/<курс>/audio         озвучка: записи частей и словарь произношения
//   #/c/<курс>/versions/<v>  версии и разница
//   #/users                  пользователи
//   #/agents                 правки агентов (этап 6)
import { req, esc, h, when, plural, toast, dialog, confirmDialog, linkIcon, checkPill, AREAS, areaOf, METALS } from './ui.js';
import { draft, openDraft, onDraft, save, publishFlow } from './draft.js';
import { renderEditor } from './editor.js';
import { renderQuestions } from './questions.js';
import { renderVersions, authorLabel } from './versions.js';
import { renderInvites } from './invites.js';
import { renderUsers, courseUsersDialog } from './users.js';
import { renderAudit } from './audit.js';
import { renderAudio } from './audio.js';
import { renderTokens, renderAgents, pendingCount } from './agents.js';
import { readTheme, saveTheme, applyTheme } from '../site/topbar.js';

const LAST = 'citadel-admin-course';
let me = null;
let courses = [];
let selectedCheck = null; // курс, чья проверка открыта на странице курсов

function lastCourse() {
  try { return localStorage.getItem(LAST) || (courses[0] && courses[0].id) || ''; } catch (e) { return courses[0] ? courses[0].id : ''; }
}
function rememberCourse(id) { try { localStorage.setItem(LAST, id); } catch (e) { /* без хранилища */ } }

function shell(current) {
  const c = lastCourse();
  const items = [
    ['courses', '#/', 'Курсы'],
    ['edit', c ? '#/c/' + c + '/edit' : '#/', 'Редактор'],
    ['questions', c ? '#/c/' + c + '/questions' : '#/', 'Вопросы и словарь'],
    ['audio', c ? '#/c/' + c + '/audio' : '#/', 'Озвучка'],
    ['versions', c ? '#/c/' + c + '/versions' : '#/', 'Версии'],
    ['agents', '#/agents', 'Правки агентов'],
    ['invites', '#/invites', 'Приглашения'],
    ['users', '#/users', 'Пользователи'],
    ['tokens', '#/tokens', 'Токены агентов'],
    ['audit', '#/audit', 'Журнал']
  ];
  const app = document.getElementById('app');
  app.innerHTML = '<div class="ad">' +
    '<nav class="ad-side" aria-label="Админка">' +
    '<a class="ad-brand" href="#/"><svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><rect x="2" y="4" width="15" height="12" rx="6" fill="none" stroke="#9aa4b0" stroke-width="2.5"/><rect x="13" y="4" width="15" height="12" rx="6" fill="none" stroke="#8ab4f8" stroke-width="2.5"/></svg>Citadel <span>админ</span></a>' +
    '<a class="ad-back" href="/">← На сайт</a>' +
    items.map((it) => '<a href="' + esc(it[1]) + '"' + (it[0] === current ? ' class="on" aria-current="page"' : '') + '>' + esc(it[2]) + '</a>').join('') +
    '<span class="ad-sp"></span>' + themeSwitch() + '</nav>' +
    '<div class="ad-main" id="ad-main"></div></div>';
  refreshBadge();
  return document.getElementById('ad-main');
}

// Тема — та же, что на сайте и в курсах (site/topbar.js).
function themeSwitch() {
  const t = readTheme();
  return '<div class="ad-theme" role="group" aria-label="Тема">' + [['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']].map((x) =>
    '<button type="button" data-theme-set="' + x[0] + '" aria-pressed="' + (t === x[0]) + '">' + x[1] + '</button>').join('') + '</div>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.ad-theme [data-theme-set]');
  if (!b) return;
  saveTheme(b.dataset.themeSet);
  applyTheme(b.dataset.themeSet);
  b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});

// Верхняя строка страниц курса: путь, состояние черновика, «Сохранить», «Опубликовать…».
export function courseBar(main, crumbs) {
  const bar = h('div', 'ad-bar');
  bar.innerHTML = '<nav class="ad-crumbs" aria-label="Путь"><a href="#/">Курсы</a> / ' + crumbs + '</nav><span class="ad-sp"></span>' +
    '<span class="ad-state" aria-live="polite"></span>' +
    '<button type="button" class="btn ad-save">Сохранить <kbd>Ctrl S</kbd></button>' +
    '<button type="button" class="btn pri ad-pub">Опубликовать…</button>';
  main.appendChild(bar);
  const state = bar.querySelector('.ad-state'), saveBtn = bar.querySelector('.ad-save');
  const draw = () => {
    const st = draft.dirty ? 'есть несохранённое' : draft.published ? 'опубликована' : 'сохранена, не опубликована';
    state.innerHTML = '<i class="ad-dot ' + (draft.dirty ? 'dirty' : draft.published ? 'pub' : '') + '"></i>v' + draft.version + ' · ' + st;
    saveBtn.disabled = !draft.dirty;
  };
  draw();
  const off = onDraft(draw);
  saveBtn.addEventListener('click', () => save());
  bar.querySelector('.ad-pub').addEventListener('click', () => publishFlow());
  return { bar, off };
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && draft.course) {
    e.preventDefault();
    if (draft.dirty) save();
  }
});

// ── курсы ──
async function pageCourses() {
  const main = shell('courses');
  main.innerHTML = '<div class="ad-page"><div class="ad-head"><div><h1>Курсы</h1><p class="ad-sub">Ученики видят только опубликованную версию. Каждое сохранение — новая версия.</p></div>' +
    '<div class="ad-acts"><label class="btn ad-file">Импорт JSON<input type="file" accept=".json,application/json" hidden></label><button type="button" class="btn pri" id="ad-new">+ Новый курс</button></div></div>' +
    '<div class="ad-table-w"><table class="ad-table"><thead><tr><th>Курс</th><th>Доступ</th><th>Опубликовано</th><th>Черновик</th><th>Изменён</th><th>Правки агентов</th><th>Проверка</th><th></th></tr></thead><tbody id="ad-rows"><tr><td colspan="8">Загружаю…</td></tr></tbody></table></div>' +
    '<section class="ad-card ad-check" id="ad-check" aria-labelledby="ad-check-h"></section></div>';
  main.querySelector('#ad-new').addEventListener('click', newCourse);
  main.querySelector('.ad-file input').addEventListener('change', (e) => importFile(e.target.files[0]));
  await loadCourses();
}

async function loadCourses() {
  const r = await req('GET', '/api/admin/courses');
  if (!r.ok) { toast('Не загрузился список курсов: ' + r.status, 'bad'); return; }
  courses = r.data;
  const rows = document.getElementById('ad-rows');
  if (!rows) return;
  if (!courses.length) { rows.innerHTML = '<tr><td colspan="7">Курсов пока нет. Создай новый или импортируй JSON.</td></tr>'; }
  else rows.innerHTML = courses.map((c) => {
    const changes = c.published ? c.latest.version - c.published : c.latest.version;
    const draftCell = c.latest.version === c.published ? '<span class="ad-mut">нет</span>'
      : '<span class="ad-pill acc">v' + c.latest.version + (c.published ? ' · ' + changes + ' ' + plural(changes, 'изменение', 'изменения', 'изменений') : '') + '</span>';
    return '<tr data-id="' + esc(c.id) + '"' + (c.id === selectedCheck ? ' class="is-sel"' : '') + '>' +
      '<td><div class="ad-course">' + linkIcon(c.metal, !c.published) + '<span><a href="#/c/' + esc(c.id) + '/edit" class="ad-ct">' + esc(c.title || c.id) + '</a><code>' + esc(c.id) + ' · ' + esc(METALS[c.metal] || c.metal) + (c.type === 'project' ? ' · проект' : '') + '</code></span></div></td>' +
      '<td><select class="ad-access" aria-label="Доступ к курсу ' + esc(c.title) + '"><option value="public"' + (c.access !== 'private' ? ' selected' : '') + '>всем</option><option value="private"' + (c.access === 'private' ? ' selected' : '') + '>по доступу</option></select>' + (c.access === 'private' ? '<div class="ad-small ad-course-grants">Видят: ' + c.grantedUsers + ' — <button type="button" class="ad-linkbtn ad-grant ad-course-users">изменить</button></div>' : c.grantedUsers ? '<div class="ad-small ad-mut ad-course-grants" title="Если сделать курс закрытым, его увидят ' + c.grantedUsers + ' человек">Сохранён доступ: ' + c.grantedUsers + '</div>' : '') + '</td>' +
      '<td>' + (c.published ? '<span class="ad-pill good">v' + c.published + '</span>' : '<span class="ad-mut">не опубликован</span>') + '</td>' +
      '<td>' + draftCell + '</td>' +
      '<td class="ad-mut">' + esc(when(c.latest.createdAt)) + ' · ' + esc(authorName(c.latest.author)) + '</td>' +
      '<td>' + (c.agents ? '<a class="ad-pill acc" href="#/agents">' + c.agents + ' ' + plural(c.agents, 'ждёт', 'ждут', 'ждут') + '</a>' : '<span class="ad-mut">—</span>') + '</td>' +
      '<td><button type="button" class="ad-linkbtn ad-ck" aria-label="Проверка ' + esc(c.title) + '">' + checkPill(c.check) + '</button></td>' +
      '<td class="ad-r"><a class="btn" href="#/c/' + esc(c.id) + '/edit">Открыть</a> <button type="button" class="btn ad-danger ad-del">Удалить</button></td></tr>';
  }).join('');
  rows.querySelectorAll('.ad-access').forEach((sel) => sel.addEventListener('change', async () => {
    const id = sel.closest('tr').dataset.id;
    const r2 = await req('PUT', '/api/admin/courses/' + encodeURIComponent(id) + '/access', { access: sel.value });
    if (!r2.ok) { toast(r2.data.error || 'Ошибка ' + r2.status, 'bad'); loadCourses(); return; }
    const c = courses.find((x) => x.id === id);
    if (c) c.access = sel.value;
    toast(sel.value === 'private' ? 'Курс виден админам и выбранным пользователям' : 'Курс виден всем, кто вошёл', 'good');
    await loadCourses();
  }));
  rows.querySelectorAll('.ad-course-users').forEach((b) => b.addEventListener('click', () => courseUsersDialog(courses.find((c) => c.id === b.closest('tr').dataset.id), loadCourses)));
  rows.querySelectorAll('.ad-del').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('tr').dataset.id, c = courses.find((x) => x.id === id);
    const text = 'Удалятся все версии курса, прогресс и карточки всех учеников, правки агентов и записи озвучки. Отменить это нельзя. Файл курса на диске не удаляется и обратно курс сам не вернётся: только через «Импорт JSON».';
    if (!(await confirmDialog('Удалить курс «' + (c ? c.title : id) + '»?', text, 'Удалить навсегда', true))) return;
    const r2 = await req('DELETE', '/api/admin/courses/' + encodeURIComponent(id));
    if (!r2.ok) { toast(r2.data.error || 'Ошибка ' + r2.status, 'bad'); return; }
    toast('Курс удалён', 'good');
    try { localStorage.removeItem(LAST); } catch (e) { /* без хранилища */ }
    location.hash = '#/';
    location.reload();
  }));
  rows.querySelectorAll('.ad-ck').forEach((b) => b.addEventListener('click', () => {
    selectedCheck = b.closest('tr').dataset.id;
    rows.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('is-sel', tr.dataset.id === selectedCheck));
    drawCheck();
  }));
  if (!selectedCheck || !courses.some((c) => c.id === selectedCheck)) {
    const worst = courses.find((c) => c.check && c.check.errors) || courses.find((c) => c.check && c.check.warnings) || courses[0];
    selectedCheck = worst ? worst.id : null;
  }
  drawCheck();
}

function authorName(a) { return authorLabel(a); }

function drawCheck() {
  const box = document.getElementById('ad-check');
  const c = courses.find((x) => x.id === selectedCheck);
  if (!box || !c) { if (box) box.hidden = true; return; }
  box.hidden = false;
  const by = {};
  (c.check.problems || []).forEach((p) => { (by[areaOf(p)] = by[areaOf(p)] || []).push(p); });
  box.innerHTML = '<div class="ad-row"><h2 id="ad-check-h">Проверка черновика · ' + esc(c.title) + ' v' + c.latest.version + '</h2><span class="ad-sp"></span>' +
    '<button type="button" class="btn" id="ad-recheck">Проверить снова</button></div>' +
    '<ul class="ad-areas">' + AREAS.map((a) => {
      const ps = by[a[0]] || [], errs = ps.filter((p) => !p.warning).length;
      const cls = !ps.length ? '' : errs ? 'bad' : 'warn';
      const mark = !ps.length ? '✓' : errs ? '✕' : '!';
      const text = !ps.length ? esc(a[2]) : ps.slice(0, 3).map((p) => esc(p.path + ': ' + p.msg)).join('<br>') + (ps.length > 3 ? '<br>… ещё ' + (ps.length - 3) : '');
      return '<li class="' + cls + '"><span class="ad-mark" aria-hidden="true">' + mark + '</span><span><strong>' + esc(a[1]) + '</strong><br><span class="ad-small">' + text + '</span></span></li>';
    }).join('') + '</ul>' +
    '<p class="ad-small ad-mut">Выводы программ проверяются на наличие: получить их нужно запуском на ' + esc(toolOf(c)) + ' и записать в блок.</p>';
  box.querySelector('#ad-recheck').addEventListener('click', async () => { await loadCourses(); toast('Проверено заново', 'good'); });
}

function toolOf(c) { return c.tool ? c.tool : 'версии инструмента из паспорта'; }

function newCourse() {
  const form = h('div', 'ad-form');
  form.innerHTML = '<div class="ad-f"><label for="nc-title">Название</label><input id="nc-title" placeholder="например, PostgreSQL для бэкендера"></div>' +
    '<div class="ad-f"><label for="nc-id">id · латиница, цифры и дефис; это адрес курса /c/id/</label><input id="nc-id" placeholder="postgres" autocomplete="off"></div>' +
    '<div class="ad-f"><label for="nc-metal">Металл звена в цепи</label><select id="nc-metal">' + Object.keys(METALS).map((m) => '<option value="' + m + '">' + METALS[m] + '</option>').join('') + '</select></div>' +
    '<div class="ad-grid2"><div class="ad-f"><label for="nc-tool">Инструмент</label><input id="nc-tool" placeholder="PostgreSQL"></div>' +
    '<div class="ad-f"><label for="nc-ver">Версия · на ней получены выводы</label><input id="nc-ver" placeholder="18"></div></div>' +
    '<p class="ad-small ad-mut">Курс появится черновиком: ученики увидят плитку «Скоро», а открыть его можно будет после публикации.</p><p class="ad-err" role="alert"></p>';
  const title = form.querySelector('#nc-title'), id = form.querySelector('#nc-id');
  title.addEventListener('input', () => {
    if (id.dataset.touched) return;
    id.value = title.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  });
  id.addEventListener('input', () => { id.dataset.touched = '1'; });
  dialog('Новый курс', form, [
    { label: 'Отмена' },
    { label: 'Создать', primary: true, onClick: async (close) => {
      const body = { id: id.value.trim(), title: title.value.trim(), metal: form.querySelector('#nc-metal').value, toolName: form.querySelector('#nc-tool').value.trim(), toolVersion: form.querySelector('#nc-ver').value.trim() };
      const r = await req('POST', '/api/admin/courses', body);
      if (!r.ok) { form.querySelector('.ad-err').textContent = r.data.error || 'Ошибка ' + r.status; return; }
      close();
      rememberCourse(body.id);
      toast('Курс создан черновиком v1', 'good');
      location.hash = '#/c/' + body.id + '/edit';
    } }
  ]);
}

async function importFile(file) {
  if (!file) return;
  let text;
  try { text = await file.text(); JSON.parse(text); } catch (e) { toast('Это не JSON: ' + e.message, 'bad'); return; }
  const r = await req('POST', '/api/admin/import', text);
  if (!r.ok) { toast(r.data.error || 'Импорт не прошёл: ' + r.status, 'bad'); return; }
  const c = r.data.check;
  toast('Импортирован «' + r.data.id + '» черновиком v' + r.data.version + (c.errors ? ' · ' + c.errors + ' ' + plural(c.errors, 'ошибка', 'ошибки', 'ошибок') : ''), c.errors ? 'warn' : 'good');
  selectedCheck = r.data.id;
  if (draft.id === r.data.id && !draft.dirty) draft.course = null; // откроется заново с новой версией
  loadCourses();
}

function pageAgents(id) {
  const main = shell('agents');
  renderAgents(main, id, () => { draft.course = draft.dirty ? draft.course : null; refreshBadge(); });
}

// Сколько правок агентов ждёт — бейджем у пункта меню.
async function refreshBadge() {
  const n = await pendingCount();
  const a = document.querySelector('.ad-side a[href="#/agents"]');
  if (!a) return;
  const old = a.querySelector('.ad-badge');
  if (old) old.remove();
  if (n) a.insertAdjacentHTML('beforeend', '<span class="ad-badge" aria-label="ждут решения: ' + n + '">' + n + '</span>');
}

// ── маршруты ──
let offBar = null;
async function route() {
  if (offBar) { offBar(); offBar = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (parts[0] === 'invites') return renderInvites(shell('invites'), courses);
  if (parts[0] === 'users') return renderUsers(shell('users'));
  if (parts[0] === 'tokens') {
    const main = shell('tokens');
    main.innerHTML = '<div class="ad-page"><h1>Токены агентов</h1><section class="ad-sec" id="ad-tokens"></section></div>';
    return renderTokens(main.querySelector('#ad-tokens'), courses);
  }
  if (parts[0] === 'audit') return renderAudit(shell('audit'));
  if (parts[0] === 'agents') return pageAgents(+parts[1] || 0);
  if (parts[0] === 'c' && parts[1]) {
    const id = parts[1], view = parts[2] || 'edit';
    if (draft.id && draft.id !== id && draft.dirty) {
      const go = confirm('В курсе «' + draft.course.title + '» есть несохранённые правки. Уйти без сохранения?');
      if (!go) { history.back(); return; }
    }
    if (!(await openDraft(id))) { location.hash = '#/'; return; }
    rememberCourse(id);
    const current = view === 'glossary' ? 'questions' : view;
    const main = shell(current);
    if (view === 'edit') offBar = renderEditor(main, parts[3] || '', courseBar);
    else if (view === 'questions' || view === 'glossary') offBar = renderQuestions(main, view, courseBar);
    else if (view === 'audio') offBar = renderAudio(main, courseBar);
    else if (view === 'versions') offBar = renderVersions(main, +parts[3] || 0, courseBar);
    else location.hash = '#/c/' + id + '/edit';
    return;
  }
  return pageCourses();
}

async function boot() {
  const r = await req('GET', '/api/me');
  me = r.data;
  if (me.role !== 'admin') { location.href = '/'; return; }
  const list = await req('GET', '/api/admin/courses');
  if (list.ok) courses = list.data;
  window.addEventListener('hashchange', route);
  route();
}

boot();
