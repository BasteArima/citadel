// Node-only behavior checks with a small UI boundary; no browser or dependencies.
// Run: node web/tests/catalog.js
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..', 'static', 'site');
const source = (name) => readFileSync(path.join(root, name), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

async function page(overview, saved = {}) {
  const handlers = {}, box = { innerHTML: '' }, status = { addEventListener: (type, fn) => { handlers.status = fn; } };
  const app = {
    innerHTML: '',
    querySelector: (selector) => selector === '#catalog-status' ? status : null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  const storage = new Map(Object.entries(saved));
  const ctx = vm.createContext({
    document: { getElementById: (id) => id === 'app' ? app : box },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    initSiteSearch: () => {}, siteTop: () => ({ update: () => {} }),
    Date, console
  });
  vm.runInContext(source('shared.js') + '\n' + source('tiles.js') + '\n' + source('projects-ui.js'), ctx);
  ctx.api = async (url) => url === '/api/me' ? { name: 'Админ' } : overview;
  await vm.runInContext('(async () => {' + source('catalog.js') + '})()', ctx);
  assert(!app.innerHTML.includes('Не удалось'), app.innerHTML);
  return {
    app, box, storage, ctx,
    direction: (id) => handlers.click({ target: { closest: () => ({ dataset: { direction: id }, classList: { contains: () => false } }) } }),
    status: (value) => handlers.status({ target: { value } })
  };
}

const course = (id, direction, extra = {}) => ({ id, direction, title: id, subtitle: 'Текст', author: 'Ира', tool: { name: 'Go', version: '1.27' }, metal: 'iron', lessons: 2, ready: 2, done: 0, started: false, due: 0, next: { id: 'lesson', n: 1, title: 'Первый' }, ...extra });

(async () => {
  const courses = [course('finished', 'programming', { done: 2, started: true }), course('fresh', 'programming'), course('active', 'programming', { started: true, done: 1 }), ...Array.from({ length: 5 }, (_, i) => course('extra-' + i, 'programming')), course('story', 'narrative'), course('other', ''), course('project', 'programming', { type: 'project', started: true })];
  const ov = { courses, soon: [{ id: 'soon', title: 'Скоро', metal: 'iron', direction: 'programming' }], directions: [{ id: 'programming', title: 'Программирование' }, { id: 'narrative', title: 'Нарратив и режиссура' }, { id: 'design', title: 'Дизайн' }] };
  const p = await page(ov);
  assert(p.app.innerHTML.includes('Программирование · 9'));
  assert(!p.app.innerHTML.includes('Дизайн'));
  assert(p.app.innerHTML.includes('В проекте сейчас'));
  assert(!p.app.innerHTML.includes('<h2>Проекты</h2>'));
  assert(!p.app.innerHTML.includes('Повторить сегодня'));
  assert(!p.app.innerHTML.includes('Сегодня повторять нечего'));
  assert.equal((p.box.innerHTML.match(/class="card tile /g) || []).length, 8); // 6 + 1 + 1
  assert(p.box.innerHTML.indexOf('>active</a>') < p.box.innerHTML.indexOf('>fresh</a>'));
  assert(p.box.innerHTML.includes('Все 9 →'));
  p.direction('programming');
  assert.equal((p.box.innerHTML.match(/class="card tile /g) || []).length, 9);
  assert(!p.box.innerHTML.includes('catalog-group-head'));
  assert(p.box.innerHTML.indexOf('>finished</a>') < p.box.innerHTML.indexOf('Курс готовится'));
  p.status('done');
  assert(p.box.innerHTML.includes('>finished</a>'));
  assert(!p.box.innerHTML.includes('>active</a>'));
  assert.equal(p.storage.get('citadel-catalog-direction'), 'programming');
  assert.equal(p.storage.get('citadel-catalog-filter'), 'done');
  p.direction('narrative');
  assert(p.box.innerHTML.includes('Пока ни одного пройденного курса'));
  const fresh = await page({ ...ov, courses: courses.filter((c) => c.type !== 'project').map((c) => ({ ...c, started: false, done: 0 })) });
  assert(!fresh.app.innerHTML.includes('В проекте сейчас'));
  assert(fresh.app.innerHTML.includes('С чего начать'));
  const restored = await page(ov, Object.fromEntries(p.storage));
  assert(restored.box.innerHTML.includes('Пока ни одного пройденного курса'));
  const due = await page({ ...ov, courses: [course('review', '', { due: 3 })] });
  assert(due.app.innerHTML.includes('3 карточки из 1 курса'));
  assert(due.app.innerHTML.includes('Повторить сегодня'));
  assert(!due.app.innerHTML.includes('review-chips'));
  const three = await page({ ...ov, courses: [...courses.map((c) => ({...c, due: c.id === 'fresh' ? 2 : c.id === 'active' ? 1 : 0}))] });
  assert.equal((three.app.innerHTML.match(/class="card top-card"/g) || []).length, 3);
  assert(three.app.innerHTML.includes('3 карточки из 2 курсов'));
  assert(due.app.innerHTML.includes('>Повторить</a>'));
  const unsafe = vm.runInContext('courseTile(' + JSON.stringify(course('escape', '', { title: '<img src=x>', subtitle: '"<script>', requires: ['secret'] })) + ', {}, { multiple: true, name: "Админ" })', p.ctx);
  assert(!unsafe.includes('<img') && !unsafe.includes('<script>'));
  assert(unsafe.includes('Опирается на: secret'));
  assert.equal((unsafe.match(/class="btn btn-l/g) || []).length, 1);
  assert(unsafe.includes('автор Ира'));
  const own = vm.runInContext('tileMeta(' + JSON.stringify(course('own', '', { author: 'Админ', onlyYours: true })) + ', { multiple: true, name: "Админ" })', p.ctx);
  assert(!own.includes('автор Админ') && own.includes('только у тебя'));
  console.log('Catalog: grouping, ordering, filters, storage, current project, review, tiles and escaping passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
