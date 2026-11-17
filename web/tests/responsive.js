// Static cascade checks for responsive regressions. No browser or packages.
// Run: node web/tests/responsive.js
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Read declaration rules, preserving their media context and source order.
function rules(source, media = []) {
  const result = [];
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf('{', from); if (start < 0) break;
    const selector = source.slice(from, start).trim();
    let end = start + 1, depth = 1, quote = '';
    for (; end < source.length && depth; end++) {
      const c = source[end];
      if (source[end - 1] === '\\') continue;
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    assert.equal(depth, 0, 'balanced CSS rule: ' + selector);
    const body = source.slice(start + 1, end - 1);
    if (selector.startsWith('@media')) result.push(...rules(body, [...media, selector]));
    else if (!selector.startsWith('@')) {
      const declarations = Object.fromEntries(body.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
        const at = s.indexOf(':'); assert(at > 0, 'valid CSS declaration: ' + s);
        return [s.slice(0, at).trim(), s.slice(at + 1).trim()];
      }));
      // Site rules contain no commas in the :not() arguments used by these checks.
      for (const s of selector.split(',')) result.push({ selector: s.trim(), media, declarations });
    }
    from = end;
  }
  return result;
}
const load = (file) => fs.readFileSync(path.join(__dirname, '../static', file), 'utf8');
const site = rules(load('style.css')), admin = [...site, ...rules(load('admin/admin.css'))];
const element = (classes, attributes = {}, tag, index, count, pseudo) => ({ classes: classes.split(' '), attributes, tag, index, count, pseudo });

