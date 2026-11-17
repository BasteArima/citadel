// Routed layout behavior at DOM boundaries, without a browser or dependencies.
// Run: node web/tests/admin-layout.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = (file) => fs.readFileSync(path.join(__dirname, '../static/admin', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

async function main() {
  const node = () => ({ children: [], attrs: {}, handlers: {}, hidden: false,
    classList: { values: new Set(), remove(k) { this.values.delete(k); }, toggle(k, on) { if (on) this.values.add(k); else this.values.delete(k); } },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(k, fn) { this.handlers[k] = fn; },
    move(child, index) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); this.children.splice(index, 0, child); child.parent = this; },
    append(...children) { children.forEach((child) => this.move(child, this.children.length)); }, prepend(child) { this.move(child, 0); }, insertBefore(child, before) { if (child.parent) { child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; } this.move(child, this.children.indexOf(before)); }
  });
  const nav = node(), inner = node(), tools = node(), more = node(), button = node(), menu = node();
  more.firstElementChild = button; more.lastElementChild = menu;
  menu.querySelector = () => menu.children.find((child) => child.attrs['aria-current'] === 'page');
  Object.defineProperty(nav, 'innerHTML', { set(html) {
    this.children = [...html.matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)].map((m) => {
      const link = node(); link.href = m[1]; link.text = m[3]; link.parent = nav;
      if (m[2]) link.attrs['aria-current'] = 'page'; return link;
    });
  } });
  Object.defineProperty(inner, 'scrollWidth', { get() { return 450 + nav.children.filter((n) => n !== more).length * 100 + (more.hidden ? 0 : 80); } });
  inner.clientWidth = 1200;
  let narrow = false, resize, disposed = false, closed = 0;
  const binding = () => { disposed = true; }; binding.close = () => { closed++; };
  const context = vm.createContext({ h: () => more, matchMedia: (query) => { assert.equal(query, '(max-width: 879px)'); return { matches: narrow }; },
    bindMenu: (root, b, m) => { assert.equal(root, more); assert.equal(b, button); assert.equal(m, menu); return binding; },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() { this.disconnected = true; } }
  });
  vm.runInContext(source('navigation.js'), context);
  const top = { querySelector: (s) => ({'.tb-nav':nav,'.ad-top-inner':inner,'.tb-tools':tools})[s] };
  const items = [['courses','#/','Курсы'],['agents','#/agents','Правки агентов'],['users','#/users','Пользователи'],['invites','#/invites','Приглашения'],['tokens','#/tokens','Токены агентов'],['audit','#/audit','Журнал']];
  const cleanup = context.adminNavigation(top, items, 'tokens');
  assert.equal(menu.children.length, 0); assert.equal(more.hidden, true, 'no More button while all six sections fit');
  inner.clientWidth = 1050; resize(); assert.equal(more.hidden, true, 'do not reserve space for an unnecessary More button');
  inner.clientWidth = 700; resize();
  assert.deepEqual(menu.children.map((n) => n.href), ['#/agents','#/users','#/invites','#/tokens','#/audit'], 'rightmost primary sections overflow in order');
  assert(button.classList.values.has('is-active'), 'More indicates the selected nested section');
  assert(menu.children.every((n) => n.attrs.role === 'menuitem' && n.tabIndex === -1));
  assert(inner.scrollWidth <= inner.clientWidth);
  inner.clientWidth = 1200; resize(); assert.equal(menu.children.length, 0, 'all sections return when space is available'); assert.equal(more.hidden, true);
  narrow = true; resize();
  assert.equal(more.hidden, true); assert.equal(menu.children.length, 0);
  assert.equal(nav.children.length, 7); assert(nav.children.slice(0, 6).every((n) => !n.attrs.role && !n.attrs.tabindex));
  narrow = false; inner.clientWidth = 700; resize(); assert.equal(menu.children.length, 5); cleanup(); assert(disposed && closed);

  vm.runInContext(source('layout.js'), context);
  const bar = node(), crumbs = node(), actions = node(), tabs = node();
  bar.querySelector = (s) => ({'.ad-crumbs':crumbs,'.ad-course-actions':actions})[s];
  crumbs.getBoundingClientRect = () => ({width:240}); actions.getBoundingClientRect = () => ({width:320});
  tabs.scrollWidth = 460; bar.clientWidth = 1200;
  context.getComputedStyle = () => ({columnGap:'8px'}); context.document = {};
  const stopBar = context.courseBarLayout(bar, tabs);
  assert(!bar.classList.values.has('is-wrapped'), 'all course controls fit in one row at 1200');
  bar.clientWidth = 1085.6; resize(); assert(!bar.classList.values.has('is-wrapped'), 'compact controls can fit on a landscape tablet');
  bar.clientWidth = 960; resize(); assert(bar.classList.values.has('is-wrapped'), 'wrap on actual tab overflow');
  bar.clientWidth = 1200; resize(); assert(!bar.classList.values.has('is-wrapped'), 'measurement retries the single-row layout after widening');
  narrow = true; resize(); assert(bar.classList.values.has('is-wrapped'), 'mobile uses three rows');
  narrow = false; tabs.scrollWidth = 700; resize(); assert(bar.classList.values.has('is-wrapped'), 'longer tab labels are measured');
  stopBar(); tabs.scrollWidth = 460; resize(); assert(bar.classList.values.has('is-wrapped'), 'disposed measurement does not mutate a page');
  const cell = node(), text = node(), action = node(), value = node();
  cell.append(text, action); Object.defineProperty(cell, 'childNodes', {get() {return this.children;}});
  action.handlers.click = () => 'retained'; context.h = (tag, cls) => { assert.equal(cls, 'ad-cell-value'); return value; };
  context.cardValue(cell); assert.equal(cell.children.length, 1); assert.equal(cell.children[0], value);
  assert.deepEqual(value.children, [text, action]); assert.equal(action.handlers.click(), 'retained');

  const status = node(), results = node(), recheck = node(), box = node();
  box.querySelector = (s) => ({'[role=status]':status,'[data-results]':results,button:recheck})[s];
  const course = { id: 'demo', root: [{id:'part',children:[{id:'part.child'}]}] };
  const replies = [], requests = []; let changed, unsubscribed = false;
  const checkContext = vm.createContext({ draft: { course }, esc: (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    walk(nodes, fn) { for (const n of nodes || []) { fn(n); this.walk(n.children, fn); } },
    onDraft: (fn) => { changed = fn; return () => { unsubscribed = true; }; },
    req: (...args) => { requests.push(args); return new Promise((resolve) => replies.push(resolve)); }
  });
  // Use a function independent of `this`, as in the real traversal helper.
  checkContext.walk = function walk(nodes, fn) { for (const n of nodes || []) { fn(n); walk(n.children, fn); } };
  vm.runInContext(source('course-check.js'), checkContext);
  const html = checkContext.problemLink(course, {path:'узел part.child, блок 1',msg:'<ошибка>'});
  assert.match(html, /href="#\/c\/demo\/edit\/part.child"/); assert.match(html, /&lt;ошибка>/);
  assert(!checkContext.problemLink(course, {path:'паспорт',msg:'Ошибка'}).includes('<a'));
  const stop = checkContext.courseCheck(box);
  assert.equal(requests[0][0], 'POST'); assert.equal(requests[0][1], '/api/admin/check');
  assert.deepEqual(JSON.parse(requests[0][2]), course); assert.equal(recheck.disabled, true);
  replies.shift()({ok:true,data:{errors:0,problems:[]}}); await new Promise(setImmediate);
  assert.match(results.innerHTML, /Без ошибок/); assert.equal(recheck.disabled, false);
  course.title = 'Changed'; changed(); assert.match(status.textContent, /Проверь снова/);
  const check = recheck.handlers.click(); course.title = 'Changed during request';
  replies.shift()({ok:true,data:{errors:0,problems:[]}}); await check;
  assert.match(status.textContent, /во время проверки/);
  const next = recheck.handlers.click(); replies.shift()({ok:true,data:{errors:1,problems:[{path:'узел part',msg:'Ошибка'}]}}); await next;
  assert.match(results.innerHTML, /edit\/part/); assert(!results.innerHTML.includes('Без ошибок'));
  const pending = recheck.handlers.click(), before = results.innerHTML; stop();
  replies.shift()({ok:true,data:{errors:0,problems:[]}}); await pending;
  assert.equal(results.innerHTML, before, 'a disposed course check ignores replies'); assert(unsubscribed);
  console.log('Admin layout: responsive More menu, active state/order/cleanup and current-course check, escaping, node links and stale replies passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
