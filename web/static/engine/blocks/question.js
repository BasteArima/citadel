// Вопрос: выбор варианта, ввод ответа или порядок карточек.
// Вопрос засчитывается после верного ответа; объяснение показывается и при верном, и при неверном.
import { el, hash, seeded, shuffle } from '../util.js';
import { rich } from '../rich.js';

function normalize(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"'`]/g, '').replace(/\s+/g, ' ').trim(); }

// store: { solved(): bool, solve(): void }
export function renderQuestion(q, label, store, onSolve) {
  const box = el('div', 'q');
  const head = el('div', 'q-n', '<span>' + label + '</span>');
  box.appendChild(head);
  box.appendChild(el('div', 'q-t', rich(q.q)));
  let whyBox = null;

  function markSolved() {
    box.classList.add('solved');
    if (!head.querySelector('.st')) head.appendChild(el('span', 'st', '· засчитано'));
  }
  function showWhy(ok) {
    if (!whyBox) { whyBox = el('div', 'why'); box.appendChild(whyBox); }
    whyBox.className = 'why ' + (ok ? 'ok' : 'no');
    whyBox.innerHTML = '<b>' + (ok ? 'Верно' : 'Не совсем') + '</b>' + rich(q.why || '');
  }
  function win() {
    if (!store.solved()) { store.solve(); if (onSolve) onSolve(); }
    markSolved();
  }

  if (q.kind === 'choice') {
    const opts = el('div', 'opts');
    q.opts.forEach((o, i) => {
      const b = el('button', 'opt', '<span class="opt-n">' + (i + 1) + '</span><span class="opt-t">' + rich(o) + '</span>');
      b.type = 'button';
      b.setAttribute('data-n', i + 1);
      b.addEventListener('click', (e) => {
        if (e.target.closest('.term')) return;
        if (i === q.a) {
          b.classList.add('right');
          [].forEach.call(opts.children, (x) => { x.disabled = true; });
          showWhy(true); win();
        } else {
          b.classList.add('wrong'); showWhy(false);
        }
      });
      opts.appendChild(b);
    });
    box.appendChild(opts);
    if (store.solved()) {
      opts.children[q.a].classList.add('right');
      [].forEach.call(opts.children, (x) => { x.disabled = true; });
      showWhy(true); markSolved();
    }
  } else if (q.kind === 'text') {
    const row = el('div', 'txt-row');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Ответ';
    inp.setAttribute('aria-label', 'Ответ');
    const go = el('button', 'btn pri', 'Ответить'); go.type = 'button';
    const check = () => {
      const v = normalize(inp.value);
      if (!v) return;
      const ok = q.a.some((a) => normalize(a) === v);
      showWhy(ok);
      if (ok) { inp.disabled = true; go.disabled = true; win(); }
    };
    go.addEventListener('click', check);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    row.appendChild(inp); row.appendChild(go); box.appendChild(row);
    if (store.solved()) { inp.value = q.a[0]; inp.disabled = true; go.disabled = true; showWhy(true); markSolved(); }
  } else if (q.kind === 'order') {
    const rnd = seeded(hash(q.q));
    const pool = shuffle(q.items.map((t, i) => i), rnd);
    if (pool.every((v, i) => v === i)) pool.reverse();
    let picked = [];
    box.appendChild(el('div', 'cards-l', 'Нажимай на карточки в правильном порядке:'));
    const poolEl = el('div', 'cards'); box.appendChild(poolEl);
    box.appendChild(el('div', 'cards-l', 'Твой порядок (нажми на карточку, чтобы вернуть её):'));
    const pickEl = el('div', 'cards'); box.appendChild(pickEl);
    const row2 = el('div', 'txt-row');
    const chk = el('button', 'btn pri', 'Проверить'); chk.type = 'button';
    const rst = el('button', 'btn', 'Сбросить'); rst.type = 'button';
    row2.appendChild(chk); row2.appendChild(rst); box.appendChild(row2);
    const draw = () => {
      poolEl.innerHTML = ''; pickEl.innerHTML = '';
      pool.forEach((i) => {
        if (picked.indexOf(i) >= 0) return;
        const b = el('button', 'card-btn', rich(q.items[i])); b.type = 'button';
        b.addEventListener('click', () => { picked.push(i); draw(); });
        poolEl.appendChild(b);
      });
      picked.forEach((i, k) => {
        const b = el('button', 'card-btn picked', (k + 1) + '. ' + rich(q.items[i])); b.type = 'button';
        b.addEventListener('click', () => { if (!store.solved()) { picked.splice(k, 1); draw(); } });
        pickEl.appendChild(b);
      });
      if (!picked.length) pickEl.appendChild(el('span', 'card-btn slot', 'пока пусто'));
      chk.disabled = picked.length !== q.items.length || store.solved();
    };
    chk.addEventListener('click', () => {
      const ok = picked.every((v, i) => v === i);
      showWhy(ok);
      if (ok) { rst.disabled = true; win(); draw(); }
    });
    rst.addEventListener('click', () => { picked = []; if (whyBox) { whyBox.remove(); whyBox = null; } draw(); });
    if (store.solved()) { picked = q.items.map((t, i) => i); rst.disabled = true; showWhy(true); markSolved(); }
    draw();
  }
  return box;
}

export const question = {
  type: 'question',
  render: (b, ctx) => renderQuestion(b, ctx.label, ctx.store, ctx.onSolve),
  questions: (b) => [b]
};
