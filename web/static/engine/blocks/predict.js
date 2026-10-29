// «Предскажи и запусти»: код с номерами строк, поле прогноза, кнопка показывает
// вывод, заранее полученный запуском. Сначала прогноз, потом ответ — как в практикуме.
import { el, esc, ic, IC, codeHead } from '../util.js';
import { rich } from '../rich.js';

let seq = 0;

export const predict = {
  type: 'predict',
  render(p, ctx) {
    const w = el('section', 'pr');
    w.setAttribute('aria-label', 'Предскажи и запусти');
    w.appendChild(codeHead(p.file || 'main.go', 'проверено на ' + ctx.tool.name + ' ' + (p.go || ctx.tool.version), p.code));
    const lines = p.code.split('\n');
    const body = el('div', 'pr-code');
    const gut = el('pre', 'pr-gut', lines.map((x, i) => i + 1).join('\n'));
    gut.setAttribute('aria-hidden', 'true');
    const pre = el('pre', 'pr-src'); pre.appendChild(el('code', null, esc(p.code)));
    body.appendChild(gut); body.appendChild(pre);
    w.appendChild(body);
    const id = 'pr' + (++seq);
    const ask = el('div', 'pr-ask',
      '<label for="' + id + '">' + rich(p.q || 'Что выведет программа?') + '</label>' +
      '<div class="pr-row"><input id="' + id + '" type="text" autocomplete="off" placeholder="Твой прогноз">' +
      '<button type="button" class="btn pri">Запустить</button></div>');
    w.appendChild(ask);
    const res = el('div', 'pr-out');
    res.setAttribute('role', 'status');
    res.hidden = true;
    res.innerHTML = '<div class="pr-cmd">' + ic(IC.term, 14) + '<span>' + esc(p.cmd || 'go run .') + '</span></div>' +
      '<pre class="' + (p.err ? 'err' : '') + '"><code>' + esc(p.out) + '</code></pre>' +
      (p.after ? '<p class="pr-after">' + rich(p.after) + '</p>' : '');
    w.appendChild(res);
    const inp = ask.querySelector('input'), go = ask.querySelector('button');
    function run() {
      res.hidden = false;
      go.textContent = 'Запущено';
      go.disabled = true;
      const g = inp.value.trim();
      if (g && !res.querySelector('.pr-guess')) res.insertBefore(el('div', 'pr-guess', 'Твой прогноз: «' + esc(g) + '»'), res.firstChild);
    }
    go.addEventListener('click', run);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    return w;
  }
};
