import { esc, h, toast } from './ui.js';
import { draft, touch } from './draft.js';
import { questionForm, blockForm, loadSpecs, newBlock } from './blocks.js';
import { allQuestions, plain } from './reference.js';
import { renderQuestion } from '../engine/blocks/question.js';
import { initRich } from '../engine/rich.js';
import { indexCourse } from '../engine/course.js';

import { referenceLayout, listKeys } from './reference-layout.js';

const KINDS = { choice: 'выбор', text: 'ввод', order: 'порядок' };
export function questionProblems(q) {
  const out = [];
  if (!plain(q.why).trim()) out.push('why');
  if (!plain(q.q).trim()) out.push('text');
  if (q.kind === 'choice' ? !Array.isArray(q.opts) || q.opts.length < 2 || q.opts.some((x) => !plain(x).trim()) || !Number.isInteger(q.a) || q.a < 0 || q.a >= q.opts.length :
    q.kind === 'text' ? !Array.isArray(q.a) || !q.a.length || q.a.some((x) => !plain(x).trim()) :
      q.kind === 'order' ? !Array.isArray(q.items) || q.items.length < 2 || q.items.some((x) => !plain(x).trim()) : true) out.push('answer');
  if (!q.id) out.push('id');
  return out;
}
const FILTERS = [['', 'Все'], ['why', 'Без объяснения'], ['answer', 'Без ответа или вариантов'], ['text', 'Без текста'], ['id', 'Без id']];

