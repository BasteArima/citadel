// Формы блоков в редакторе. Простые блоки правятся полями, сложные (таблица, схема, анимация,
// задание руками…) — как JSON с проверкой. Любой блок можно открыть как JSON кнопкой «{ }».
// Типы и названия — из реестра сервера (GET /api/blocks).
import { esc, h, req, walk } from './ui.js';

export const SPECS = {};
export async function loadSpecs() {
  if (Object.keys(SPECS).length) return;
  const r = await req('GET', '/api/blocks');
  (r.data.blocks || []).forEach((s) => { SPECS[s.type] = s; });
}

const JSON_ONLY = ['table', 'scheme', 'steps', 'anim', 'hands', 'embed'];
const CALLOUTS = [['note', 'Заметка'], ['warn', 'Осторожно'], ['cs', 'Из C#']];
const QKINDS = [['choice', 'выбор варианта'], ['text', 'ввод ответа'], ['order', 'порядок']];

// Следующий свободный id вопроса урока: урок.qN (старые id не переиспользуются).
export function nextQuestionId(course, lessonId, letter) {
  let max = 0;
  const re = new RegExp('^' + lessonId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.' + (letter || 'q') + '(\\d+)$');
  walk(course.root, (n) => (n.blocks || []).forEach((b) => {
    const ids = b.type === 'question' ? [b.id] : b.type === 'hands' ? (b.check || []).map((q) => q.id) : [];
    ids.forEach((id) => { const m = re.exec(id || ''); if (m) max = Math.max(max, +m[1]); });
  }));
  return lessonId + '.' + (letter || 'q') + (max + 1);
}

export function newBlock(type, course, lesson) {
  switch (type) {
    case 'heading': return { type, level: 2, text: '' };
    case 'text': return { type, html: '' };
    case 'list': return { type, items: [''] };
    case 'code': return { type, code: '', file: 'main.go' };
    case 'table': return { type, head: ['', ''], rows: [['', '']] };
    case 'callout': return { type, kind: 'note', title: '', html: '' };
    case 'scheme': return { type, title: '', html: '<div class="diagram"></div>', cap: '' };
    case 'steps': return { type, title: '', items: [{ t: '', d: '' }] };
    case 'anim': return { type, title: '', w: 640, h: 240, els: [], steps: [] };
    case 'predict': return { type, file: 'main.go', q: 'Что выведет программа?', code: '', cmd: 'go run main.go', out: '' };
    case 'question': return { type, id: nextQuestionId(course, lesson.id), kind: 'choice', q: '', opts: ['', ''], a: 0, why: '' };
    case 'hands': return { type, title: '', goal: '', steps: [{ t: '', cmd: '', out: '' }], trouble: [], check: [] };
    case 'embed': return { type, src: '' };
    default: return { type };
  }
}

// Карточка блока: шапка (тип, «{ }») и форма. ctx: { course, node, onChange, onReplace(block) }.
export function blockForm(b, ctx) {
  const spec = SPECS[b.type] || { title: b.type };
  const card = h('section', 'ed-blk');
  card.setAttribute('aria-label', 'Блок: ' + spec.title);
  const asJSON = JSON_ONLY.includes(b.type) || !FORMS[b.type];
  card.innerHTML = '<div class="ed-bh"><span class="ed-grip" aria-hidden="true" title="Потяни, чтобы переставить">⋮⋮</span><strong>' + esc(spec.title) + '</strong><code>' + esc(b.type) + sizeNote(b) + '</code><span class="ad-sp"></span>' +
    (asJSON ? '<span class="ad-pill" title="Сложный блок — правится как JSON">JSON</span>' : '<button type="button" class="ad-ib ed-js" aria-label="Править как JSON" title="Править как JSON" aria-pressed="false">{ }</button>') + '</div>' +
    '<div class="ed-bb"></div>';
  const box = card.querySelector('.ed-bb');
  const draw = (json) => {
    box.innerHTML = '';
    if (json) box.appendChild(jsonForm(b, ctx));
    else FORMS[b.type](box, b, ctx);
  };
  draw(asJSON);
  const t = card.querySelector('.ed-js');
  if (t) t.addEventListener('click', () => {
    const on = t.getAttribute('aria-pressed') !== 'true';
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
    card.classList.toggle('json', on);
    if (on) draw(true); else ctx.onReplace(b); // вернуть форму — перерисовать с тем, что получилось в JSON
  });
  return card;
}

function sizeNote(b) {
  if (b.type === 'anim') return ' · ' + (b.steps || []).length + ' шаг.';
  if (b.type === 'hands') return ' · ' + (b.steps || []).length + ' шаг. · ' + (b.check || []).length + ' вопр.';
  if (b.type === 'steps') return ' · ' + (b.items || []).length + ' шаг.';
  if (b.type === 'table') return ' · ' + (b.rows || []).length + ' стр.';
  return '';
}

// JSON-форма: изменения применяются, только когда текст читается и тип блока не потерян.
function jsonForm(b, ctx) {
  const f = h('div', 'ad-f');
  f.innerHTML = '<label>JSON блока</label><textarea class="mono ed-json" rows="' + Math.min(24, JSON.stringify(b, null, 2).split('\n').length + 1) + '" spellcheck="false"></textarea><p class="ad-err" role="alert"></p>';
  const ta = f.querySelector('textarea'), err = f.querySelector('.ad-err');
  ta.value = JSON.stringify(b, null, 2);
  ta.setAttribute('aria-label', 'JSON блока ' + b.type);
  ta.addEventListener('input', () => {
    let v;
    try { v = JSON.parse(ta.value); } catch (e) { err.textContent = 'Не читается: ' + e.message; ta.classList.add('bad'); return; }
    if (!v || typeof v !== 'object' || Array.isArray(v) || !v.type) { err.textContent = 'Нужен объект с полем type'; ta.classList.add('bad'); return; }
    if (!SPECS[v.type]) { err.textContent = 'Неизвестный тип «' + v.type + '»'; ta.classList.add('bad'); return; }
    err.textContent = '';
    ta.classList.remove('bad');
    Object.keys(b).forEach((k) => delete b[k]);
    Object.assign(b, v);
    ctx.onChange();
  });
  return f;
}

// Поля формы: значение пишется в блок сразу; пустое необязательное поле удаляется.
function input(box, b, key, label, opts) {
  opts = opts || {};
  const id = 'f' + Math.random().toString(36).slice(2, 9);
  const f = h('div', 'ad-f' + (opts.wide ? ' ed-wide' : ''));
  const v = opts.get ? opts.get(b) : b[key];
  f.innerHTML = '<label for="' + id + '">' + esc(label) + '</label>' +
    (opts.rows ? '<textarea id="' + id + '" rows="' + opts.rows + '"' + (opts.mono ? ' class="mono" spellcheck="false"' : '') + '></textarea>'
      : '<input id="' + id + '"' + (opts.mono ? ' class="mono"' : '') + (opts.readonly ? ' readonly' : '') + '>');
  const el = f.querySelector('input,textarea');
  el.value = v == null ? '' : v;
  el.addEventListener('input', () => {
    if (opts.set) opts.set(b, el.value);
    else if (el.value === '' && !opts.keep) delete b[key];
    else b[key] = el.value;
    opts.ctx.onChange();
  });
  box.appendChild(f);
  return el;
}

function select(box, b, key, label, options, ctx, after) {
  const id = 'f' + Math.random().toString(36).slice(2, 9);
  const f = h('div', 'ad-f');
  f.innerHTML = '<label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' +
    options.map((o) => '<option value="' + esc(o[0]) + '"' + (String(b[key]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const s = f.querySelector('select');
  s.addEventListener('change', () => { b[key] = typeof options[0][0] === 'number' ? +s.value : s.value; ctx.onChange(); if (after) after(); });
  box.appendChild(f);
}

const lines = (key) => ({ get: (b) => (b[key] || []).join('\n'), set: (b, v) => { b[key] = v.split('\n').filter((s) => s.trim() !== ''); } });
const TEXT_HINT = ' · HTML; термины {{ключ}}, ссылки на узлы {{>id}}';

const FORMS = {
  heading(box, b, ctx) {
    const g = h('div', 'ad-grid'); box.appendChild(g);
    input(g, b, 'text', 'Текст заголовка', { ctx, wide: true, keep: true });
    select(g, b, 'level', 'Уровень', [[2, 'H2 · раздел части'], [3, 'H3 · подзаголовок']], ctx);
  },
  text(box, b, ctx) { input(box, b, 'html', 'Абзац' + TEXT_HINT, { ctx, rows: 4, keep: true }); },
  list(box, b, ctx) {
    input(box, b, 'items', 'Пункты · по одному на строку' + TEXT_HINT, Object.assign({ ctx, rows: 4 }, lines('items')));
    check(box, b, 'ordered', 'Нумерованный список', ctx);
  },
  code(box, b, ctx) {
    const g = h('div', 'ad-grid'); box.appendChild(g);
    input(g, b, 'file', 'Файл', { ctx, mono: true });
    input(g, b, 'cap', 'Подпись', { ctx, wide: true });
    input(box, b, 'code', 'Код', { ctx, rows: Math.max(4, Math.min(20, (b.code || '').split('\n').length + 1)), mono: true, keep: true });
  },
  callout(box, b, ctx) {
    const g = h('div', 'ad-grid'); box.appendChild(g);
    select(g, b, 'kind', 'Вид', CALLOUTS, ctx);
    input(g, b, 'title', 'Заголовок', { ctx, wide: true });
    input(box, b, 'html', 'Текст' + TEXT_HINT, { ctx, rows: 3, keep: true });
  },
  predict(box, b, ctx) {
    const tool = ctx.course.tool || {};
    const g = h('div', 'ad-grid'); box.appendChild(g);
    input(g, b, 'file', 'Файл', { ctx, mono: true });
    input(g, b, 'cmd', 'Команда запуска', { ctx, mono: true });
    input(box, b, 'q', 'Вопрос', { ctx });
    input(box, b, 'code', 'Код', { ctx, rows: Math.max(4, Math.min(24, (b.code || '').split('\n').length + 1)), mono: true, keep: true });
    const out = h('div', 'ed-out');
    out.innerHTML = '<span class="lbl">Вывод</span><span class="ad-small">получи запуском на ' + esc((tool.name || '') + ' ' + (b.go || tool.version || '')) + ' и вставь как есть</span>';
    box.appendChild(out);
    input(box, b, 'out', b.err ? 'Текст ошибки компиляции или паники' : 'Вывод программы', { ctx, rows: Math.max(2, Math.min(12, (b.out || '').split('\n').length + 1)), mono: true, keep: true });
    check(box, b, 'err', 'Программа не компилируется или падает — показать вывод как ошибку', ctx);
    input(box, b, 'after', 'После запуска · объяснение' + TEXT_HINT, { ctx, rows: 2 });
  },
  question(box, b, ctx) { questionForm(box, b, ctx); }
};

function check(box, b, key, label, ctx) {
  const l = h('label', 'ad-check-l', '<input type="checkbox"' + (b[key] ? ' checked' : '') + '> ' + esc(label));
  l.querySelector('input').addEventListener('change', (e) => { if (e.target.checked) b[key] = true; else delete b[key]; ctx.onChange(); });
  box.appendChild(l);
}

// Форма вопроса — общая для блока question и для страницы «Вопросы и словарь».
export function questionForm(box, b, ctx) {
  const g = h('div', 'ad-grid'); box.appendChild(g);
  input(g, b, 'id', 'id · по нему хранится прогресс', { ctx, mono: true, readonly: true });
  select(g, b, 'kind', 'Вид', QKINDS, ctx, () => {
    if (b.kind === 'choice') { b.opts = b.opts && b.opts.length ? b.opts : ['', '']; b.a = typeof b.a === 'number' ? b.a : 0; delete b.items; }
    if (b.kind === 'text') { b.a = Array.isArray(b.a) ? b.a : []; delete b.opts; delete b.items; }
    if (b.kind === 'order') { b.items = b.items && b.items.length ? b.items : ['', '']; delete b.opts; delete b.a; }
    ctx.onChange();
    drawAnswers();
  });
  input(box, b, 'q', 'Текст вопроса' + TEXT_HINT, { ctx, rows: 2, keep: true });
  const ans = h('div', 'ed-ans');
  box.appendChild(ans);
  function drawAnswers() {
    ans.innerHTML = '';
    if (b.kind === 'choice') {
      const name = 'r' + Math.random().toString(36).slice(2, 8);
      ans.innerHTML = '<div class="ad-f"><span class="ed-flabel">Варианты · отметь верный</span><ul class="ed-opts"></ul><button type="button" class="btn ed-addopt">+ Вариант</button></div>';
      const ul = ans.querySelector('ul');
      (b.opts || []).forEach((o, i) => {
        const li = h('li', b.a === i ? 'right' : '');
        li.innerHTML = '<input type="radio" name="' + name + '"' + (b.a === i ? ' checked' : '') + ' aria-label="Вариант ' + (i + 1) + ' верный">' +
          '<input class="ed-opt" aria-label="Вариант ' + (i + 1) + '"><button type="button" class="ad-ib" aria-label="Убрать вариант ' + (i + 1) + '">✕</button>';
        li.querySelector('.ed-opt').value = o;
        li.querySelector('[type=radio]').addEventListener('change', () => { b.a = i; ctx.onChange(); drawAnswers(); });
        li.querySelector('.ed-opt').addEventListener('input', (e) => { b.opts[i] = e.target.value; ctx.onChange(); });
        li.querySelector('button').addEventListener('click', () => {
          b.opts.splice(i, 1);
          if (b.a === i) b.a = 0; else if (b.a > i) b.a--;
          ctx.onChange(); drawAnswers();
        });
        ul.appendChild(li);
      });
      ans.querySelector('.ed-addopt').addEventListener('click', () => { b.opts.push(''); ctx.onChange(); drawAnswers(); ans.querySelector('li:last-child .ed-opt').focus(); });
    } else if (b.kind === 'text') {
      input(ans, b, 'a', 'Верные ответы · по одному на строку, регистр и знаки не важны', Object.assign({ ctx, rows: 3 }, lines('a')));
    } else if (b.kind === 'order') {
      input(ans, b, 'items', 'Пункты в верном порядке · по одному на строку (ученик увидит их вперемешку)', Object.assign({ ctx, rows: 4 }, lines('items')));
    }
  }
  drawAnswers();
  input(box, b, 'why', 'Объяснение после ответа' + TEXT_HINT, { ctx, rows: 2 });
  const ex = h('label', 'ad-check-l', '<input type="checkbox"' + (b.exam === false ? '' : ' checked') + '> Брать в контрольную по разделу');
  ex.querySelector('input').addEventListener('change', (e) => { if (e.target.checked) delete b.exam; else b.exam = false; ctx.onChange(); });
  box.appendChild(ex);
}
