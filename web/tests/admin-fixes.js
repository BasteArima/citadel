// Run: node web/tests/admin-fixes.js. Exercise the real picker and responsive
// reference layout through their DOM boundary, without browser dependencies.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = (name) => fs.readFileSync(path.join(__dirname, '../static/admin', name), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

async function main() {
  const document = { listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn; }, removeEventListener(k) { delete this.listeners[k]; } };
  const node = () => ({ children: [], attrs: {}, handlers: {}, dataset: {}, hidden: false, isConnected: true, value: '', classList: { add() {} },
    addEventListener(k, fn) { this.handlers[k] = fn; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    append(...children) { this.children.push(...children); }, focus() { document.activeElement = this; }, scrollIntoView() {},
    contains(item) { return item === this || this.children.some((child) => child.contains?.(item)); },
    async fire(k, e = {}) { await this.handlers[k]?.({ target: this, preventDefault() {}, stopPropagation() {}, ...e }); }
  });
  const input = node(), list = node(), status = node(), root = node(); root.children = [input, list, status];
  root.querySelector = (s) => ({ input, '[role=listbox]': list, '[role=status]': status })[s];
  Object.defineProperty(list, 'innerHTML', { set(html) { this.html = html; this.children = [...html.matchAll(/id="([^"]+)-option-(\d+)"/g)].map((m) => Object.assign(node(), { id: m[0], dataset: { index: m[2] } })); } });
  let timerID = 0, latest, selected = [], requests = [], pending = [];
  const timers = new Map();
  const ctx = vm.createContext({ h: () => root, document, esc: (s) => String(s).replaceAll('<', '&lt;'), avatarHTML: () => 'А', toast: assert.fail,
    setTimeout(fn, ms) { assert.equal(ms, 250); timers.set(++timerID, fn); return timerID; }, clearTimeout(id) { timers.delete(id); },
    req: async (...args) => { requests.push(args); return { ok: true, data: [{ id: 1 }, { id: 2 }] }; }
  });
  vm.runInContext(source('picker.js'), ctx);
  const picker = ctx.searchPicker({ label: 'Выбор', search: (q) => { latest = q; return new Promise((resolve) => pending.push(resolve)); }, onSelect: async (item) => { selected.push(item.id); } });
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); return Promise.all(callbacks.map((fn) => fn())); };
  input.value = 'а'; await input.fire('input'); assert.equal(timers.size, 0);
  input.value = 'ал'; await input.fire('input'); input.value = 'але'; await input.fire('input'); assert.equal(timers.size, 1);
  const old = flush(); assert.equal(latest, 'але');
  input.value = 'бор'; await input.fire('input'); const current = flush();
  pending[1]([{id: 2, title: '<Борис>'}, {id: 3, title: 'Борислав'}]); await current;
  pending[0]([{id: 1, title: 'Алексей'}]); await old;
  assert.match(list.html, /&lt;Борис>/); assert(!list.html.includes('Алексей'), 'late results cannot replace current choices');
  await input.fire('keydown', {key:'ArrowDown'}); assert.match(input.attrs['aria-activedescendant'], /option-0$/);
  await input.fire('keydown', {key:'ArrowDown'}); assert.equal(list.children[1].attrs['aria-selected'], 'true');
  await input.fire('keydown', {key:'ArrowUp'}); await input.fire('keydown', {key:'Enter'}); await Promise.resolve();
  assert.deepEqual(selected, [2]); assert.equal(input.value, ''); assert.equal(list.hidden,true); assert.equal(document.activeElement,input);
  input.value = 'бор'; await input.fire('input'); const another = flush(); pending[2]([{id:2,title:'Борис'}]); await another;
  await input.fire('keydown', {key:'Escape'}); assert.equal(input.attrs['aria-expanded'],'false'); assert.equal(document.activeElement,input);
  input.value = 'уд'; await input.fire('input'); const disposed = flush(); picker.destroy(); pending[3]([{id:4,title:'Удалённый'}]); await disposed;
  assert(!list.html.includes('Удалённый')); assert.equal(document.listeners.click, undefined);
  const users = ctx.userPicker({ label: 'Владелец', ownersOnly: true, exclude: (u) => u.id === 1, onSelect() {} });
  input.value = 'ив'; await input.fire('input'); await flush();
  assert(requests[0][1].includes('/api/admin/users/search?q=')); assert(requests[0][1].endsWith('&owners=1'));
  assert.equal(list.children.length,1); users.destroy();

  const grid = node(), left = node(), panel = node(), body = node(), back = node(), selectedRow = node(), heading = node();
  panel.querySelector = (s) => s === '[data-back]' ? back : body;
  panel.show = () => { panel.open = true; panel.modal = false; };
  panel.showModal = () => { panel.open = true; panel.modal = true; };
  panel.close = () => { panel.open = false; };
  left.querySelector = () => selectedRow;
  const page = node(); page.children = [heading, node(), node()];
  const narrow = { matches: false, addEventListener(k, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  ctx.h = (tag, cls) => ({ 'ad-reference':grid, 'ad-reference-left':left, 'ad-reference-detail':panel })[cls]; ctx.matchMedia = () => narrow;
  vm.runInContext(source('reference-layout.js'), ctx);
  const layout = ctx.referenceLayout(page, 'Вопрос');
  assert.equal(panel.open,true); assert.equal(panel.modal,false); assert.equal(grid.children[1],panel); assert.equal(left.children.length,3, 'heading, actions and filters belong to the navigation panel');
  narrow.matches = true; narrow.change(); assert.equal(panel.open,false, 'phone initially shows the list');
  selectedRow.focus(); layout.activate(); assert.equal(panel.modal,true); assert.equal(document.activeElement,back);
  await panel.fire('cancel'); assert.equal(panel.open,false); assert.equal(document.activeElement,selectedRow);
  narrow.matches = false; narrow.change(); assert.equal(panel.open,true); assert.equal(panel.modal,false);
  layout.destroy(); assert.equal(narrow.change,null); assert.equal(panel.open,false);
  console.log('Admin fixes: picker debounce, stale replies, keyboard, escaping, owner filtering, cleanup and responsive inline/mobile editor passed.');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