export function renderQuestions(main, courseBar) {
  const { off } = courseBar(main), c = draft.course, qs = allQuestions(c), collapsed = new Set();
  const page = h('div', 'ad-page'); main.append(page);
  const lessons = [...new Set(qs.map((x) => x.lesson))];
  const lessonTitle = (l) => (l.kind === 'lesson' ? 'Урок ' + (l.n || '?') + '. ' : '') + l.title;
  page.innerHTML = '<div class="ad-head"><div><h1>Вопросы</h1><p class="ad-sub">Вопросы по урокам, включая проверку заданий руками.</p></div><button type="button" class="btn pri" data-add>+ Вопрос</button></div>' +
    '<div class="ad-filters"><label class="ad-f">Поиск<input type="search" placeholder="Текст вопроса"></label><label class="ad-f">Урок<select><option value="">Все уроки</option>' + lessons.map((l) => '<option value="' + esc(l.id) + '">' + esc(lessonTitle(l)) + '</option>').join('') + '</select></label></div>' +
    '<div class="ad-question-filters" role="group" aria-label="Проблемы вопросов">' + FILTERS.map(([key, label]) => '<button type="button" class="chip" data-filter="' + key + '" aria-pressed="' + (key === '') + '">' + label + '</button>').join('') + '</div><p class="ad-sub" data-count role="status"></p><div class="ad-question-list"></div>';
  const list = page.querySelector('.ad-question-list'), search = page.querySelector('input'), select = page.querySelector('select');
  const pane = referenceLayout(page, 'Вопрос');
  let filter = '', active = null, timer;
  const visible = () => qs.filter((x) => (!select.value || x.lesson.id === select.value) && plain(x.q.q).toLocaleLowerCase('ru').includes(search.value.toLocaleLowerCase('ru')) && (!filter || questionProblems(x.q).includes(filter)));
  function draw() {
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    const shown = visible(); page.querySelector('[data-count]').textContent = 'Показано: ' + shown.length + ' из ' + qs.length;
    list.innerHTML = lessons.map((lesson) => {
      const rows = shown.filter((x) => x.lesson === lesson); if (!rows.length) return '';
      return '<details class="ad-card ad-q-group" data-lesson="' + esc(lesson.id) + '"' + (collapsed.has(lesson.id) ? '' : ' open') + '><summary>' + esc(lessonTitle(lesson)) + ' · ' + rows.length + ' вопросов</summary>' + rows.map((x) => {
        const problems = questionProblems(x.q);
        return '<button type="button" class="ad-q-row' + (x === active ? ' is-sel' : '') + '" data-index="' + qs.indexOf(x) + '"><span class="ad-q-text">' + esc(plain(x.q.q) || '(без текста)') + '</span><span class="ad-pill">' + esc(KINDS[x.q.kind] || x.q.kind || '?') + '</span><span class="ad-small ad-mut">' + esc(x.node.title) + (x.hands ? ' · руками' : '') + '</span><span class="ad-q-problems">' + problems.map((key) => '<span class="ad-pill warn" title="' + FILTERS.find((f) => f[0] === key)[1] + '" aria-label="' + FILTERS.find((f) => f[0] === key)[1] + '">!</span>').join('') + '</span></button>';
      }).join('') + '</details>';
    }).join('') || '<p class="ad-mut">Вопросов не найдено. Первый вопрос добавь блоком в редакторе урока.</p>';
    list.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => { if (d.open) collapsed.delete(d.dataset.lesson); else collapsed.add(d.dataset.lesson); }));
    list.querySelectorAll('[data-index]').forEach((b) => b.addEventListener('click', () => { open(qs[Number(b.dataset.index)]); pane.activate(); }));
    if (focused != null) list.querySelector('[data-index="' + focused + '"]')?.focus();
  }
  function open(x) {
    active = x;

    const form = pane.body; form.replaceChildren();
    pane.header.querySelector('[data-editor-link]')?.remove();
    const nav = h('a', 'btn', 'Открыть в редакторе'); nav.href = '#/c/' + encodeURIComponent(c.id) + '/edit/' + encodeURIComponent(x.node.id); nav.setAttribute('data-editor-link', '');
    pane.header.append(nav);
    const fields = h('div', 'ad-form ad-reference-fields'), aside = h('aside', 'ad-card ad-pad ad-form ad-reference-aside', '<h3>Как увидит ученик</h3>'), preview = h('div', 'ad-question-preview');
    aside.append(preview); form.append(fields, aside);
    const render = () => {
      preview.replaceChildren(); initRich(indexCourse(c)); let answer = 0;
      try { preview.append(renderQuestion(x.q, 'Вопрос', { state: () => answer, answer(ok) { answer = ok ? 1 : 2; } })); }
      catch (e) { preview.textContent = 'Исправь поля вопроса: ' + e.message; }
    };
    const changed = () => { touch(); clearTimeout(timer); timer = setTimeout(() => { draw(); render(); }, 300); };
    const ctx = { course: c, node: x.node, onChange: changed, onReplace: () => { changed(); open(x); } };
    if (x.hands) questionForm(fields, x.q, ctx); else fields.append(blockForm(x.q, ctx));
    render(); draw();
  }
  const filterChanged = () => { const first = visible()[0]; if (first) open(first); else { active = null; pane.body.textContent = 'Вопросов не найдено'; draw(); } };
  listKeys(list, (button) => { const index = Number(button.dataset.index); open(qs[index]); list.querySelector('[data-index="' + index + '"]')?.focus(); });
  search.addEventListener('input', filterChanged); select.addEventListener('change', filterChanged);
  page.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter; page.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); filterChanged();
  }));
  page.querySelector('[data-add]').addEventListener('click', () => {
    const x = active || visible().find((x) => !x.hands);
    if (!x || x.hands) { toast('Первый вопрос узла добавляется в редакторе блоком «Вопрос».', 'warn'); return; }
    const q = newBlock('question', c, x.lesson), item = { q, node: x.node, lesson: x.lesson };
    x.node.blocks.splice(x.node.blocks.indexOf(x.q) + 1, 0, q); qs.splice(qs.indexOf(x) + 1, 0, item); filter = ''; search.value = ''; select.value = '';
    page.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === '')));
    touch(); open(item); pane.activate();
  });
  loadSpecs().then(() => { if (page.isConnected) filterChanged(); });
  return () => { off(); pane.destroy(); clearTimeout(timer); };
}
