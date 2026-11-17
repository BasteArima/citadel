// Shared header, global lists and explicit course tabs.
//
//   #/                       курсы
//   #/c/<курс>/edit/<узел>   редактор узла
//   #/c/<курс>/questions     вопросы; /glossary — словарь
//   #/c/<курс>/audio         озвучка: записи частей и словарь произношения
//   #/c/<курс>/versions/<v>  версии и разница
//   #/users                  пользователи
//   #/agents                 правки агентов (этап 6)
import { req, esc, h, when, plural, toast, dialog, confirmDialog, linkIcon, METALS } from './ui.js';
import { adminLayout, workPage, courseBarLayout, cardValue } from './layout.js';
import { adminNavigation } from './navigation.js';
import { draft, openDraft, onDraft, save, publishFlow } from './draft.js';
import { renderEditor } from './editor.js';
import { renderQuestions } from './questions.js';
import { renderGlossary } from './glossary.js';
import { renderPassport, renderAccess } from './passport.js';
import { renderVersions, authorLabel } from './versions.js';
import { renderInvites } from './invites.js';
import { renderUsers } from './users.js';
import { renderAudit } from './audit.js';
import { directionsDialog } from './directions.js';
import { renderAudio } from './audio.js';
import { renderTokens, renderAgents, pendingCount } from './agents.js';
import { siteTop, readTheme, saveTheme, applyTheme, markTheme } from '../site/topbar.js';

const LAST = 'citadel-admin-course';
let me = null;
let courses = [];
let offNavigation = () => {};

function rememberCourse(id) { try { localStorage.setItem(LAST, id); } catch (e) { /* optional */ } }

function shell(current) {
  const items = me.role === 'author' ? [['courses', '#/', 'Мои курсы'], ['agents', '#/agents', 'Правки агентов'], ['tokens', '#/tokens', 'Токены агентов']] : [
    ['courses', '#/', 'Курсы'], ['agents', '#/agents', 'Правки агентов'], ['users', '#/users', 'Пользователи'],
    ['invites', '#/invites', 'Приглашения'], ['tokens', '#/tokens', 'Токены агентов'], ['audit', '#/audit', 'Журнал']];
  const top = document.getElementById('top'), nav = top.querySelector('.tb-nav');
  offNavigation();
  offNavigation = adminNavigation(top, items, current);
  nav.classList.remove('open'); top.querySelector('.ad-nav-toggle')?.setAttribute('aria-expanded', 'false');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="ad"><main class="ad-main ' + adminLayout(current) + '" id="ad-main"></main></div>';
  refreshBadge();
  return document.getElementById('ad-main');
}

function initHeader() {
  const top = document.getElementById('top'), home = top.querySelector('.tb-home');
  home.href = '#/'; home.insertAdjacentHTML('beforeend', '<span class="ad-pill ad-role">' + (me.role === 'author' ? 'автор' : 'админ') + '</span>');
  top.querySelector('.tb-search')?.remove();
  top.querySelector('.tb-tools').insertAdjacentHTML('afterbegin', '<a class="btn ad-site-link" href="/" aria-label="На сайт" title="На сайт"><span aria-hidden="true">←</span><span class="ad-site-label">На сайт</span></a>');
  const toggle = h('button', 'tb-ic ad-nav-toggle', '☰');
  toggle.type = 'button'; toggle.setAttribute('aria-label', 'Меню админки'); toggle.setAttribute('aria-controls', 'admin-nav'); toggle.setAttribute('aria-expanded', 'false');
  home.after(toggle);
  const nav = top.querySelector('.tb-nav');
  const close = (focus) => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); if (focus) toggle.focus(); };
  toggle.addEventListener('click', () => { const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); if (open) nav.querySelector('a')?.focus(); });
  top.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { e.preventDefault(); close(true); } });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target) && !toggle.contains(e.target)) close(false); });
  siteTop('admin');
  const theme = h('select', 'ad-theme-select', '<option value="auto">Авто</option><option value="light">Светлая</option><option value="dark">Тёмная</option>');
  theme.setAttribute('aria-label', 'Тема'); theme.value = readTheme();
  const themeControl = h('label', 'ad-theme-control', '<span aria-hidden="true"></span>');
  themeControl.append(theme);
  top.querySelector('.tb-theme').after(themeControl);
  theme.addEventListener('change', () => { saveTheme(theme.value); applyTheme(theme.value); markTheme(top, theme.value); });
  top.addEventListener('click', (e) => { if (e.target.closest('[data-theme-set]')) theme.value = readTheme(); });
  const inner = h('div', 'ad-top-inner');
  inner.append(...top.childNodes); top.append(inner);
  // The actual height may grow at intermediate desktop widths.
  new ResizeObserver(() => document.documentElement.style.setProperty('--admin-top-h', top.offsetHeight + 'px')).observe(top);
}

