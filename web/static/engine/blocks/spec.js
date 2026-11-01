// ТЗ шага проекта (решение 0016). Ученик видит его на странице проекта (static/site/project.js),
// здесь — только превью для редактора: всё содержимое одним столбцом, подсказки открыты.
import { el, esc } from '../util.js';
import { rich } from '../rich.js';

export const spec = {
  type: 'spec',
  render(b) {
    const w = el('div', 'widget');
    w.innerHTML = '<div class="w-head"><div class="kind">' + (b.kind === 'incident' ? 'Инцидент' : 'Задача от техлида') + '</div></div>';
    const body = el('div', 'w-body'); w.appendChild(body);
    body.appendChild(el('p', null, rich(b.task || '')));
    const list = (title, items) => {
      if (!items || !items.length) return;
      body.appendChild(el('div', 'kind', title));
      body.appendChild(el('ul', null, items.map((t) => '<li>' + rich(t) + '</li>').join('')));
    };
    list('Что построить', b.build);
    list('Контракт API', (b.api || []).map((a) => a.req + ' → ' + a.res));
    list('Файлы', b.files);
    list('Что искать', (b.search || []).map(esc));
    (b.hints || []).forEach((h, i) => {
      body.appendChild(el('div', 'kind', 'Подсказка ' + (i + 1) + '. ' + esc(h.title)));
      body.appendChild(el('p', null, rich(h.text || '')));
      if (h.code) { const pre = el('pre'); pre.appendChild(el('code', null, esc(h.code))); body.appendChild(pre); }
    });
    list('Готово, когда', b.done);
    list('Подводные камни', b.traps);
    list('Чего не делаем', b.skip);
    list('Защита', (b.viva || []).map((q) => q.q + ' — ' + q.a));
    return w;
  }
};