function tokenMatches(token, node) {
  token = token.replace(/:not\(([^)]+)\)/g, (_, exclude) => tokenMatches(exclude, node) ? ':never' : '');
  const pseudo = token.match(/::(before|after)/)?.[1];
  if (pseudo !== node.pseudo) return false;
  token = token.replace(/::(before|after)/, '');
  token = token.replace(/:first-child/g, node.index === 1 ? '' : ':never').replace(/:last-child/g, node.index === node.count && node.index ? '' : ':never');
  token = token.replace(/:nth-child\((\d+)\)/g, (_, n) => node.index === +n ? '' : ':never');
  if (/:never|:hover|:focus|:active|:has|::|:first|:last|:nth/.test(token)) return false;
  const tag = token.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && tag !== node.tag) return false;
  for (const match of token.matchAll(/\.([\w-]+)/g)) if (!node.classes.includes(match[1])) return false;
  for (const match of token.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
    if (!(match[1] in node.attributes) || match[2] !== undefined && node.attributes[match[1]] !== match[2]) return false;
  }
  return !token.includes('#') && !token.includes(':root');
}
function matches(selector, ancestry) {
  const tokens = selector.replace(/>/g, ' > ').trim().split(/\s+/);
  function walk(i, at) {
    if (i < 0) return true;
    if (at < 0 || !tokenMatches(tokens[i], ancestry[at])) return false;
    if (i === 0) return true;
    if (tokens[i - 1] === '>') return walk(i - 2, at - 1);
    for (let k = at - 1; k >= 0; k--) if (walk(i - 1, k)) return true;
    return false;
  }
  return walk(tokens.length - 1, ancestry.length - 1);
}
function style(sheet, width, ancestry) {
  const out = {}, priority = {};
  for (const rule of sheet) {
    const enabled = rule.media.every((query) => !query.includes('prefers-color-scheme') && [...query.matchAll(/(min|max)-width:\s*(\d+)px/g)].every((m) => m[1] === 'min' ? width >= +m[2] : width <= +m[2]));
    if (!enabled || !matches(rule.selector, ancestry)) continue;
    const weight = (rule.selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length + (rule.selector.replace(/::[\w-]+/g, '').match(/:(?!not\()[\w-]+(?:\([^)]*\))?/g) || []).length;
    for (let [key, value] of Object.entries(rule.declarations)) {
      const important = value.includes('!important'); value = value.replace(/\s*!important/, '');
      const score = weight + (important ? 100 : 0);
      if (score >= (priority[key] ?? -1)) { out[key] = value; priority[key] = score; }
    }
  }
  return out;
}
for (const width of [320, 375, 390, 820]) {
  for (const header of ['top site', 'top']) {
    const root = [element(header)];
    assert.equal(style(site, width, [...root, element('tb-nav')]).display, 'flex', 'navigation is reachable at ' + width);
    assert.equal(style(site, width, [...root, element('tb-nav')]).order, '1');
    assert.equal(style(site, width, [...root, element('tb-tools'), element('tb-theme')]).display, 'none');
    assert.equal(style(site, width, [...root, element('tb-tools'), element('tb-account'), element('tb-account-menu'), element('tb-account-themes')]).display, 'block');
  }
  const top = [element('ad-body'), element('top ad-top')];
  assert.equal(style(admin, width, top)['flex-wrap'], 'nowrap');
  assert.equal(style(admin, width, [...top, element('tb-tools'), element('btn ad-site-link')]).width, '40px');
  assert.equal(style(admin, width, [...top, element('tb-tools'), element('btn ad-site-link'), element('ad-site-label')]).display, 'none');
  const editor = [element('ad-body'), element('ed tree-collapsed', {'data-mode':'edit'})];
  assert.equal(style(admin, width, editor)['flex-direction'], 'column');
  assert.equal(style(admin, width, editor).height, 'auto');
  assert.equal(style(admin, width, [...editor, element('ed-tree')]).width, '100%');
  assert.equal(style(admin, width, [...editor, element('ed-tree'), element('ed-tree-content')]).display, 'none');
  assert.notEqual(style(admin, width, [...editor, element('ed-form-column')]).display, 'none');
  assert.equal(style(admin, width, [...editor, element('ed-form-column'), element('ed-body')]).flex, 'none', 'mobile form cannot collapse to zero height');
}
const bar = [element('ad-body'), element('ad-course-main'), element('ad-course-header'), element('ad-bar')];
assert.equal(style(admin, 1280, [...bar, element('ad-tabs ad-course-tabs')]).flex, '1 1 0');
assert.equal(style(admin, 1280, [...bar, element('ad-tabs ad-course-tabs')])['overflow-x'], 'auto');
assert.equal(style(admin, 1280, [...bar, element('ad-tabs ad-course-tabs')])['overflow-y'], 'hidden');
for (const width of [1280, 1920]) {
  assert.equal(style(admin, width, [...bar, element('ad-crumbs')]).flex, '0 1 auto');
  assert.equal(style(admin, width, [...bar, element('ad-crumbs'), element('ad-course-title')])['max-width'], '160px');
  const settings = style(admin, width, [element('ad-course-main'), element('ad-page'), element('ad-form passport-form')]);
  assert.equal(settings.width, '100%'); assert.equal(settings['max-width'], 'none');
  assert.equal(settings.display, 'flex');
}

const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(load('admin/layout.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''), context);
for (const [route, expected] of Object.entries({ courses: 'ad-list', users: 'ad-list', invites: 'ad-list', tokens: 'ad-list', audit: 'ad-list', passport: 'ad-form', access: 'ad-form', edit: 'ad-work', questions: 'ad-work', glossary: 'ad-work', versions: 'ad-work', agents: 'ad-work', audio: 'ad-split' })) {
  const classes = context.adminLayout(route).split(/\s+/);
  assert.equal(classes.length, 1, route + ' has exactly one routed layout'); assert.equal(classes[0], expected);
}
assert.match(load('admin/admin.js'), /class="ad-main ' \+ adminLayout\(current\)/, 'shell applies the tested layout to every routed main');
assert(!load('admin/admin.js').includes('id="ad-check"'), 'course list has no first-course check panel');
assert.match(load('admin/admin.js'), /\/passport" class="ad-linkbtn ad-ck"/, 'check icons link to course settings');
for (const width of [375, 390, 820, 879, 880, 1180, 1280, 1359, 1360, 1366, 1559, 1560, 1920, 2560]) {
  const root = [element('ad-body')], form = [...root, element('ad-main ad-form'), element('ad-page')];
  assert.equal(style(admin, width, form).display, 'grid');
  assert.equal(style(admin, width, form)['max-width'], 'none');
  assert.equal(style(admin, width, [...form, element('ad-form-content')])['grid-column'], '2');
  assert.equal(style(admin, width, [...form, element('ad-form-aside')])['grid-column'], width < 1560 ? '2' : '3');
  assert.equal(style(admin, width, [...form, element('ad-form-anchors')]).display, width < 1560 ? 'none' : 'flex');
  const reference = [...root, element('ad-main ad-work'), element('ad-page ad-reference-page'), element('ad-reference')];
  assert.equal(style(admin, width, reference).display, width < 880 ? 'block' : 'grid');
  const body = [...reference, element('ad-reference-detail'), element('ad-reference-body')];
  assert.equal(style(admin, width, [...body, element('ad-reference-aside')])['grid-column'], width < 1560 ? '2' : '3');
  const audio = [...root, element('ad-main ad-split'), element('ad-page'), element('ad-columns au-split')];
  assert.equal(style(admin, width, audio)['grid-template-columns'], width < 1360 ? 'minmax(0, 1fr)' : 'minmax(0, var(--ad-table-w)) var(--ad-lexicon-w)');
  const tabs = style(admin, width, [...bar, element('ad-tabs ad-course-tabs')]);
  assert.equal(tabs['overflow-x'], 'auto'); assert.equal(tabs['overflow-y'], 'hidden'); assert.equal(tabs['scrollbar-width'], 'none'); assert.equal(tabs.height, '40px');
  assert.equal(style(admin, width, bar)['flex-wrap'], width < 880 ? 'wrap' : 'nowrap');
  const wrapped = [...bar.slice(0, -1), element('ad-bar is-wrapped')];
  assert.equal(style(admin, width, wrapped)['flex-wrap'], 'wrap');
  assert.equal(style(admin, width, [...wrapped, element('ad-course-tabs')]).flex, '1 1 100%');
  assert.equal(style(admin, width, [...bar, element('ad-course-actions')])['flex-wrap'], 'nowrap');
  if (width < 880) {
    assert.equal(style(admin, width, [...bar, element('ad-course-actions'), element('', {}, 'kbd')]).display, 'none');
    assert.equal(style(admin, width, [...bar, element('ad-crumbs'), element('ad-course-title')]).flex, '0 1 auto', 'version stays next to the title');
    for (const [type, count] of [['ad-courses',8],['ad-users',9]]) {
      const table = [...root, element('ad-page'), element('ad-responsive ' + type, {}, 'table'), element('', {}, 'tbody'), element('', {}, 'tr')];
      for (let i = 1; i <= count; i++) {
        const cell = [...table, element('', {'data-label':'Label'}, 'td', i, count)];
        const resolved = style(admin, width, cell);
        assert.equal(resolved.display, 'grid', type + ' cell ' + i + ' at ' + width);
        assert.equal(resolved['grid-template-columns'], '100px minmax(0, 1fr)');
        assert.equal(resolved['text-align'], 'left'); assert.equal(resolved.padding, '8px 0');
        const label = style(admin, width, [...table, element('', {'data-label':'Label'}, 'td', i, count, 'before')]);
        assert.equal(label.display, i === 1 ? 'none' : 'block'); assert.equal(label.margin, '0');
        assert.equal(style(admin, width, [...cell, element('ad-cell-value')])['grid-column'], i === 1 ? '1 / -1' : '2', type + ' heading spans both columns, values and actions stay in column 2');
      }
    }
    for (const mode of ['', 'reading']) {
      const page = [element(mode, {}, 'body'), element('layout')];
      assert.equal(style(site, width, [...page, element('side')])['box-shadow'], 'none');
      assert.equal(style(site, width, [...page, element('side open')])['box-shadow'], '0 0 40px rgba(0,0,0,.35)');
    }
  }
  const preview = [...root, element('ed', {'data-mode':'split'}), element('ed-prev'), element('ed-column-head ed-preview-controls')];
  assert.equal(style(admin, width, preview)['flex-wrap'], 'nowrap');
  const device = style(admin, width, [...preview, element('', {}, 'select')]);
  assert.equal(device['min-width'], '0'); assert.equal(device.flex, '1 1 120px');
  const list = style(admin, width, [...root, element('ad-main ad-list'), element('ad-page')]);
  const header = style(admin, width, [...root, element('ad-top'), element('ad-top-inner')]);
  const course = style(admin, width, bar);
  assert.equal(list.width, header.width); assert.equal(list.width, course.width);
  assert.equal(list['max-width'], header['max-width']); assert.equal(list['max-width'], course['max-width']);
}
console.log('Responsive cascade: all admin routes, four layouts, centred columns, auxiliary breakpoints, header/list/bar edges, scroll-free tabs and mobile workspaces passed.');
