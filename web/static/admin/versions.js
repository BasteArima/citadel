// Версии курса: история слева, справа — разница выбранной версии с черновиком по узлам и блокам.
// Откат кладёт старую версию поверх новой версией черновика: история не переписывается.
import { esc, h, req, toast, when, walk, nodeLabel, plural, confirmDialog } from './ui.js';
import { draft, openDraft, publishFlow, onDraft } from './draft.js';
import { SPECS, loadSpecs } from './blocks.js';

export function renderVersions(main, selected, courseBar) {
  const c = draft.course;
  const { off } = courseBar(main, '<a href="#/c/' + esc(draft.id) + '/edit">' + esc(c.title) + '</a> / <strong>Версии</strong>');
  const page = h('div', 'ad-page');
  main.appendChild(page);
  page.innerHTML = '<div class="ad-head"><div><span class="ad-sub">' + esc(c.title) + '</span><h1>Версии</h1></div><div class="ad-acts" id="v-acts"></div></div>' +
    '<div class="ad-split v-split"><section class="ad-card v-hist" aria-label="История"><div class="lbl v-hh">История</div><ul id="v-list"><li class="ad-pad">Загружаю…</li></ul></section>' +
    '<section class="v-diff" aria-label="Разница" id="v-diff"></section></div>';
  let list = [];
  const offDraft = onDraft(() => load());
  load();
  return () => { off(); offDraft(); };

  async function load() {
    await loadSpecs();
    const r = await req('GET', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/versions');
    if (!r.ok) { toast('Не загрузилась история: ' + r.status, 'bad'); return; }
    list = r.data;
    const latest = list[0].version;
    if (!selected || !list.some((v) => v.version === selected) || selected === latest) selected = (list.find((v) => v.published && v.version !== latest) || list[1] || list[0]).version;
    drawList(latest);
    drawActs(latest);
    drawDiff(latest);
  }

  function drawList(latest) {
    const ul = page.querySelector('#v-list');
    ul.innerHTML = list.map((v) => {
      const tag = v.version === latest && !v.published ? ['acc', 'черновик'] : v.published ? ['good', 'опубликована'] : v.author === 'content' ? ['', 'из файла'] : null;
      const on = v.version === selected;
      return '<li><button type="button" class="v-item' + (on ? ' on' : '') + '" data-v="' + v.version + '"' + (v.version === latest ? ' disabled' : '') + ' aria-pressed="' + on + '">' +
        '<span class="v-n"><strong>v' + v.version + '</strong>' + (tag ? '<span class="ad-pill ' + tag[0] + '">' + tag[1] + '</span>' : '') + '</span>' +
        '<span>' + esc(v.note || (v.version === 1 ? 'первая версия' : 'правка в редакторе')) + '</span>' +
        '<span class="ad-small ad-mut">' + esc(when(v.createdAt)) + ' · ' + esc(v.author === 'content' ? 'файл content/' : v.author) + '</span></button></li>';
    }).join('');
    ul.querySelectorAll('.v-item:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      selected = +b.dataset.v;
      history.replaceState(null, '', '#/c/' + draft.id + '/versions/' + selected);
      drawList(latest); drawActs(latest); drawDiff(latest);
    }));
  }

  function drawActs(latest) {
    const acts = page.querySelector('#v-acts');
    const pub = list.find((v) => v.published);
    acts.innerHTML = '<button type="button" class="btn" id="v-rb">Откатить черновик к v' + selected + '</button>' +
      (pub && pub.version === latest ? '' : '<button type="button" class="btn pri" id="v-pub">Опубликовать v' + latest + '</button>');
    acts.querySelector('#v-rb').addEventListener('click', async () => {
      if (draft.dirty && !(await confirmDialog('Несохранённое пропадёт', 'В черновике есть несохранённые правки. Откат заменит их версией v' + selected + '.', 'Откатить', true))) return;
      const r = await req('POST', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/rollback', { version: selected, base: latest });
      if (!r.ok) { toast(r.data.error || 'Откат не прошёл: ' + r.status, 'bad'); return; }
      draft.dirty = false;
      await openDraft(draft.id, true);
      toast('Черновик теперь v' + r.data.version + ' — копия v' + selected + '. Опубликуй, если всё верно.', 'good');
    });
    const p = acts.querySelector('#v-pub');
    if (p) p.addEventListener('click', () => publishFlow(latest));
  }

  async function drawDiff(latest) {
    const box = page.querySelector('#v-diff');
    box.innerHTML = '<p class="ad-mut ad-pad">Сравниваю…</p>';
    const r = await req('GET', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/versions/' + selected);
    if (!r.ok) { box.innerHTML = '<p class="ad-err">Не загрузилась v' + selected + '</p>'; return; }
    const now = draft.course; // черновик с несохранёнными правками — так видно, что уйдёт в публикацию
    const d = diffCourses(r.data.course, now);
    const added = d.reduce((s, x) => s + x.items.filter((i) => i.op === 'add').length, 0);
    const changed = d.reduce((s, x) => s + x.items.filter((i) => i.op === 'mod').length, 0);
    const removed = d.reduce((s, x) => s + x.items.filter((i) => i.op === 'del').length, 0);
    box.innerHTML = '<div class="ad-card v-sum"><strong>v' + selected + ' → v' + latest + (draft.dirty ? ' + несохранённое' : '') + ' · черновик</strong><span class="ad-sp"></span>' +
      '<span class="ad-pill good">+' + added + '</span><span class="ad-pill acc">' + changed + ' ' + plural(changed, 'изменён', 'изменено', 'изменено') + '</span><span class="ad-pill bad">' + removed + ' ' + plural(removed, 'удалён', 'удалено', 'удалено') + '</span></div>' +
      (d.length ? '' : '<p class="ad-mut ad-pad">Версии совпадают.</p>');
    d.forEach((grp) => {
      const art = h('article', 'ad-card v-grp');
      art.innerHTML = '<div class="v-gh"><strong>' + esc(grp.title) + '</strong><span class="ad-sp"></span>' + (grp.node ? '<a href="#/c/' + esc(draft.id) + '/edit/' + esc(grp.node) + '">Открыть в редакторе</a>' : '') + '</div>' +
        grp.items.map((it) => '<div class="v-it ' + it.op + '"><span class="ad-pill ' + ({ add: 'good', del: 'bad', mod: 'acc' })[it.op] + '">' + esc(it.label) + ' · ' + ({ add: 'новый', del: 'удалён', mod: 'изменён' })[it.op] + '</span><div class="v-body">' + it.html + '</div></div>').join('');
      box.appendChild(art);
    });
  }
}

// ── разница ──

function blockTitle(b) { return b.type === 'question' ? 'вопрос ' + (b.id || '') : (SPECS[b.type] ? SPECS[b.type].title.toLowerCase() : b.type); }

// Курс → карта узлов: id → { node, path }.
function nodesOf(c) {
  const m = new Map();
  walk(c.root, (n) => m.set(n.id, n));
  return m;
}

const NODE_FIELDS = ['title', 'kind', 'n', 'tag', 'icon', 'about', 'planned', 'practice', 'done', 'deps', 'time', 'lead', 'simple', 'say', 'summary', 'videos'];
const PASSPORT = ['title', 'subtitle', 'metal', 'tool', 'labels', 'review', 'pages', 'about', 'howto', 'requires'];

export function diffCourses(a, b) {
  const out = [];
  const pass = fieldsDiff(a, b, PASSPORT);
  if (pass.length) out.push({ title: 'Паспорт курса', items: pass });
  const na = nodesOf(a), nb = nodesOf(b);
  walk(b.root, (n) => {
    const old = na.get(n.id), items = [];
    if (!old) items.push({ op: 'add', label: kindName(n), html: '<strong>' + esc(n.title) + '</strong>' + ((n.blocks || []).length ? ' · ' + n.blocks.length + ' блоков' : '') });
    else {
      fieldsDiff(old, n, NODE_FIELDS).forEach((x) => items.push(x));
      const ca = (old.children || []).map((x) => x.id).join(','), cb = (n.children || []).map((x) => x.id).join(',');
      if (ca !== cb && ca.split(',').sort().join() === cb.split(',').sort().join()) items.push({ op: 'mod', label: 'порядок', html: 'дочерние узлы переставлены' });
      blocksDiff(old.blocks || [], n.blocks || []).forEach((x) => items.push(x));
    }
    if (items.length) out.push({ title: label(b, n), node: n.id, items });
  });
  walk(a.root, (n) => { if (!nb.has(n.id)) out.push({ title: label(a, n), items: [{ op: 'del', label: kindName(n), html: '<del>' + esc(n.title) + '</del>' }] }); });
  const ga = a.glossary || {}, gb = b.glossary || {}, gi = [];
  Object.keys(gb).forEach((k) => {
    if (!ga[k]) gi.push({ op: 'add', label: k, html: '<strong>' + esc(gb[k].t) + '</strong> — ' + esc(gb[k].d) });
    else if (JSON.stringify(ga[k]) !== JSON.stringify(gb[k])) gi.push({ op: 'mod', label: k, html: ['t', 'en', 'd'].filter((f) => (ga[k][f] || '') !== (gb[k][f] || '')).map((f) => '<span class="ad-mut">' + f + ':</span> ' + words(ga[k][f] || '', gb[k][f] || '')).join('<br>') });
  });
  Object.keys(ga).forEach((k) => { if (!gb[k]) gi.push({ op: 'del', label: k, html: '<del>' + esc(ga[k].t) + '</del>' }); });
  if (gi.length) out.push({ title: 'Словарь', items: gi });
  return out;
}

function kindName(n) { return ({ section: 'раздел', lesson: 'урок', part: 'часть', page: 'страница' })[n.kind] || n.kind; }
function label(c, n) { return n.kind === 'section' || n.kind === 'page' ? n.title : nodeLabel(c, n.id) + ' · ' + n.title; }

function fieldsDiff(a, b, fields) {
  const items = [];
  fields.forEach((f) => {
    const x = a[f], y = b[f];
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const op = x === undefined ? 'add' : y === undefined ? 'del' : 'mod';
    items.push({ op, label: f, html: typeof x === 'string' || typeof y === 'string' ? words(str(x), str(y)) : '<code>' + esc(JSON.stringify(x)) + '</code> → <code>' + esc(JSON.stringify(y)) + '</code>' });
  });
  return items;
}

function str(v) { return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); }