// Верхняя строка страниц курса: путь, состояние черновика, «Сохранить», «Опубликовать…».
export function courseBar(main) {
  const header = h('div', 'ad-course-header');
  header.innerHTML = '<div class="ad-bar"><nav class="ad-crumbs" aria-label="Путь"><a href="#/">← Курсы</a> <strong class="ad-course-title"></strong> <span class="ad-pill ad-version"></span></nav><div class="ad-course-actions"><span class="ad-state" aria-live="polite"></span><button type="button" class="btn ad-save">Сохранить <kbd>Ctrl S</kbd></button><button type="button" class="btn pri ad-pub">Опубликовать…</button></div></div>';
  const nav = h('nav', 'ad-tabs ad-course-tabs'); nav.setAttribute('aria-label', 'Вкладки курса');
  const view = location.hash.split('/')[3] || 'edit';
  nav.innerHTML = [['edit', 'Редактор'], ['questions', 'Вопросы'], ['glossary', 'Словарь'], ['audio', 'Озвучка'], ['versions', 'Версии'], ...(me.role === 'admin' ? [['access', 'Доступ']] : []), ['passport', 'Настройки']].map(([key, title]) => '<a href="#/c/' + encodeURIComponent(draft.id) + '/' + key + '"' + (view === key ? ' aria-current="page"' : '') + '>' + title + '</a>').join('');
  header.querySelector('.ad-crumbs').after(nav); main.classList.add('ad-course-main'); main.append(header);
  const observer = new ResizeObserver(() => main.style.setProperty('--course-header-h', header.offsetHeight + 'px')); observer.observe(header);
  const bar = header.querySelector('.ad-bar'), state = bar.querySelector('.ad-state'), saveBtn = bar.querySelector('.ad-save');
  const layout = courseBarLayout(bar, nav);
  const draw = () => {
    bar.querySelector('.ad-course-title').textContent = draft.course.title;
    bar.querySelector('.ad-course-title').title = draft.course.title;
    const version = bar.querySelector('.ad-version');
    version.textContent = 'v' + draft.version;
    version.title = 'v' + draft.version + (draft.published ? ' опубликована' : ' черновик');
    version.setAttribute('aria-label', version.title);
    state.innerHTML = '<i class="ad-dot ' + (draft.dirty ? 'dirty' : draft.published ? 'pub' : '') + '"></i>' + (draft.dirty ? 'не сохранено' : draft.published ? 'опубликована' : 'сохранена');
    saveBtn.disabled = !draft.dirty;
    layout.update();
  };
  draw(); const unsubscribe = onDraft(draw); const off = () => { unsubscribe(); layout(); observer.disconnect(); };
  saveBtn.addEventListener('click', () => save()); bar.querySelector('.ad-pub').addEventListener('click', () => publishFlow());
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
  main.innerHTML = '<div class="ad-page"><div class="ad-head"><div><h1>' + (me.role === 'author' ? 'Мои курсы' : 'Курсы') + '</h1><p class="ad-sub">' + (me.role === 'author' ? 'Здесь твои курсы и проекты. Каждое сохранение — новая версия. Доступ другим выдаёт админ.' : 'Ученики видят только опубликованную версию. Каждое сохранение — новая версия.') + '</p></div>' +
    '<div class="ad-acts">' + (me.role === 'admin' ? '<button type="button" class="btn" id="ad-directions">Направления…</button>' : '') + '<label class="btn ad-file" tabindex="0" role="button">Импорт JSON<input type="file" accept=".json,application/json" hidden></label><button type="button" class="btn pri" id="ad-new">+ Новый курс</button></div></div>' +
    '<p id="ad-limit" class="ad-sub" role="status"></p><div class="ad-table-w"><table class="ad-table ad-responsive ad-courses"><colgroup><col><col class="ad-col-direction">' + (me.role === 'admin' ? '<col class="ad-col-owner"><col class="ad-col-access">' : '') + '<col class="ad-col-version"><col class="ad-col-changed"><col class="ad-col-agents"><col class="ad-col-check"></colgroup><thead><tr><th>Курс</th><th>Направление</th>' + (me.role === 'admin' ? '<th>Владелец</th><th>Доступ</th>' : '') + '<th>Версия</th><th>Изменён</th><th>Правки агентов</th><th>Проверка</th></tr></thead><tbody id="ad-rows"><tr><td colspan="8">Загружаю…</td></tr></tbody></table></div>' +
    '</div>';
  main.querySelector('#ad-directions')?.addEventListener('click', () => directionsDialog(loadCourses));
  main.querySelector('#ad-new').addEventListener('click', newCourse);
  main.querySelector('.ad-file').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); main.querySelector('.ad-file input').click(); } });
  main.querySelector('.ad-file input').addEventListener('change', (e) => importFile(e.target.files[0]));
  await loadCourses();
}

