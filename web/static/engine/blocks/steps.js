// «Пошагово»: карточки с кнопками «Назад» и «Далее».
import { el, esc } from '../util.js';
import { rich } from '../rich.js';

export const steps = {
  type: 'steps',
  render(st) {
    const w = el('div', 'widget');
    let i = 0;
    const n = st.items.length;
    w.innerHTML = '<div class="w-head"><div class="kind">Пошагово</div><div class="w-title">' + rich(st.title) + '</div></div>';
    const body = el('div', 'w-body'); w.appendChild(body);
    function draw() {
      const it = st.items[i];
      body.innerHTML = '<div class="w-bars">' + st.items.map((x, k) => '<i' + (k <= i ? ' class="on"' : '') + '></i>').join('') + '</div>' +
        '<div class="w-step-n">Шаг ' + (i + 1) + ' из ' + n + '</div>' +
        '<div class="w-step-t">' + rich(it.t) + '</div>' +
        '<p>' + rich(it.d) + '</p>' +
        (it.code ? '<pre><code>' + esc(it.code) + '</code></pre>' : '') +
        '<div class="w-nav"><button class="btn" type="button" data-d="-1"' + (i === 0 ? ' disabled' : '') + '>← Назад</button>' +
        '<button class="btn pri" type="button" data-d="1"' + (i === n - 1 ? ' disabled' : '') + '>Далее →</button></div>';
    }
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      i = Math.max(0, Math.min(n - 1, i + (+b.getAttribute('data-d'))));
      draw();
    });
    draw();
    return w;
  }
};
