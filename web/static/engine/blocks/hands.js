// «Сделай руками»: шаги с командами и ожидаемым выводом, «Если не получается»,
// вопросы «Проверь, что понял». Задание засчитывается, когда на них дан верный ответ.
import { el, esc, cmdBlock } from '../util.js';
import { rich } from '../rich.js';
import { renderQuestion } from './question.js';

export const hands = {
  type: 'hands',
  render(hd, ctx) {
    const w = el('div', 'widget hands');
    w.innerHTML = '<div class="w-head"><div class="kind">Сделай руками</div><div class="w-title">' + rich(hd.title) + '</div></div>';
    const body = el('div', 'w-body'); w.appendChild(body);
    body.appendChild(el('p', null, rich(hd.goal)));
    const ol = el('ol', 'hs');
    hd.steps.forEach((s) => {
      const li = el('li');
      li.appendChild(el('div', 'hs-t', rich(s.t)));
      if (s.d) li.appendChild(el('p', null, rich(s.d)));
      if (s.cmd) li.appendChild(cmdBlock(s.cmd));
      if (s.code) { const pre = el('pre'); pre.appendChild(el('code', null, esc(s.code))); li.appendChild(pre); }
      if (s.out) {
        li.appendChild(el('div', 'out-l', 'Что должно получиться'));
        const o = el('pre', 'out'); o.appendChild(el('code', null, esc(s.out))); li.appendChild(o);
      }
      if (s.after) li.appendChild(el('p', null, rich(s.after)));
      ol.appendChild(li);
    });
    body.appendChild(ol);
    if (hd.trouble) {
      body.appendChild(el('div', 'trouble', '<div class="kind">Если не получается</div><ul>' +
        hd.trouble.map((t) => '<li>' + rich(t) + '</li>').join('') + '</ul>'));
    }
    if (hd.check) {
      body.appendChild(el('div', 'qs-head', '<div class="kind">Проверь, что понял</div><p>Отвечай по тому, что увидел у себя. Задание засчитывается, когда на все вопросы дан верный ответ.</p>'));
      hd.check.forEach((q, i) => {
        body.appendChild(renderQuestion(q, 'Вопрос ' + (i + 1) + ' из ' + hd.check.length, ctx.store(q), ctx.onChange));
      });
    }
    return w;
  },
  questions: (b) => b.check || []
};
