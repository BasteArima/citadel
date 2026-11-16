import { esc, h, toast, nodeLabel, confirmDialog, drawer, walk } from './ui.js';
import { draft, touch } from './draft.js';
import { plain, usage, renameTerm } from './reference.js';

export function renderGlossary(main, courseBar) {
  const { off } = courseBar(main), c = draft.course; c.glossary ||= {};
  const page = h('div', 'ad-page'); main.append(page);
  page.innerHTML = '<div class="ad-head"><div><h1>Словарь</h1><p class="ad-sub">Термины и ссылки на них в курсе.</p></div><button type="button" class="btn pri" data-add>+ Термин</button></div><label class="ad-f">Поиск<input type="search" placeholder="Термин или определение"></label><div class="ad-term-list"></div>';
  const list = page.querySelector('.ad-term-list'), search = page.querySelector('input');
  let pane = null, picked = null;
  function draw() {
    const uses = usage(c), q = search.value.toLocaleLowerCase('ru');
    list.innerHTML = Object.keys(c.glossary).sort().filter((k) => (k + ' ' + Object.values(c.glossary[k]).join(' ')).toLocaleLowerCase('ru').includes(q)).map((k) => {
      const t = c.glossary[k];
      return '<button type="button" class="ad-card ad-term-row" data-key="' + esc(k) + '"><strong>' + esc(t.t) + '</strong><span class="ad-q-text ad-mut">' + esc(plain(t.d)) + '</span><span class="ad-small">используется ' + (uses[k] || []).length + ' раз</span></button>';
    }).join('') || '<p class="ad-mut">Терминов не найдено. Ссылка на термин: {{ключ}}.</p>';
    list.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => open(b.dataset.key)));
  }
  function open(k) {
    picked = k; const t = c.glossary[k], uses = usage(c)[k] || [];
    if (!pane || !pane.panel.isConnected) {
      pane = drawer('Термин');
      pane.panel.addEventListener('close', () => { [...list.children].find((b) => b.dataset.key === picked)?.focus(); });
    }
    const form = pane.body;
    form.innerHTML = '<label class="ad-f">Ключ · для ссылок {{' + esc(k) + '}}<input data-field="key" value="' + esc(k) + '"></label>' +
      '<label class="ad-f">По-русски<input data-field="t" value="' + esc(t.t) + '"></label><label class="ad-f">English<input data-field="en" value="' + esc(t.en || '') + '"></label>' +
      '<label class="ad-f">Определение<textarea data-field="d" rows="6">' + esc(t.d || '') + '</textarea></label><p class="ad-small ad-mut">Переименование ключа обновит все ссылки.</p><h3>Используется ' + uses.length + ' раз</h3><ul class="ad-term-uses"></ul><button type="button" class="btn ad-danger" data-delete>Удалить термин</button>';
    const nodes = new Set(); walk(c.root, (n) => nodes.add(n.id));
    const places = form.querySelector('ul');
    [...new Set(uses)].forEach((id) => {
      const li = h('li');
      const view = nodes.has(id) ? 'edit/' + encodeURIComponent(id) : id === 'паспорт' ? 'passport' : 'glossary';
      li.innerHTML = '<a href="#/c/' + encodeURIComponent(c.id) + '/' + view + '">' + esc(nodes.has(id) ? nodeLabel(c, id) : id) + '</a>'; places.append(li);
    });
    if (!uses.length) places.append(h('li', 'ad-mut', 'Пока нигде не используется.'));
    form.querySelectorAll('[data-field]:not([data-field=key])').forEach((input) => input.addEventListener('input', () => { t[input.dataset.field] = input.value; touch(); draw(); }));
    form.querySelector('[data-field=key]').addEventListener('change', (e) => {
      const nk = e.target.value.trim(); if (nk === k) return;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(nk) || Object.hasOwn(c.glossary, nk)) { toast('Ключ занят или содержит недопустимые символы', 'bad'); e.target.value = k; return; }
      const count = renameTerm(c, k, nk); touch(); toast('Ключ переименован, ссылок обновлено: ' + count, 'good'); draw(); open(nk);
    });
    form.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить термин «' + t.t + '»?', 'Сломается ссылок: ' + uses.length + '. Проверка покажет их как ошибки, пока их не уберёшь.', 'Удалить', true))) return;
      delete c.glossary[k]; touch(); pane.close(); draw(); search.focus();
    });
  }
  search.addEventListener('input', draw);
  page.querySelector('[data-add]').addEventListener('click', () => {
    let i = 1; while (Object.hasOwn(c.glossary, 'term-' + i)) i++;
    const k = 'term-' + i; c.glossary[k] = { t: 'Новый термин', d: '' }; search.value = ''; touch(); draw(); open(k); pane.body.querySelector('input').select();
  });
  draw(); return () => { off(); pane?.close(); };
}
