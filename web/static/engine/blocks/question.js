// Вопрос: выбор варианта, ввод ответа или порядок карточек.
// Засчитывается первая попытка (решение 0008): после первого ответа вопрос закрыт — видно,
// верно ли, верный ответ и объяснение. Ошибка первой попытки уходит в повторения.
import { el, hash, seeded, shuffle } from '../util.js';
import { rich } from '../rich.js';

function normalize(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"'`]/g, '').replace(/\s+/g, ' ').trim(); }

// Верный ответ словами — для объяснения после ошибки и для карточки повторения.
export function rightAnswer(q) {
  if (q.kind === 'choice') return q.opts[q.a];
  if (q.kind === 'text') return q.a[0];
  if (q.kind === 'order') return q.items.map((t, i) => (i + 1) + '. ' + t).join('<br>');
  return '';
}

// store: { state(): 0 — не отвечен, 1 — первая попытка верна, 2 — первая попытка с ошибкой;
//          answer(correct): записать первую попытку }. onAnswer — после первой попытки.
export function renderQuestion(q, label, store, onAnswer) {
  const box = el('div', 'q');
  const head = el('div', 'q-n', '<span>' + label + '</span>');
  box.appendChild(head);
  box.appendChild(el('div', 'q-t', rich(q.q)));
  let whyBox = null;

  function showWhy(ok) {
    if (!whyBox) { whyBox = el('div', 'why'); box.appendChild(whyBox); }
    whyBox.className = 'why ' + (ok ? 'ok' : 'no');
    whyBox.innerHTML = '<b>' + (ok ? 'Верно' : 'Не совсем') + '</b>' +
      (ok ? '' : '<p class="why-right">Верный ответ: ' + rich(rightAnswer(q)) + '</p>') + rich(q.why || '') +
      (ok ? '' : '<p class="why-note">Первая попытка учтена: вопрос засчитан и вернётся в повторениях.</p>');
  }
  function markDone(state) {
    box.classList.add('solved');
    if (state === 2) box.classList.add('missed');
    if (!head.querySelector('.st')) head.appendChild(el('span', 'st', state === 1 ? '· верно с первой попытки' : '· засчитано, с ошибкой'));
  }
  function first(correct) {
    if (store.state()) return;
    store.answer(correct);
    markDone(correct ? 1 : 2);
    showWhy(correct);
    if (onAnswer) onAnswer(correct);
  }

  if (q.kind === 'choice') {
    const opts = el('div', 'opts');
    const lock = () => [].forEach.call(opts.children, (x) => { x.disabled = true; });
    q.opts.forEach((o, i) => {
      const b = el('button', 'opt', '<span class="opt-n">' + (i + 1) + '</span><span class="opt-t">' + rich(o) + '</span>');
      b.type = 'button';
      b.setAttribute('data-n', i + 1);
      b.addEventListener('click', (e) => {
        if (e.target.closest('.term') || store.state()) return;
        b.classList.add(i === q.a ? 'right' : 'wrong');
        opts.children[q.a].classList.add('right');
        lock();
        first(i === q.a);
      });
      opts.appendChild(b);
    });
    box.appendChild(opts);
    if (store.state()) { opts.children[q.a].classList.add('right'); lock(); markDone(store.state()); showWhy(store.state() === 1); }
  } else if (q.kind === 'text') {
    const row = el('div', 'txt-row');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Ответ';
    inp.setAttribute('aria-label', 'Ответ');
    const go = el('button', 'btn pri', 'Ответить'); go.type = 'button';
    const lock = () => { inp.disabled = true; go.disabled = true; };
    const check = () => {
      const v = normalize(inp.value);
      if (!v || store.state()) return;
      lock();
      first(q.a.some((a) => normalize(a) === v));
    };
    go.addEventListener('click', check);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    row.appendChild(inp); row.appendChild(go); box.appendChild(row);
    if (store.state()) { inp.value = q.a[0]; lock(); markDone(store.state()); showWhy(store.state() === 1); }
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
        b.disabled = !!store.state();
        b.addEventListener('click', () => { picked.push(i); draw(); });
        poolEl.appendChild(b);
      });
      picked.forEach((i, k) => {
        const b = el('button', 'card-btn picked', (k + 1) + '. ' + rich(q.items[i])); b.type = 'button';
        b.addEventListener('click', () => { if (!store.state()) { picked.splice(k, 1); draw(); } });
        pickEl.appendChild(b);
      });
      if (!picked.length) pickEl.appendChild(el('span', 'card-btn slot', 'пока пусто'));
      chk.disabled = picked.length !== q.items.length || !!store.state();
      rst.disabled = !!store.state();
    };
    chk.addEventListener('click', () => {
      if (store.state()) return;
      const ok = picked.every((v, i) => v === i);
      first(ok);
      draw();
    });
    rst.addEventListener('click', () => { picked = []; draw(); });
    if (store.state()) { picked = q.items.map((t, i) => i); markDone(store.state()); showWhy(store.state() === 1); }
    draw();
  }
  return box;
}

export const question = {
  type: 'question',
  render: (b, ctx) => renderQuestion(b, ctx.label, ctx.store, ctx.onSolve),
  questions: (b) => [b]
};