// Блоки сравниваются по содержимому (LCS); удалённый и добавленный блок одного типа на одном месте — «изменён».
function blocksDiff(a, b) {
  const ka = a.map((x) => JSON.stringify(x)), kb = b.map((x) => JSON.stringify(x));
  const ops = lcs(ka, kb), items = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === 'eq') continue;
    const nx = ops[i + 1];
    if (o.op === 'del' && nx && nx.op === 'add' && a[o.i].type === b[nx.j].type) {
      items.push({ op: 'mod', label: blockTitle(b[nx.j]), html: blockFields(a[o.i], b[nx.j]) });
      i++;
      continue;
    }
    if (o.op === 'add') items.push({ op: 'add', label: blockTitle(b[o.j]), html: preview(b[o.j]) });
    else items.push({ op: 'del', label: blockTitle(a[o.i]), html: '<del>' + esc(preview(a[o.i], true)) + '</del>' });
  }
  return items;
}

function preview(b, raw) {
  const t = b.q || b.text || b.html || b.title || b.code || (b.items || [])[0] || '';
  const s = String(typeof t === 'string' ? t : JSON.stringify(t)).replace(/<[^>]+>/g, '').slice(0, 160);
  return raw ? s : esc(s);
}

function blockFields(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return '<div class="v-fields">' + keys.map((k) => {
    const x = a[k], y = b[k];
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      return x.map((v, i) => (JSON.stringify(v) === JSON.stringify(y[i]) ? '' : '<span><span class="ad-mut">' + esc(k) + '[' + i + ']:</span> ' + words(str(v), str(y[i])) + '</span>')).join('');
    }
    return '<span><span class="ad-mut">' + esc(k) + ':</span> ' + words(str(x), str(y)) + '</span>';
  }).join('') + '</div>';
}

