// Behavior checks at the DOM boundary, without a browser or dependencies.
// Run: node web/tests/account.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = (file) => fs.readFileSync(path.join(__dirname, '../static/site', file), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

function storage(entries) {
  const values = new Map(Object.entries(entries));
  return { get length() { return values.size; }, key: (i) => [...values.keys()][i], getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function element(document) {
  const handlers = {}, attrs = {};
  return {
    handlers, attrs, dataset: {}, hidden: false, disabled: false, isConnected: true,
    textContent: '', innerHTML: '',
    addEventListener(type, handler) { (handlers[type] ||= []).push(handler); },
    async fire(type, event = {}) {
      for (const fn of handlers[type] || []) await fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event });
    },
    setAttribute(key, value) { attrs[key] = value; }, hasAttribute: (key) => key in attrs,
    focus() { document.activeElement = this; },
    matches() { return false; }, closest() { return this; },
    remove() { this.isConnected = false; }
  };
}

async function main() {
  const document = { activeElement: null };
  Object.assign(document, element(document));
  const ctx = vm.createContext({ document, localStorage: storage({
    'unrelated': '{"dirty":true}',
    'citadel-progress:hidden-course': '{"dirty":true,"syncedAt":10}',
    'citadel-progress:broken': 'oops',
    'citadel-progress:done': '{"dirty":false,"syncedAt":100}',
    'citadel-progress:legacy': '{"lessons":{"lesson":{}}}'
  }), location: { href: '/' }, Date, console });
  vm.runInContext(source('shared.js'), ctx);
  assert.equal(ctx.syncStatus().pending, 2, 'all cached courses, including legacy marks');
  assert.equal(ctx.syncStatus().last, 100, 'last exchange');
  assert.match(ctx.syncNote(), /ещё не дошли/);
  ctx.localStorage = storage({ 'citadel-progress:done': JSON.stringify({ syncedAt: Date.now() }) });
  assert.match(ctx.syncNote(), /только что/);
  Object.defineProperty(ctx, 'localStorage', { configurable: true, get() { throw new Error('blocked storage'); } });
  assert.equal(ctx.syncStatus().pending, 0);
  Object.defineProperty(ctx, 'localStorage', { configurable: true, writable: true, value: storage({}) });

  // Real menu event handlers: navigation, wrapping, Escape, outside click, Tab,
  // and the logout trigger all work without redrawing the server header.
  const account = element(document), button = element(document), menu = element(document);
  const items = [element(document), element(document), element(document)];
  items[2].attrs['data-account-logout'] = '';
  menu.hidden = true;
  menu.querySelectorAll = () => items;
  account.querySelector = (selector) => selector === '.tb-me' ? button : menu;
  account.contains = (target) => [account, button, menu, ...items].includes(target);
  const top = { querySelector: () => account };
  ctx.initAccountMenu = vm.runInContext('(function () {' + source('topbar.js') + '; return initAccountMenu; })()', ctx);
  let logouts = 0;
  ctx.confirmLogout = (all, trigger) => { assert.equal(all, false); assert.equal(trigger, button); logouts++; };
  ctx.initAccountMenu(top);
  ctx.initAccountMenu(top);
  assert.equal(button.handlers.click.length, 1, 'initialization is idempotent');
  await button.fire('click');
  assert.equal(menu.hidden, false);
  assert.equal(button.attrs['aria-expanded'], 'true');
  assert.equal(document.activeElement, items[0]);
  await account.fire('keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement, items[2]);
  await account.fire('keydown', { key: 'Home' });
  assert.equal(document.activeElement, items[0]);
  await account.fire('keydown', { key: 'End' });
  assert.equal(document.activeElement, items[2]);
  await account.fire('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, button);
  await account.fire('keydown', { key: 'ArrowDown' });
  await document.fire('click', { target: element(document) });
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, button);
  await button.fire('click');
  await account.fire('keydown', { key: 'Tab' });
  assert.equal(menu.hidden, true);
  await button.fire('click');
  await menu.fire('click', { target: items[0] });
  assert.equal(menu.hidden, true);
  assert.equal(logouts, 0);
  await button.fire('click');
  await menu.fire('click', { target: items[2] });
  assert.equal(logouts, 1);

  // Dialog: the safe button receives focus; cancel/Escape send nothing; failures
  // keep the dialog open and show an error; both logout endpoints are exercised.
  let dialog, calls = [], fail = false;
  document.body = { appendChild(d) { dialog = d; } };
  document.createElement = () => {
    const d = element(document), nodes = {};
    d.querySelector = (selector) => nodes[selector] ||= element(document);
    d.showModal = () => { d.open = true; };
    d.close = () => { d.open = false; return d.fire('close'); };
    return d;
  };
  ctx.confirmLogout = vm.runInContext('(function () {' + source('logout.js') + '; return confirmLogout; })()', ctx);
  ctx.api = async (url, options) => { calls.push({ url, options }); if (fail) throw new Error('offline'); };
  const trigger = element(document);
  ctx.confirmLogout(false, trigger);
  assert.equal(document.activeElement, dialog.querySelector('[data-cancel]'));
  assert.match(dialog.querySelector('#logout-description').textContent, /Прогресс сохранён/);
  await dialog.querySelector('[data-cancel]').fire('click');
  assert.equal(calls.length, 0);
  assert.equal(document.activeElement, trigger);
  ctx.confirmLogout(true, trigger);
  assert.equal(dialog.querySelector('h2').textContent, 'Выйти на всех устройствах?');
  await dialog.fire('cancel');
  assert.equal(calls.length, 0);
  ctx.localStorage = storage({ 'citadel-progress:orphan': '{"dirty":true}' });
  ctx.confirmLogout(false, trigger);
  assert.match(dialog.querySelector('#logout-description').textContent, /После выхода они пропадут/);
  fail = true;
  await dialog.querySelector('[data-confirm]').fire('click');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('[data-confirm]').disabled, false);
  assert.match(dialog.querySelector('[role="alert"]').textContent, /offline/);
  assert.equal(ctx.location.href, '/');
  fail = false;
  await dialog.querySelector('[data-confirm]').fire('click');
  assert.equal(calls.at(-1).url, '/api/logout');
  assert.equal(ctx.location.href, '/login');
  await dialog.close();
  ctx.confirmLogout(true, trigger);
  await dialog.querySelector('[data-confirm]').fire('click');
  assert.equal(calls.at(-1).url, '/api/me/logout-all');
  assert.equal(calls.at(-1).options.body, '{}');

  async function profile(courses) {
    const app = { innerHTML: '' };
    const context = vm.createContext({ document: { getElementById: () => app }, initSiteSearch() {}, siteTop: () => ({ update() {} }), Date,
      api: async (url) => url === '/api/me' ? { name: '<unsafe>', role: 'student', avatar: '' } : { courses } });
    vm.runInContext(source('shared.js'), context);
    context.api = async (url) => url === '/api/me' ? { name: '<unsafe>', role: 'student', avatar: '' } : { courses };
    await vm.runInContext('(async () => {' + source('profile.js') + '})()', context);
    assert(!app.innerHTML.includes('Не удалось'), app.innerHTML);
    assert(!app.innerHTML.includes('<unsafe>'));
    assert(!app.innerHTML.includes('name-form'));
    assert(app.innerHTML.includes('href="/settings"'));
    return app.innerHTML;
  }
  assert.match(await profile([]), /Выбери курс в каталоге/);
  const base = { id: 'course', title: '<course>', metal: 'iron', lessons: 48, done: 12, started: true, parts: 12, solved: 4, firstRight: 3, due: 2, cards: 4 };
  const html = await profile([base, { ...base, id: 'project', type: 'project', done: 48 }]);
  assert.match(html, /12 из 48 уроков/);
  assert.match(html, /48 из 48 шагов/);
  assert.match(html, /href="\/p\/project\/"/);
  assert.match(html, /my-course-done">Пройден/);
  assert(!html.includes('<course>'));
  const manyCourses = await profile(Array.from({ length: 10 }, (_, i) => ({ ...base, id: 'course-' + i })));
  assert.match(manyCourses, /class="chain-scroll" tabindex="0" role="region"/);
  assert.match(manyCourses, /<svg width="440" height="33" viewBox="0 0 2000 150"/);

  // Settings uses FileReader/data: for an explicit preview. No upload on selection
  // or cancellation; saving/removing updates the same header immediately.
  const settingsDocument = { activeElement: null }, nodes = {}, uploaded = [], updates = [];
  const node = (key) => nodes[key] ||= element(settingsDocument);
  settingsDocument.getElementById = node;
  settingsDocument.querySelector = node;
  settingsDocument.querySelectorAll = (selector) => selector === '.avatar-field button' ? ['avatar-upload', 'avatar-remove', 'avatar-save', 'avatar-cancel'].map(node) : [];
  settingsDocument.createElement = () => element(settingsDocument);
  node('avatar-preview').replaceChildren = (child) => { node('avatar-preview').child = child; };
  node('name-form').querySelector = () => node('name-submit');
  node('password-form').querySelector = () => node('password-submit');
  let savedAvatar = '', savedName = 'Имя', busyName = false, allLogout = 0;
  const settingsContext = vm.createContext({
    document: settingsDocument, Date, console, localStorage: storage({}),
    initSiteSearch() {}, siteTop: () => ({ update: (user) => updates.push({ ...user }), redraw() {} }),
    readTheme: () => 'auto', confirmLogout: (all) => { assert.equal(all, true); allLogout++; },
    FileReader: class {
      addEventListener(type, fn) { this[type] = fn; }
      readAsDataURL() { this.result = 'data:image/jpeg;base64,preview'; this.load(); }
    }
  });
  vm.runInContext(source('shared.js'), settingsContext);
  settingsContext.api = async (url, options) => {
    if (url === '/api/me/avatar') {
      uploaded.push(options);
      savedAvatar = options.method === 'DELETE' ? '' : '/avatar/1?v=2';
      return null;
    }
    if (url === '/api/me/name') {
      if (busyName) throw new Error('Это имя уже занято, выбери другое.');
      savedName = JSON.parse(options.body).name;
    }
    return url === '/api/overview?today=' + settingsContext.today() ? { courses: [] } : { name: savedName, login: 'login', role: 'student', avatar: savedAvatar };
  };
  await vm.runInContext('(async () => {' + source('settings.js') + '})()', settingsContext);
  assert(!node('app').innerHTML.includes('Не удалось'), node('app').innerHTML);
  for (const section of ['account', 'security', 'appearance', 'data']) assert(node('app').innerHTML.includes('id="' + section + '"'));
  assert(!node('app').innerHTML.includes('id="logout"'));
  const photo = { type: 'image/jpeg', size: 3000 };
  node('avatar-file').files = [photo];
  await node('avatar-file').fire('change');
  assert.equal(node('avatar-preview').child.src, 'data:image/jpeg;base64,preview');
  assert.equal(uploaded.length, 0, 'selection only previews');
  await node('avatar-cancel').fire('click');
  assert.equal(uploaded.length, 0, 'cancel does not upload');
  assert.equal(node('avatar-confirm').hidden, true);
  assert.equal(settingsDocument.activeElement, node('avatar-upload'));
  await node('avatar-file').fire('change');
  await node('avatar-save').fire('click');
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].body, photo);
  assert.equal(uploaded[0].headers['Content-Type'], 'image/jpeg');
  assert.equal(updates.at(-1).avatar, '/avatar/1?v=2');
  assert.match(node('avatar-preview').innerHTML, /\/avatar\/1\?v=2/);
  await node('avatar-remove').fire('click');
  assert.equal(uploaded.at(-1).method, 'DELETE');
  assert.equal(updates.at(-1).avatar, '');
  assert.equal(node('avatar-preview').innerHTML, 'И');
  node('avatar-file').files = [{ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 }];
  await node('avatar-file').fire('change');
  assert.match(node('avatar-status').textContent, /больше 2 МБ/);
  assert.equal(uploaded.length, 2);
  busyName = true;
  await node('name-form').fire('submit');
  assert.equal(node('name-status').textContent, 'Это имя уже занято, выбери другое.');
  assert.equal(node('name-submit').disabled, false);
  busyName = false;
  node('account-name').value = 'Другое имя';
  await node('name-form').fire('submit');
  assert.equal(updates.at(-1).name, 'Другое имя');
  assert.equal(node('avatar-preview').innerHTML, 'Д');
  await node('logout-all').fire('click');
  assert.equal(allLogout, 1);
  console.log('Account checks passed: sync, menu keyboard/focus, logout, profile states, settings/avatar preview and name conflicts.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
