// Редактор узла: слева дерево курса, в центре поля узла и его блоки, справа живое превью
// тем же движком, что видит ученик.
import { esc, h, toast, confirmDialog, walk } from './ui.js';
import { draft, touch, onDraft } from './draft.js';
import { blockForm, newBlock, SPECS, loadSpecs } from './blocks.js';
import { renderBlock } from '../engine/blocks/index.js';
import { indexCourse } from '../engine/course.js';
import { initRich, rich } from '../engine/rich.js';

const KIND = { section: 'раздел', lesson: 'урок', part: 'часть', page: 'страница' };
const CHILD = { section: 'lesson', lesson: 'part' };
const DONE = [['', 'по умолчанию'], ['questions', 'ответил на вопросы'], ['read', 'дочитал'], ['hands', 'выполнил задание'], ['manual', 'отметил вручную']];
const open = new Set(); // раскрытые узлы дерева

export function renderEditor(main, nodeId, courseBar) {
  const c = draft.course;
  let node = find(nodeId) || firstLeaf();
  if (node && node.id !== nodeId) { history.replaceState(null, '', '#/c/' + draft.id + '/edit/' + node.id); }
  pathTo(node).concat(node ? [node] : []).forEach((n) => open.add(n.id));

  const { off } = courseBar(main, '<a href="#/c/' + esc(draft.id) + '/edit">' + esc(c.title) + '</a>' + crumbs(node));
  const wrap = h('div', 'ed');
  wrap.innerHTML = '<nav class="ed-tree" aria-label="Дерево курса"></nav><div class="ed-body"></div><aside class="ed-prev" aria-label="Живое превью"></aside>';
  main.appendChild(wrap);
  const treeBox = wrap.querySelector('.ed-tree'), body = wrap.querySelector('.ed-body'), prev = wrap.querySelector('.ed-prev');

  let timer = 0;
  const changed = () => { touch(); clearTimeout(timer); timer = setTimeout(drawPreview, 250); };
  const offDraft = onDraft(() => drawTree());

  // ── дерево ──
  function drawTree() {
    treeBox.innerHTML = '<div class="ed-tree-h"><span class="lbl">Дерево</span><button type="button" class="ad-ib" id="ed-add" aria-label="Добавить узел" title="Добавить узел">+</button></div><ul class="ed-ul" role="tree"></ul>' +
      '<p class="ad-small ad-mut">Перетащи узел, чтобы переставить. Двойной клик — переименовать.</p>';
    const ul = treeBox.querySelector('ul');
    const add = (nodes, depth, into) => nodes.forEach((n) => {
      const kids = n.children && n.children.length;
      const li = h('li');
      li.setAttribute('role', 'treeitem');
      if (kids) li.setAttribute('aria-expanded', open.has(n.id) ? 'true' : 'false');
      const label = (n.kind === 'lesson' ? (n.n || '·') + ' · ' : '') + n.title;
      li.innerHTML = '<div class="ed-ti' + (n === node ? ' cur' : '') + (n.planned ? ' planned' : '') + '" draggable="true" data-id="' + esc(n.id) + '" style="padding-left:' + (8 + depth * 16) + 'px">' +
        (kids ? '<button type="button" class="ed-car" aria-label="' + (open.has(n.id) ? 'Свернуть' : 'Раскрыть') + '">' + (open.has(n.id) ? '▾' : '▸') + '</button>' : '<span class="ed-car"></span>') +
        '<a href="#/c/' + esc(draft.id) + '/edit/' + esc(n.id) + '"' + (n === node ? ' aria-current="page"' : '') + '>' + (n.kind === 'section' || n.kind === 'page' ? '<strong>' + esc(label) + '</strong>' : esc(label)) + '</a>' +
        (n.kind === 'section' || n.kind === 'page' ? '<small>' + KIND[n.kind] + '</small>' : '') +
        (draft.fresh.has(n.id) ? '<i class="ad-dot dirty" aria-label="новый"></i>' : '') + '</div>';
      into.appendChild(li);
      if (kids && open.has(n.id)) {
        const sub = h('ul', 'ed-ul');
        sub.setAttribute('role', 'group');
        li.appendChild(sub);
        add(n.children, depth + 1, sub);
      }
    });
    add(c.root, 0, ul);
    treeBox.querySelectorAll('.ed-car[aria-label]').forEach((b) => b.addEventListener('click', () => {
      const id = b.parentNode.dataset.id;
      if (open.has(id)) open.delete(id); else open.add(id);
      drawTree();
    }));
    treeBox.querySelectorAll('.ed-ti').forEach((row) => {
      row.addEventListener('dblclick', (e) => { e.preventDefault(); renameInline(row); });
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-node', row.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('text/x-node')) return;
        e.preventDefault();
        row.classList.add('drop');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop');
        moveNode(e.dataTransfer.getData('text/x-node'), row.dataset.id);
      });
    });
    treeBox.querySelector('#ed-add').addEventListener('click', addMenu);
  }

  function renameInline(row) {
    const n = find(row.dataset.id), a = row.querySelector('a');
    const inp = h('input', 'ed-rename');
    inp.value = n.title;
    inp.setAttribute('aria-label', 'Новое название');
    a.replaceWith(inp);
    inp.focus();
    inp.select();
    const done = (ok) => {
      if (ok && inp.value.trim() && inp.value.trim() !== n.title) { n.title = inp.value.trim(); changed(); }
      drawTree();
      if (n === node) drawBody();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }

  // Перетаскивание: узел того же вида встаёт перед целью, урок на раздел и часть на урок — в конец цели.
  function moveNode(srcId, dstId) {
    const src = find(srcId), dst = find(dstId);
    if (!src || !dst || src === dst || pathTo(dst).includes(src)) return;
    const from = siblings(src);
    let to, at;
    if (src.kind === dst.kind) { to = siblings(dst); at = to.indexOf(dst); }
    else if (CHILD[dst.kind] === src.kind) {
      if (dst.blocks && dst.blocks.length) { toast('У урока одной страницей нет частей: сначала разбей его на части', 'warn'); return; }
      dst.children = dst.children || []; to = dst.children; at = to.length; open.add(dst.id);
    } else { toast(KIND[src.kind] + ' сюда не встаёт', 'warn'); return; }
    from.splice(from.indexOf(src), 1);
    if (src.kind === dst.kind) to.splice(to.indexOf(dst), 0, src); else to.splice(at, 0, src);
    afterTreeChange();
  }

  function afterTreeChange() {
    let k = 0;
    walk(c.root, (n) => { if (n.kind === 'lesson') n.n = ++k; });
    walk(c.root, (n) => { if (n.children && !n.children.length) delete n.children; });
    changed();
    drawTree();
    drawBody();
  }

  function addMenu(e) {
    const menu = h('div', 'ad-menu');
    menu.setAttribute('role', 'menu');
    const opts = [['section', 'Раздел в корне'], ['page', 'Страницу курса в корне']];
    const sec = node && (node.kind === 'section' ? node : pathTo(node).find((n) => n.kind === 'section'));
    const les = node && (node.kind === 'lesson' ? node : node.kind === 'part' ? parentOf(node) : null);
    if (sec) opts.unshift(['lesson', 'Урок в раздел «' + sec.title + '»']);
    if (les && !(les.blocks && les.blocks.length)) opts.unshift(['part', 'Часть в урок «' + les.title + '»']);
    menu.innerHTML = opts.map((o) => '<button type="button" role="menuitem" data-k="' + o[0] + '">' + esc(o[1]) + '</button>').join('');
    e.currentTarget.parentNode.appendChild(menu);
    const close = () => { menu.remove(); document.removeEventListener('click', outside, true); };
    const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener('click', outside, true));
    menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      close();
      const kind = b.dataset.k;
      const n = { id: freeId(kind, les), kind, title: kind === 'section' ? 'Новый раздел' : kind === 'page' ? 'Новая страница' : kind === 'lesson' ? 'Новый урок' : 'Новая часть' };
      if (kind === 'lesson') { n.planned = true; (sec.children = sec.children || []).push(n); open.add(sec.id); }
      else if (kind === 'part') { n.blocks = []; delete les.planned; (les.children = les.children || []).push(n); open.add(les.id); }
      else if (kind === 'section') c.root.splice(c.root.filter((x) => x.kind === 'section').length, 0, n);
      else c.root.push(n);
      if (kind === 'page') n.blocks = [];
      draft.fresh.add(n.id);
      node = n;
      history.replaceState(null, '', '#/c/' + draft.id + '/edit/' + n.id);
      afterTreeChange();
      body.querySelector('#nf-title').select();
    }));
  }

  function freeId(kind, les) {
    const used = new Set();
    walk(c.root, (n) => used.add(n.id));
    const base = kind === 'part' ? les.id + '.' : kind === 'section' ? 'section-' : kind === 'page' ? 'page-' : 'lesson-';
    let i = kind === 'part' ? (les.children ? les.children.length + 1 : 1) : 1;
    while (used.has(base + i)) i++;
    return base + i;
  }

  // ── поля узла и блоки ──
  function drawBody() {
    body.innerHTML = '';
    if (!node) { body.innerHTML = '<p class="ad-mut">В курсе нет узлов. Добавь раздел кнопкой «+» над деревом.</p>'; return; }
    const n = node, f = h('div', 'ed-fields');
    const fresh = draft.fresh.has(n.id);
    let html = '<div class="ad-row ed-nh"><span class="ad-pill">' + KIND[n.kind] + (n.kind === 'lesson' ? ' ' + (n.n || '') : '') + '</span><span class="ad-sp"></span>' +
      '<button type="button" class="ad-ib" data-mv="-1" aria-label="Выше" title="Выше">↑</button><button type="button" class="ad-ib" data-mv="1" aria-label="Ниже" title="Ниже">↓</button>' +
      '<button type="button" class="ad-ib" id="nf-del" aria-label="Удалить узел" title="Удалить узел">✕</button></div>' +
      '<div class="ad-grid ed-g"><div class="ad-f ed-wide"><label for="nf-title">Заголовок</label><input id="nf-title" value="' + esc(n.title) + '"></div>' +
      (n.kind === 'lesson' || n.kind === 'part' ? '<div class="ad-f"><label for="nf-done" title="По умолчанию: ответил на вопросы части, а если их нет — дочитал">Засчитывается</label><select id="nf-done">' + DONE.map((d) => '<option value="' + d[0] + '"' + ((n.done || '') === d[0] ? ' selected' : '') + '>' + d[1] + '</option>').join('') + '</select></div>' : '') +
      '<div class="ad-f"><label for="nf-id">id' + (fresh ? '' : ' · по нему хранится прогресс') + '</label><input id="nf-id" value="' + esc(n.id) + '"' + (fresh ? '' : ' readonly') + ' class="mono"></div>';
    if (n.kind === 'section') html += field('tag', 'Оформление (tag)', n.tag) + area('about', 'Описание раздела', n.about, 2);
    if (n.kind === 'page') html += field('icon', 'Иконка', n.icon) + field('tag', 'Оформление (tag)', n.tag) + area('lead', 'Вступление', n.lead, 2) + area('about', 'Карточка на главной курса', n.about, 2);
    if (n.kind === 'part') html += '<div class="ad-f"><label for="nf-practice">Вид части</label><select id="nf-practice">' +
      [['', 'теория'], ['hands', 'практика: сделай руками'], ['test', 'проверка: итоговые вопросы']].map((o) => '<option value="' + o[0] + '"' + ((n.practice || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>';
    if (n.kind === 'lesson') {
      html += field('time', 'Время', n.time) + '<label class="ad-check-l"><input type="checkbox" id="nf-planned"' + (n.planned ? ' checked' : '') + '> В плане, ещё не написан</label>' +
        field('deps', 'Опирается на · id через запятую', (n.deps || []).join(', ')) +
        area('lead', 'Вступление урока', n.lead, 2) + area('simple', 'Простыми словами · по абзацу на строку', (n.simple || []).join('\n'), 3) +
        area('say', 'Фраза для собеса', n.say, 2) + area('summary', 'Итог · по пункту на строку', (n.summary || []).join('\n'), 3);
    }
    html += '</div>';
    f.innerHTML = html;
    body.appendChild(f);
    bindFields(f, n);

    const hasBlocks = n.kind === 'part' || n.kind === 'page' || (n.kind === 'lesson' && !(n.children && n.children.length) && !n.planned);
    if (n.kind === 'lesson' && n.children && n.children.length) {
      body.appendChild(h('p', 'ad-small ad-mut', 'Урок разбит на ' + n.children.length + ' ч. Блоки — внутри частей: выбери часть в дереве.'));
    } else if (n.kind === 'lesson' && n.planned) {
      body.appendChild(h('p', 'ad-small ad-mut', 'Урок в плане: у ученика он виден, но не открывается. Сними отметку «в плане», чтобы писать его одной страницей, или добавь части через «+».'));
    }
    if (hasBlocks) drawBlocks();
    drawPreview();
  }

  function field(k, label, v) { return '<div class="ad-f"><label for="nf-' + k + '">' + esc(label) + '</label><input id="nf-' + k + '" data-k="' + k + '" value="' + esc(v || '') + '"></div>'; }
  function area(k, label, v, rows) { return '<div class="ad-f ed-wide"><label for="nf-' + k + '">' + esc(label) + '</label><textarea id="nf-' + k + '" data-k="' + k + '" rows="' + rows + '">' + esc(v || '') + '</textarea></div>'; }

  function bindFields(f, n) {
    const t = f.querySelector('#nf-title');
    t.addEventListener('input', () => { n.title = t.value; changed(); clearTimeout(t._tm); t._tm = setTimeout(drawTree, 300); });
    const idIn = f.querySelector('#nf-id');
    idIn.addEventListener('change', () => {
      const v = idIn.value.trim();
      let taken = false;
      walk(c.root, (x) => { if (x !== n && x.id === v) taken = true; });
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(v) || taken) { toast(taken ? 'Такой id уже есть' : 'id — латиница, цифры, точка, дефис', 'bad'); idIn.value = n.id; return; }
      draft.fresh.delete(n.id); draft.fresh.add(v);
      n.id = v;
      history.replaceState(null, '', '#/c/' + draft.id + '/edit/' + v);
      changed(); drawTree();
    });
    const lines = ['simple', 'summary'];
    f.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      let v = inp.value;
      if (lines.includes(k)) v = v.split('\n').map((s) => s.trim()).filter(Boolean);
      if (k === 'deps') v = v.split(',').map((s) => s.trim()).filter(Boolean);
      if ((Array.isArray(v) && !v.length) || v === '') delete n[k]; else n[k] = v;
      changed();
    }));
    const done = f.querySelector('#nf-done');
    if (done) done.addEventListener('change', () => { if (done.value) n.done = done.value; else delete n.done; changed(); });
    const pr = f.querySelector('#nf-practice');
    if (pr) pr.addEventListener('change', () => { if (pr.value) n.practice = pr.value; else delete n.practice; changed(); });
    const pl = f.querySelector('#nf-planned');
    if (pl) pl.addEventListener('change', () => {
      if (pl.checked) { if ((n.blocks && n.blocks.length) || (n.children && n.children.length)) { toast('В плане может быть только пустой урок', 'warn'); pl.checked = false; return; } n.planned = true; delete n.blocks; }
      else { delete n.planned; n.blocks = n.blocks || []; }
      changed(); drawTree(); drawBody();
    });
    f.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => {
      const sib = siblings(n), i = sib.indexOf(n), j = i + +b.dataset.mv;
      if (j < 0 || j >= sib.length) return;
      sib.splice(i, 1); sib.splice(j, 0, n);
      afterTreeChange();
    }));
    f.querySelector('#nf-del').addEventListener('click', async () => {
      const kids = n.children ? n.children.length : 0, blocks = n.blocks ? n.blocks.length : 0;
      const ok = await confirmDialog('Удалить «' + n.title + '»?', (kids ? 'Вместе с ' + kids + ' дочерними узлами. ' : '') + (blocks ? 'В узле ' + blocks + ' блоков. ' : '') +
        'Удаление попадёт в черновик при сохранении; прошлые версии остаются в истории.', 'Удалить', true);
      if (!ok) return;
      const sib = siblings(n), i = sib.indexOf(n);
      sib.splice(i, 1);
      node = sib[i] || sib[i - 1] || parentOf(n) || firstLeaf();
      history.replaceState(null, '', '#/c/' + draft.id + '/edit/' + (node ? node.id : ''));
      afterTreeChange();
    });
  }

  function drawBlocks() {
    const n = node;
    n.blocks = n.blocks || [];
    const list = h('div', 'ed-blocks');
    body.appendChild(list);
    let dragFrom = -1;
    n.blocks.forEach((b, i) => {
      const card = blockForm(b, { course: c, node: n, onChange: changed, onReplace: (nb) => { n.blocks[i] = nb; changed(); drawBody(); } });
      card.dataset.i = i;
      const head = card.querySelector('.ed-bh');
      head.insertAdjacentHTML('beforeend', '<button type="button" class="ad-ib" data-up aria-label="Блок выше" title="Выше">↑</button><button type="button" class="ad-ib" data-down aria-label="Блок ниже" title="Ниже">↓</button><button type="button" class="ad-ib" data-del aria-label="Удалить блок" title="Удалить блок">✕</button>');
      const grip = head.querySelector('.ed-grip');
      grip.addEventListener('mousedown', () => { card.draggable = true; });
      card.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.setData('text/x-block', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => { card.draggable = false; });
      card.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); card.classList.add('drop'); } });
      card.addEventListener('dragleave', () => card.classList.remove('drop'));
      card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drop'); if (dragFrom >= 0 && dragFrom !== i) { const [m] = n.blocks.splice(dragFrom, 1); n.blocks.splice(i, 0, m); dragFrom = -1; changed(); drawBody(); } });
      head.querySelector('[data-up]').addEventListener('click', () => { if (i > 0) { n.blocks.splice(i - 1, 0, n.blocks.splice(i, 1)[0]); changed(); drawBody(); } });
      head.querySelector('[data-down]').addEventListener('click', () => { if (i < n.blocks.length - 1) { n.blocks.splice(i + 1, 0, n.blocks.splice(i, 1)[0]); changed(); drawBody(); } });
      head.querySelector('[data-del]').addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить блок?', 'Блок «' + ((SPECS[b.type] || {}).title || b.type) + '» исчезнет из черновика.', 'Удалить', true))) return;
        n.blocks.splice(i, 1); changed(); drawBody();
      });
      list.appendChild(card);
    });
    const addW = h('div', 'ed-addw');
    addW.innerHTML = '<button type="button" class="btn ed-addb" aria-expanded="false">+ Добавить блок</button>';
    body.appendChild(addW);
    const btn = addW.querySelector('button');
    btn.addEventListener('click', () => {
      const ex = addW.querySelector('.ad-menu');
      if (ex) { ex.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const menu = h('div', 'ad-menu ed-bmenu');
      menu.setAttribute('role', 'menu');
      menu.innerHTML = Object.values(SPECS).map((s) => '<button type="button" role="menuitem" data-t="' + esc(s.type) + '">' + esc(s.title) + ' <code>' + esc(s.type) + '</code></button>').join('');
      addW.appendChild(menu);
      btn.setAttribute('aria-expanded', 'true');
      menu.querySelectorAll('button').forEach((m) => m.addEventListener('click', () => {
        n.blocks.push(newBlock(m.dataset.t, c, lessonOf(n)));
        changed(); drawBody();
        const cards = body.querySelectorAll('.ed-blk');
        const last = cards[cards.length - 1];
        last.scrollIntoView({ block: 'center' });
        const first = last.querySelector('input:not([readonly]),textarea');
        if (first) first.focus();
      }));
    });
  }

  // ── превью ──
  function drawPreview() {
    prev.innerHTML = '<div class="ad-row"><span class="lbl">Превью</span><span class="ad-sp"></span><span class="ad-small ad-mut">так увидит ученик</span></div>';
    if (!node) return;
    const page = h('div', 'ed-page');
    page.id = 'page';
    prev.appendChild(page);
    try {
      initRich(indexCourse(c));
      page.appendChild(h('h2', 'pt-title', esc(node.title)));
      if (node.lead) page.appendChild(h('p', 'lead', rich(node.lead)));
      const ctx = { tool: c.tool || { name: '', version: '' }, csLabel: c.labels && c.labels.cs, label: 'Вопрос', store: { state: () => 0, answer() {} }, onSolve() {}, onChange() {} };
      const blocks = node.blocks || [];
      if (!blocks.length && !(node.children && node.children.length)) page.appendChild(h('p', 'ad-mut', 'Блоков пока нет.'));
      if (node.children && node.children.length) page.appendChild(h('p', 'ad-mut', 'Части: ' + node.children.map((p) => esc(p.title)).join(' · ')));
      blocks.forEach((b, i) => {
        try {
          const bctx = b.type === 'hands' ? Object.assign({}, ctx, { store: () => ctx.store }) : Object.assign({}, ctx, { label: 'Вопрос ' + (i + 1) });
          page.appendChild(renderBlock(b, bctx));
        } catch (e) {
          page.appendChild(h('div', 'callout warn', '<b>Блок ' + (i + 1) + ' не рисуется</b>' + esc(e.message)));
        }
      });
    } catch (e) {
      page.appendChild(h('p', 'ad-err', 'Превью не построилось: ' + esc(e.message)));
    }
  }

  loadSpecs().then(() => { drawTree(); drawBody(); });
  return () => { off(); offDraft(); clearTimeout(timer); };

  // ── помощники по дереву ──
  function find(id) { let out = null; walk(c.root, (n) => { if (n.id === id) out = n; }); return out; }
  function parentOf(n) { let out = null; walk(c.root, (x, p) => { if (x === n) out = p; }); return out; }
  function siblings(n) { const p = parentOf(n); return p ? p.children : c.root; }
  function pathTo(n) { const out = []; let p = n && parentOf(n); while (p) { out.unshift(p); p = parentOf(p); } return out; }
  function lessonOf(n) { return n.kind === 'lesson' ? n : n.kind === 'part' ? parentOf(n) : n; }
  function firstLeaf() {
    let out = null;
    walk(c.root, (n) => { if (!out && n.blocks && n.blocks.length) out = n; });
    return out || c.root[0] || null;
  }
  function crumbs(n) {
    if (!n) return '';
    return pathTo(n).map((p) => ' / ' + esc(p.kind === 'lesson' ? 'Урок ' + (p.n || '') : p.title)).join('') + ' / <strong>' + esc(n.title) + '</strong>';
  }
}