// Разница по словам: удалённое зачёркнуто, добавленное подсвечено.
function words(a, b) {
  const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/);
  if (ta.length * tb.length > 250000) return '<del>' + esc(a.slice(0, 300)) + '</del> <ins>' + esc(b.slice(0, 300)) + '</ins>';
  let out = '', buf = { del: '', add: '' };
  const flush = () => { if (buf.del) out += '<del>' + esc(buf.del) + '</del>'; if (buf.add) out += '<ins>' + esc(buf.add) + '</ins>'; buf = { del: '', add: '' }; };
  lcs(ta, tb).forEach((o) => {
    if (o.op === 'eq') { flush(); out += esc(ta[o.i]); }
    else if (o.op === 'del') buf.del += ta[o.i];
    else buf.add += tb[o.j];
  });
  flush();
  return out;
}

// Наибольшая общая подпоследовательность → операции eq / del / add по порядку.
function lcs(a, b) {
  const n = a.length, m = b.length, t = [];
  for (let i = 0; i <= n; i++) t.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: 'eq', i, j }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) ops.push({ op: 'del', i: i++ });
    else ops.push({ op: 'add', j: j++ });
  }
  while (i < n) ops.push({ op: 'del', i: i++ });
  while (j < m) ops.push({ op: 'add', j: j++ });
  return ops;
}
