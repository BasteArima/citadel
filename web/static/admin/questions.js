// Вопросы и словарь курса: таблица слева, форма выбранного справа.
// Правки идут в тот же черновик, что и в редакторе узла.
import { esc, h, toast, walk, nodeLabel, confirmDialog } from './ui.js';
import { draft, touch } from './draft.js';
import { questionForm, loadSpecs, newBlock } from './blocks.js';

const KINDS = { choice: 'выбор', text: 'ввод', order: 'порядок' };
let picked = { q: null, g: null }; // выбранный вопрос (id) и термин (ключ)

export function renderQuestions(main, view, courseBar) {
  const c = draft.course;
  c.glossary = c.glossary || {};
  const tab = view === 'glossary' ? 'g' : 'q';
  const { off } = courseBar(main, '<a href="#/c/' + esc(draft.id) + '/edit">' + esc(c.title) + '</a> / <strong>Вопросы и словарь</strong>');
  const page = h('div', 'ad-page');
  main.appendChild(page);
  const qs = allQuestions(c);
  const terms = Object.keys(c.glossary).sort();
  page.innerHTML = '<div class="ad-head"><div><span class="ad-sub">' + esc(c.title) + ' · черновик v' + draft.version + '</span><h1>Вопросы и словарь</h1></div>' +
    '<button type="button" class="btn pri" id="q-add">' + (tab === 'g' ? '+ Термин' : '+ Вопрос') + '</button></div>' +
    '<div class="ad-tabs" role="tablist"><a role="tab" href="#/c/' + esc(draft.id) + '/questions"' + (tab === 'q' ? ' aria-selected="true"' : '') + '>Вопросы · ' + qs.length + '</a>' +
    '<a role="tab" href="#/c/' + esc(draft.id) + '/glossary"' + (tab === 'g' ? ' aria-selected="true"' : '') + '>Словарь · ' + terms.length + '</a></div>' +
    '<div class="ad-split"><div class="ad-table-w"><table class="ad-table"><thead></thead><tbody></tbody></table></div><section class="ad-card ad-pad ad-side-form"></section></div>';
  const thead = page.querySelector('thead'), tbody = page.querySelector('tbody'), form = page.querySelector('.ad-side-form');
  loadSpecs().then(() => (tab === 'q' ? drawQ() : drawG()));
  return off;

  // ── вопросы ──
  function drawQ() {
    page.querySelector('#q-add').onclick = addQuestion;
    if (!qs.length) { tbody.innerHTML = '<tr><td>В курсе пока нет вопросов. Их добавляют блоком «Вопрос» в редакторе узла.</td></tr>'; form.hidden = true; return; }
    if (!picked.q || !qs.some((x) => x.q.id === picked.q)) picked.q = qs[0].q.id;
    thead.innerHTML = '<tr><th>Вопрос</th><th>Узел</th><th>Вид</th><th>В контрольной</th></tr>';
    tbody.innerHTML = qs.map((x) => '<tr data-id="' + esc(x.q.id) + '"' + (x.q.id === picked.q ? ' class="is-sel"' : '') + ' tabindex="0">' +
      '<td>' + esc(plain(x.q.q) || '(без текста)') + '</td><td class="ad-mut">' + esc(nodeLabel(c, x.node.id)) + (x.hands ? ' · руками' : '') + '</td>' +
      '<td><span class="ad-pill">' + esc(KINDS[x.q.kind] || x.q.kind) + '</span></td><td>' + (x.q.exam === false || x.hands ? 'нет' : 'да') + '</td></tr>').join('');
    bindRows((id) => { picked.q = id; drawQ(); });
    const x = qs.find((y) => y.q.id === picked.q);
    form.hidden = false;
    form.innerHTML = '<div class="ad-row"><span class="lbl">Вопрос · ' + esc(nodeLabel(c, x.node.id)) + '</span><span class="ad-sp"></span><a href="#/c/' + esc(draft.id) + '/edit/' + esc(x.node.id) + '">В редакторе</a></div>';
    questionForm(form, x.q, { course: c, onChange: () => { touch(); clearTimeout(form._t); form._t = setTimeout(() => refreshRow(x), 300); } });
  }
  function refreshRow(x) {
    const tr = tbody.querySelector('tr[data-id="' + CSS.escape(x.q.id) + '"]');
    if (tr) { tr.cells[0].textContent = plain(x.q.q) || '(без текста)'; tr.cells[2].innerHTML = '<span class="ad-pill">' + esc(KINDS[x.q.kind] || x.q.kind) + '</span>'; tr.cells[3].textContent = x.q.exam === false || x.hands ? 'нет' : 'да'; }
  }

  // ── словарь ──
  function drawG() {
    page.querySelector('#q-add').onclick = addTerm;
    const keys = Object.keys(c.glossary).sort();
    const uses = usage(c);
    if (!keys.length) { tbody.innerHTML = '<tr><td>Словарь пуст. Термин добавляется кнопкой «+ Термин», в тексте на него ссылаются так: {{ключ}}.</td></tr>'; form.hidden = true; return; }
    if (!picked.g || !c.glossary[picked.g]) picked.g = keys[0];
    thead.innerHTML = '<tr><th>Ключ</th><th>Термин</th><th>English</th><th>Ссылок</th></tr>';
    tbody.innerHTML = keys.map((k) => {
      const t = c.glossary[k], n = (uses[k] || []).length;
      return '<tr data-id="' + esc(k) + '"' + (k === picked.g ? ' class="is-sel"' : '') + ' tabindex="0"><td><code>' + esc(k) + '</code></td><td>' + esc(t.t) + '</td><td>' + esc(t.en || '') + '</td>' +
        '<td>' + n + (n ? '' : ' <span class="ad-pill warn">не используется</span>') + '</td></tr>';
    }).join('');
    bindRows((k) => { picked.g = k; drawG(); });
    const k = picked.g, t = c.glossary[k], where = [...new Set((uses[k] || []).map((id) => nodeLabel(c, id)))];
    form.hidden = false;
    form.innerHTML = '<span class="lbl">Термин</span>' +
      '<div class="ad-f"><label for="g-key">Ключ · для ссылок {{' + esc(k) + '}}</label><input id="g-key" class="mono" value="' + esc(k) + '"></div>' +
      '<div class="ad-grid2"><div class="ad-f"><label for="g-t">По-русски</label><input id="g-t" value="' + esc(t.t) + '"></div>' +
      '<div class="ad-f"><label for="g-en">English</label><input id="g-en" value="' + esc(t.en || '') + '"></div></div>' +
      '<div class="ad-f"><label for="g-d">Определение</label><textarea id="g-d" rows="4">' + esc(t.d || '') + '</textarea></div>' +
      '<p class="ad-small ad-mut">' + (where.length ? 'Используется: ' + esc(where.join('; ')) + '. ' : 'Пока нигде не используется. ') + 'Переименование ключа обновит все ссылки.</p>' +
      '<div class="ad-row"><span class="ad-sp"></span><button type="button" class="btn ad-danger" id="g-del">Удалить термин</button></div>';
    const set = (f, v) => { if (v === '' && f === 'en') delete t.en; else t[f] = v; touch(); };
    form.querySelector('#g-t').addEventListener('input', (e) => { set('t', e.target.value); tbody.querySelector('tr.is-sel').cells[1].textContent = e.target.value; });
    form.querySelector('#g-en').addEventListener('input', (e) => { set('en', e.target.value); tbody.querySelector('tr.is-sel').cells[2].textContent = e.target.value; });
    form.querySelector('#g-d').addEventListener('input', (e) => set('d', e.target.value));
    form.querySelector('#g-key').addEventListener('change', (e) => {
      const nk = e.target.value.trim();
      if (nk === k) return;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(nk) || c.glossary[nk]) { toast(c.glossary[nk] ? 'Такой ключ уже есть' : 'Ключ — латиница, цифры и дефис', 'bad'); e.target.value = k; return; }
      const n = renameTerm(c, k, nk);
      picked.g = nk;
      touch();
      toast('Ключ переименован, ссылок обновлено: ' + n, 'good');
      drawG();
    });
    form.querySelector('#g-del').addEventListener('click', async () => {
      const n = (uses[k] || []).length;
      if (!(await confirmDialog('Удалить термин «' + t.t + '»?', n ? 'На него ссылаются ' + n + ' раз: проверка покажет эти ссылки как ошибки, пока их не уберёшь.' : 'Ссылок на него нет.', 'Удалить', true))) return;
      delete c.glossary[k];
      picked.g = null;
      touch();
      drawG();
    });
  }

  // Новый вопрос встаёт после выбранного, в тот же узел.
  function addQuestion() {
    const x = qs.find((y) => y.q.id === picked.q && !y.hands);
    if (!x) { toast('Выбери вопрос-блок: новый встанет после него. Первый вопрос узла добавляется в редакторе блоком «Вопрос».', 'warn'); return; }
    let lesson = x.node;
    walk(c.root, (n, p) => { if (n === x.node && n.kind === 'part' && p) lesson = p; });
    const q = newBlock('question', c, lesson);
    x.node.blocks.splice(x.node.blocks.indexOf(x.q) + 1, 0, q);
    qs.splice(qs.indexOf(x) + 1, 0, { q, node: x.node });
    picked.q = q.id;
    touch();
    drawQ();
    form.querySelector('textarea').focus();
  }

  function addTerm() {
    let i = 1;
    while (c.glossary['term-' + i]) i++;
    c.glossary['term-' + i] = { t: 'Новый термин', d: '' };
    picked.g = 'term-' + i;
    touch();
    drawG();
    form.querySelector('#g-key').select();
  }

  function bindRows(pick) {
    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => pick(tr.dataset.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tr.dataset.id); } });
    });
  }
}