async function loadCourses() {
  const [r, directionResponse] = await Promise.all([req('GET', '/api/admin/courses'), req('GET', '/api/directions')]);
  if (!directionResponse.ok) { toast('Не загрузились направления', 'bad'); return; }
  const directions = directionResponse.data;
  if (!r.ok) { toast('Не загрузился список курсов: ' + r.status, 'bad'); return; }
  courses = r.data;
  const limit = document.getElementById('ad-limit'), create = document.getElementById('ad-new');
  if (me.role === 'author' && limit) {
    const current = await req('GET', '/api/me');
    if (current.ok) me = current.data;
    limit.textContent = 'Курсов: ' + courses.length + ' из ' + me.courseLimit;
    create.disabled = courses.length >= me.courseLimit;
    create.title = create.disabled ? 'Лимит исчерпан. Попроси админа увеличить лимит курсов.' : '';
  }
  const rows = document.getElementById('ad-rows');
  if (!rows) return;
  if (!courses.length) { rows.innerHTML = '<tr><td colspan="7">Курсов пока нет. Создай новый или импортируй JSON.</td></tr>'; }
  else rows.innerHTML = courses.map((c) => {
    const version = c.published ? (c.latest.version === c.published ? '<span class="ad-pill good">v' + c.published + '</span>' : 'v' + c.published) : '<span class="ad-mut">не опубликован</span>';
    const draftCell = c.latest.version === c.published ? '' : ' · черновик v' + c.latest.version;
    const problems = (c.check.problems || []).map((p) => p.path + ': ' + p.msg).join('\n');
    const count = c.check.errors + c.check.warnings;
    return '<tr tabindex="0" data-id="' + esc(c.id) + '">' +
      '<td><div class="ad-course">' + linkIcon(c.metal, !c.published) + '<span><a href="#/c/' + esc(c.id) + '/edit" class="ad-ct" title="' + esc(c.title || c.id) + '">' + esc(c.title || c.id) + '</a><code>' + esc(c.id) + ' · ' + esc(METALS[c.metal] || c.metal) + (c.type === 'project' ? ' · проект' : '') + '</code></span></div>' + '</td><td>' + esc(directions.find((d) => d.id === c.direction)?.title || 'Без направления') + '</td>' +
      (me.role === 'admin' ? '<td>' + esc(c.ownerName || 'платформа') + '</td><td>' + (c.access === 'private' ? 'по доступу · ' + c.grantedUsers : 'всем') + '</td>' : '') +
      '<td>' + version + (c.published ? draftCell : '') + '</td>' +
      '<td class="ad-mut" title="' + esc(authorName(c.latest.author)) + '">' + esc(when(c.latest.createdAt)) + '</td>' +
      '<td>' + (c.agents ? '<a class="ad-pill acc" href="#/agents">' + c.agents + ' ' + plural(c.agents, 'ждёт', 'ждут', 'ждут') + '</a>' : '<span class="ad-mut">—</span>') + '</td>' +
      '<td><a href="#/c/' + encodeURIComponent(c.id) + '/passport" class="ad-linkbtn ad-ck" title="' + esc(problems || 'Без ошибок') + '" aria-label="Проверка ' + esc(c.title) + ': ' + (count ? 'замечаний ' + count : 'без ошибок') + '"><span class="ad-pill ' + (count ? 'bad' : 'good') + '">' + (count ? '⚠ ' + count : '✓') + '</span></a></td>' +
      '</tr>';
  }).join('');
  const labels = ['Курс', 'Направление', ...(me.role === 'admin' ? ['Владелец', 'Доступ'] : []), 'Версия', 'Изменён', 'Правки агентов', 'Проверка'];
  rows.querySelectorAll('tr[data-id]').forEach((tr) => {
    [...tr.cells].forEach((td, i) => { td.dataset.label = labels[i]; cardValue(td); });
    const go = () => { location.hash = '#/c/' + encodeURIComponent(tr.dataset.id) + '/edit'; };
    tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) go(); });
    tr.addEventListener('keydown', (e) => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } });
  });
}

function authorName(a) { return authorLabel(a); }

