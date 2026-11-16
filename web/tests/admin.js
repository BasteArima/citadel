// Behavioral checks without a browser or additional packages.
// Run: node web/tests/admin.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = (file) => fs.readFileSync(path.join(__dirname, '../static', file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const clone = (v) => JSON.parse(JSON.stringify(v));

async function main() {
  const writes = [], requests = [];
  const memory = vm.createContext({ document: { documentElement: { dataset: { preview: 'draft' } } },
    localStorage: { getItem: () => '{"theme":"dark"}', setItem: (...args) => writes.push(args) },
    fetch: (...args) => requests.push(args), setTimeout() { throw new Error('Preview scheduled a sync'); } });
  vm.runInContext(source('engine/progress.js'), memory);
  const state = memory.loadState('demo', {});
  assert.equal(state.theme, 'dark');
  state.lesson('lesson').t['lesson.q1'] = 1;
  state.lesson('lesson').done = '2026-11-16';
  state.save(); state.putCard('card:lesson:q', { d: '2026-11-17' }); state.startSync();
  assert.equal(state.cards['card:lesson:q'].d, '2026-11-17');
  state.dropCard('card:lesson:q'); assert.equal(state.cards['card:lesson:q'], undefined);
  assert.equal(memory.loadState('demo', {}).lessons.lesson, undefined, 'refresh resets answers');
  assert.equal(state.importV0({ lessons: {} }), 0);
  assert.equal(writes.length, 0, 'no writes to student localStorage');
  assert.equal(requests.length, 0, 'no writes to student progress API');

  let finishSave, requestCount = 0;
  const drafts = vm.createContext({ window: { addEventListener() {} }, toast() {}, plural: () => 'ошибки',
    req: async (method, url, body) => {
      requestCount++;
      if (method === 'GET') return { ok: true, data: { course: { id: url.split('/')[4], title: 'Draft' }, version: { version: 1, published: false } } };
      return new Promise((resolve) => { finishSave = resolve; });
    } });
  vm.runInContext(source('admin/draft.js'), drafts);
  const draft = vm.runInContext('draft', drafts);
  await drafts.openDraft('demo'); draft.course.title = 'Changed'; drafts.touch();
  await drafts.openDraft('demo'); assert.equal(requestCount, 1, 'tabs keep the current draft');
  assert.equal(draft.course.title, 'Changed'); assert.equal(draft.dirty, true);
  const pendingSave = drafts.save(); draft.course.title = 'Typed during save'; drafts.touch();
  finishSave({ ok: true, data: { version: 2, check: { errors: 0 } } }); await pendingSave;
  assert.equal(draft.version, 2); assert.equal(draft.dirty, true, 'late keystrokes stay dirty');
  const nextSave = drafts.save(); await drafts.openDraft('another');
  finishSave({ ok: true, data: { version: 3, check: { errors: 0 } } }); await nextSave;
  assert.equal(draft.id, 'another'); assert.equal(draft.version, 1, 'late response does not change another course');

  const parent = {}, origin = 'https://citadel.test';
  const context = vm.createContext({ window: { parent }, location: { origin } });
  vm.runInContext(source('engine/preview.js'), context);
  const initial = { id: 'demo', title: 'Old', glossary: {}, root: [{ id: 'section', children: [{ id: 'lesson', title: 'Old lesson' }] }] };
  const change = { type: 'citadel-preview', courseVersion: 3, node: { id: 'lesson', title: 'Changed' } };
  for (const event of [{ origin: 'https://evil.test', source: parent, data: change }, { origin, source: {}, data: change }, { origin, source: parent, data: { ...change, type: 'wrong' } }, { origin, source: parent, data: { ...change, courseVersion: '3' } }]) {
    const c = clone(initial); assert.equal(context.applyPreviewMessage(event, c), null); assert.deepEqual(c, initial);
  }
  const c = clone(initial);
  context.applyPreviewMessage({ origin, source: parent, data: change }, c);
  assert.equal(c.root[0].children[0].title, 'Changed');
  const whole = { ...initial, title: 'New passport', glossary: { term: { t: 'Термин', d: 'Meaning' } } };
  context.applyPreviewMessage({ origin, source: parent, data: { type: 'citadel-preview', courseVersion: 4, course: whole } }, c);
  assert.equal(c.title, 'New passport'); assert.equal(c.glossary.term.t, 'Термин');
  assert.equal(context.applyPreviewMessage({ origin, source: parent, data: { ...change, course: { ...whole, id: 'foreign' } } }, c), null);

  const ref = vm.createContext({});
  vm.runInContext(source('admin/ui.js') + '\n' + source('admin/reference.js') + '\n' + source('admin/questions.js'), ref);
  const lesson = { id: 'lesson', kind: 'lesson', children: [{ id: 'part', kind: 'part', blocks: [{ type: 'question', id: 'q', kind: 'text', q: 'Q', a: ['A'], why: '' }, { type: 'hands', check: [{ id: 'h', kind: 'order', q: 'Q', items: ['A', 'B'] }] }] }] };
  const questions = ref.allQuestions({ root: [{ kind: 'section', children: [lesson] }] });
  assert.equal(questions.length, 2); assert.equal(questions[0].lesson, lesson); assert(questions[1].hands);
  assert.deepEqual(Array.from(ref.questionProblems(questions[0].q)), ['why']);
  assert.deepEqual(Array.from(ref.questionProblems({ id: 'q', kind: 'choice', q: 'Q', opts: ['A', 'B'], a: 3, why: 'Reason' })), ['answer']);
  assert.deepEqual(Array.from(ref.questionProblems({ kind: 'order', q: '', items: ['A'] })), ['why', 'text', 'answer', 'id']);
  assert.deepEqual(Array.from(ref.questionProblems({ id: 'q', kind: 'text', q: 'Q', a: ['A'], why: 'Reason' })), []);
  const course = { root: [{ id: 'lesson', title: '{{term}}', blocks: [{ html: '{{term|слово}} {{>term}}' }] }], glossary: { term: { t: 'Term', d: '' }, another: { d: '{{term}}' } }, about: '{{term}}', howto: ['{{term}}'] };
  assert.equal(ref.usage(course).term.length, 5);
  assert.equal(ref.renameTerm(course, 'term', 'renamed'), 5);
  assert.equal(ref.usage(course).renamed.length, 5); assert.equal(course.glossary.term, undefined);
  assert.equal(course.root[0].blocks[0].html, '{{renamed|слово}} {{>term}}', 'node refs stay intact');

  const node = () => ({ handlers: {}, style: {}, dataset: {}, attrs: {}, classList: { toggle() {} },
    addEventListener(type, fn) { this.handlers[type] = fn; }, setAttribute(key, value) { this.attrs[key] = value; },
    async fire(type, event = {}) { await this.handlers[type]?.({ preventDefault() {}, ...event }); } });
  const controls = node(), prev = node(), frame = node(), viewport = node(), caption = node(), select = node(), student = node(), tree = node();
  const modes = ['edit', 'split', 'preview'].map((mode) => Object.assign(node(), { dataset: { mode } }));
  controls.querySelector = (selector) => ({ '[data-tree]': tree, select, '[data-student]': student })[selector];
  controls.querySelectorAll = () => modes;
  prev.querySelector = (selector) => selector === 'iframe' ? frame : viewport; prev.firstElementChild = caption;
  viewport.clientWidth = 640; viewport.clientHeight = 600;
  const timers = new Map(), sent = [], prefs = [], tabs = []; let timerId = 0, modal, saved = 0, currentNode = { id: 'part', blocks: [] };
  const narrow = { matches: false, addEventListener(type, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  frame.contentWindow = { postMessage: (message, target) => sent.push({ message, target }) };
  const previewContext = vm.createContext({ h: () => controls, location: { origin },
    draft: { id: 'demo', course: initial, version: 3, dirty: false }, save: async () => { saved++; return true; },
    localStorage: { getItem: () => null, setItem: (...args) => prefs.push(args) },
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} }, document: { documentElement: { dataset: {} } },
    setTimeout: (fn, ms) => { assert.equal(ms, 300); timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    dialog: (title, text, buttons) => { modal = { title, text, buttons }; },
    window: { matchMedia: () => narrow, addEventListener(type, fn) { this[type] = fn; }, removeEventListener() {}, open: () => { const tab = {}; tabs.push(tab); return tab; } } });
  vm.runInContext(source('admin/preview.js'), previewContext);
  const wrap = { querySelector: () => prev, dataset: {}, classList: { toggle() {} } };
  const preview = previewContext.previewTools({ insertBefore() {}, style: { setProperty() {} } }, wrap, () => currentNode);
  assert.equal(wrap.dataset.mode, 'split');
  for (const width of [320, 375, 390, 820, 1280]) {
    narrow.matches = width <= 899; narrow.change();
    const expected = narrow.matches ? 'edit' : 'split';
    assert.equal(wrap.dataset.mode, expected, 'split preference adapts at ' + width);
    assert.equal(modes.find((b) => b.dataset.mode === expected).attrs['aria-pressed'], 'true');
  }
  narrow.matches = true; narrow.change();
  await modes[2].fire('click'); assert.equal(wrap.dataset.mode, 'preview', 'phone can still open preview');
  await modes[0].fire('click'); assert.equal(wrap.dataset.mode, 'edit');
  assert.equal(frame.style.width, '1280px'); assert.equal(frame.style.transform, 'scale(0.5)'); assert.equal(frame.style.height, '1200px');
  assert.match(caption.textContent, /ПК · 1280 · уменьшено до 50%/);
  previewContext.window.message({ origin: 'https://evil.test', source: frame.contentWindow, data: { type: 'citadel-preview-ready' } });
  assert.equal(timers.size, 0, 'ignore foreign ready message');
  previewContext.window.message({ origin, source: frame.contentWindow, data: { type: 'citadel-preview-ready' } }); preview.update(); preview.update();
  assert.equal(timers.size, 1, 'updates are throttled, including continuous typing');
  const flush = () => { const run = [...timers.values()]; timers.clear(); run.forEach((fn) => fn()); };
  flush(); assert.equal(sent.length, 1); assert.equal(sent[0].target, origin); assert.equal(sent[0].message.course.id, 'demo'); assert.equal(sent[0].message.navigate, 'part');
  currentNode = { id: 'next', blocks: [{ type: 'text', html: 'changed' }] }; preview.update({ navigate: true }); flush();
  assert.equal(sent[1].message.node.id, 'next'); assert.equal(sent[1].message.navigate, 'next');
  preview.update({ full: true }); flush(); assert(sent[2].message.course);
  select.value = '390'; await select.fire('change', { target: select }); assert.equal(frame.style.width, '390px'); assert.equal(frame.style.transform, 'scale(1)'); assert(prefs.length);
  previewContext.draft.dirty = true; await student.fire('click');
  assert.match(modal.text, /Несохранённые правки в новой вкладке не видны/);
  assert.deepEqual(Array.from(modal.buttons, (b) => b.label), ['Отмена', 'Открыть без них', 'Сохранить и открыть']);
  await modal.buttons[2].onClick(() => {}, { querySelectorAll: () => [] });
  assert.equal(saved, 1); assert.equal(tabs[0].location, '/admin/preview/demo#next'); assert.equal(tabs[0].opener, null);
  preview.destroy();
  assert.equal(narrow.change, null, 'media listener is removed with the editor');
  console.log('Admin checks passed: memory progress, message origin/source, whole-course and node updates, question filters, term references, preview scale/throttle/preferences and save-before-open.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