function plain(html) { return String(html || '').replace(/<[^>]+>/g, '').replace(/\{\{>?([^}|]+)\|([^}]+)\}\}/g, '$2').replace(/\{\{>?([^}]+)\}\}/g, '$1'); }

// Все вопросы курса по порядку: блоки question и вопросы заданий руками.
function allQuestions(c) {
  const out = [];
  walk(c.root, (n) => (n.blocks || []).forEach((b) => {
    if (b.type === 'question') out.push({ q: b, node: n });
    if (b.type === 'hands') (b.check || []).forEach((q) => out.push({ q, node: n, hands: true }));
  }));
  return out;
}

const REF = /\{\{(>?)([^}|]+)(\|[^}]*)?\}\}/g;

// Где используется каждый термин: ключ → id узлов (по разу на ссылку).
function usage(c) {
  const out = {};
  const scan = (v, id) => {
    if (typeof v === 'string') { for (const m of v.matchAll(REF)) if (!m[1]) (out[m[2].trim()] = out[m[2].trim()] || []).push(id); }
    else if (Array.isArray(v)) v.forEach((x) => scan(x, id));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (k !== 'children') scan(v[k], id); });
  };
  walk(c.root, (n) => scan(n, n.id));
  Object.keys(c.glossary).forEach((k) => scan(c.glossary[k].d, 'словарь: ' + k));
  scan([c.about, c.howto], 'паспорт');
  return out;
}

// Переименовывает ключ термина во всех строках курса; возвращает число замен.
function renameTerm(c, from, to) {
  let n = 0;
  const fix = (s) => s.replace(REF, (m, arrow, key, rest) => {
    if (arrow || key.trim() !== from) return m;
    n++;
    return '{{' + to + (rest || '') + '}}';
  });
  const deep = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) { v.forEach((x, i) => { v[i] = deep(x); }); return v; }
    if (v && typeof v === 'object') { Object.keys(v).forEach((k) => { v[k] = deep(v[k]); }); return v; }
    return v;
  };
  c.glossary[to] = c.glossary[from];
  delete c.glossary[from];
  deep(c.root);
  Object.keys(c.glossary).forEach((k) => { c.glossary[k].d = fix(c.glossary[k].d || ''); });
  if (c.about) c.about = fix(c.about);
  if (c.howto) c.howto = c.howto.map(fix);
  return n;
}