function newCourse() {
  const form = h('div', 'ad-form');
  form.innerHTML = '<div class="ad-f"><label for="nc-title">Название</label><input id="nc-title" placeholder="например, PostgreSQL для бэкендера"></div>' +
    '<div class="ad-f"><label for="nc-id">id · латиница, цифры и дефис; это адрес курса /c/id/</label><input id="nc-id" placeholder="postgres" autocomplete="off"></div>' +
    '<div class="ad-f"><label for="nc-metal">Металл звена в цепи</label><select id="nc-metal">' + Object.keys(METALS).map((m) => '<option value="' + m + '">' + METALS[m] + '</option>').join('') + '</select></div>' +
    '<div class="ad-grid2"><div class="ad-f"><label for="nc-tool">Инструмент</label><input id="nc-tool" placeholder="PostgreSQL"></div>' +
    '<div class="ad-f"><label for="nc-ver">Версия · на ней получены выводы</label><input id="nc-ver" placeholder="18"></div></div>' +
    '<p class="ad-small ad-mut">' + (me.role === 'author' ? 'Курс появится закрытым черновиком. Публикация позволит тебе открыть его в каталоге. Доступ другим выдаёт админ.' : 'Курс появится черновиком: ученики увидят плитку «Скоро», а открыть его можно будет после публикации.') + '</p><p class="ad-err" role="alert"></p>';
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
  if (draft.id === r.data.id && !draft.dirty) draft.course = null; // откроется заново с новой версией
  loadCourses();
}

function pageAgents(id) {
  const main = shell('agents');
  renderAgents(main, id, () => { draft.course = draft.dirty ? draft.course : null; refreshBadge(); });
  workPage(main.querySelector('.ad-page'), '.ag-split', '.ag-detail');
}

// Сколько правок агентов ждёт — бейджем у пункта меню.
async function refreshBadge() {
  const n = await pendingCount();
  const a = document.querySelector('#admin-nav a[href="#/agents"]');
  if (!a) return;
  const old = a.querySelector('.ad-badge');
  if (old) old.remove();
  if (n) a.insertAdjacentHTML('beforeend', '<span class="ad-badge" aria-label="ждут решения: ' + n + '">' + n + '</span>');
}

// ── маршруты ──
let offBar = null, activeCourse = null, activeHash = '#/', routeGeneration = 0;
async function route() {
  const generation = ++routeGeneration;
  const targetHash = location.hash || '#/';
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (activeCourse && draft.dirty && (parts[0] !== 'c' || parts[1] !== activeCourse)) {
    const go = await confirmDialog('Уйти из курса?', 'В курсе «' + draft.course.title + '» есть несохранённые правки. Уйти без сохранения?', 'Уйти без сохранения', true);
    if (generation !== routeGeneration) return;
    if (!go) {
      history.replaceState(null, '', activeHash); return;
    }
    draft.course = null; draft.dirty = false;
  }
  if (offBar?.navigate && activeCourse === parts[1] && parts[0] === 'c' && (parts[2] || 'edit') === 'edit') {
    activeHash = targetHash; offBar.navigate(parts[3] || ''); return;
  }
  if (offBar) { offBar(); offBar = null; }
  activeCourse = parts[0] === 'c' ? parts[1] : null; activeHash = targetHash;
  if (['agents', 'tokens', 'audio'].includes(parts[0]) || (parts[0] === 'c' && !courses.some((c) => c.id === parts[1]))) {
    const list = await req('GET', '/api/admin/courses');
    if (generation !== routeGeneration) return;
    if (list.ok) courses = list.data;
  }
  if (me.role === 'author' && ['invites', 'users', 'audit'].includes(parts[0])) return pageCourses();
  if (parts[0] === 'audio') { location.hash = '#/'; return; }
  if (parts[0] === 'invites') return renderInvites(shell('invites'), courses);
  if (parts[0] === 'users') return renderUsers(shell('users'));
  if (parts[0] === 'tokens') {
    const main = shell('tokens');
    main.innerHTML = '<div class="ad-page"><section class="ad-sec" id="ad-tokens"></section></div>';
    return renderTokens(main.querySelector('#ad-tokens'), courses, me.role);
  }
  if (parts[0] === 'audit') return renderAudit(shell('audit'));
  if (parts[0] === 'agents') return pageAgents(+parts[1] || 0);
  if (parts[0] === 'c' && parts[1]) {
    const id = parts[1], view = parts[2] || 'edit';
    const opened = await openDraft(id);
    if (generation !== routeGeneration) return;
    if (!opened) { location.hash = '#/'; return; }
    rememberCourse(id);
    const current = view === 'glossary' ? 'questions' : view;
    const main = shell(current);
    if (view === 'edit') offBar = renderEditor(main, parts[3] || '', courseBar);
    else if (view === 'questions') offBar = renderQuestions(main, courseBar);
    else if (view === 'glossary') offBar = renderGlossary(main, courseBar);
    else if (view === 'passport') offBar = renderPassport(main, courseBar, courses.find((c) => c.id === id));
    else if (view === 'access' && me.role === 'admin') offBar = renderAccess(main, courseBar, courses.find((c) => c.id === id));
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
  if (!['admin', 'author'].includes(me.role)) { location.href = '/'; return; }
  const list = await req('GET', '/api/admin/courses');
  if (list.ok) courses = list.data;
  initHeader();
  window.addEventListener('hashchange', () => route().catch((e) => toast(e.message, 'bad')));
  route();
}

boot();
