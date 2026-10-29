// Анимация: сцена из элементов (box, tok, arrow, label, mark). Каждый шаг меняет состояние части
// элементов: x, y, show, cls, t, s. Состояние шага N = начальное + все изменения шагов 0..N,
// поэтому «Назад» работает честно.
import { el, ic, IC, reduceMotion, onLeave } from '../util.js';
import { rich } from '../rich.js';

const SVGNS = 'http://www.w3.org/2000/svg';
let seq = 0;

function svg(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function tokWidth(t) { return 22 + String(t).length * 8.6; }

export const anim = {
  type: 'anim',
  render(a) {
    const uid = 'm' + (++seq);
    const w = el('div', 'widget anim');
    w.innerHTML = '<div class="w-head"><div class="kind">Анимация</div><div class="w-title">' + rich(a.title) + '</div></div>';
    const body = el('div', 'w-body'); w.appendChild(body);
    const wrap = el('div', 'sc-wrap');
    // карточка состояния сбоку: a.side = { title, rows: [[имя, значение, класс]] }, шаг может заменить rows
    let sideBox = null;
    if (a.side) {
      const row = el('div', 'sc-row'); body.appendChild(row);
      row.appendChild(wrap);
      sideBox = el('aside', 'sc-side', '<div class="sc-side-t">' + rich(a.side.title) + '</div><dl></dl>');
      row.appendChild(sideBox);
    } else body.appendChild(wrap);
    const root = svg('svg', { viewBox: '0 0 ' + (a.w || 640) + ' ' + (a.h || 260), role: 'img', 'aria-label': a.title.replace(/<[^>]+>/g, '') });
    const defs = svg('defs', {});
    ['mut', 'hot', 'bad', 'ok'].forEach((c) => {
      const mk = svg('marker', { id: uid + c, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      mk.appendChild(svg('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'mk-' + c }));
      defs.appendChild(mk);
    });
    root.appendChild(defs);
    wrap.appendChild(root);

    const nodes = {};
    a.els.forEach((d) => {
      const g = svg('g', {}), n = { d, g };
      if (d.kind === 'box') {
        g.appendChild(svg('rect', { x: 0, y: 0, width: d.w, height: d.h, rx: 10 }));
        n.t = svg('text', { x: d.w / 2, y: d.s ? 26 : d.h / 2 + 5, 'text-anchor': 'middle', 'class': 't' }); g.appendChild(n.t);
        n.s = svg('text', { x: d.w / 2, y: 48, 'text-anchor': 'middle', 'class': 's' }); g.appendChild(n.s);
      } else if (d.kind === 'tok') {
        n.r = svg('rect', { height: 30, rx: 15, y: -15 }); g.appendChild(n.r);
        n.t = svg('text', { x: 0, y: 5, 'text-anchor': 'middle' }); g.appendChild(n.t);
      } else if (d.kind === 'arrow') {
        const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
        n.len = len;
        n.line = svg('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, 'marker-end': 'url(#' + uid + 'mut)',
          'stroke-dasharray': len, 'stroke-dashoffset': len });
        g.appendChild(n.line);
      } else {
        n.t = svg('text', { x: 0, y: 0, 'text-anchor': d.anchor || 'middle' }); g.appendChild(n.t);
      }
      root.appendChild(g);
      nodes[d.id] = n;
    });

    const cap = el('div', 'sc-cap'); cap.setAttribute('aria-live', 'polite'); body.appendChild(cap);
    const ctl = el('div', 'sc-ctl');
    ctl.innerHTML = '<button class="btn" type="button" data-a="reset" title="С начала" aria-label="С начала">↺</button>' +
      '<button class="btn" type="button" data-a="prev" aria-label="Предыдущий шаг">' + ic(IC.back, 18) + '</button>' +
      '<button class="btn pri" type="button" data-a="play">▶ Пуск</button>' +
      '<button class="btn" type="button" data-a="next" aria-label="Следующий шаг">' + ic(IC.chev, 18) + '</button>' +
      '<span class="sc-bars" aria-hidden="true">' + a.steps.map(() => '<i></i>').join('') + '</span>' +
      '<span class="n"></span>';
    body.appendChild(ctl);
    body.appendChild(el('div', 'sc-hint', 'Стрелки ← → на клавиатуре листают шаги, когда анимация в фокусе.'));

    let i = 0, timer = null;
    const n = a.steps.length;
    function sideAt(k) {
      let rows = a.side.rows;
      for (let j = 0; j <= k; j++) if (a.steps[j].side) rows = a.steps[j].side;
      return rows;
    }
    function stateAt(k) {
      const st = {};
      a.els.forEach((d) => {
        st[d.id] = { x: d.x || 0, y: d.y || 0, show: d.hide ? 0 : 1, cls: d.cls || '', t: d.t || '', s: d.s || '' };
      });
      for (let j = 0; j <= k; j++) {
        const set = a.steps[j].set || {};
        for (const id in set) for (const p in set[id]) st[id][p] = set[id][p];
      }
      return st;
    }
    function setText(node, txt) {
      const lines = String(txt).split('\n');
      if (node.getAttribute('data-v') === txt) return;
      node.setAttribute('data-v', txt);
      node.textContent = '';
      const x = node.getAttribute('x') || 0;
      lines.forEach((ln, k) => {
        const ts = svg('tspan', { x, dy: k ? '1.35em' : 0 });
        ts.textContent = ln;
        node.appendChild(ts);
      });
    }
    function draw() {
      const st = stateAt(i);
      a.els.forEach((d) => {
        const nd = nodes[d.id], s = st[d.id];
        nd.g.setAttribute('class', 'sc-el sc-' + d.kind + (s.cls ? ' ' + s.cls : '') + (s.show ? '' : ' off'));
        if (d.kind !== 'arrow') nd.g.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
        if (d.kind === 'arrow') {
          nd.line.style.strokeDashoffset = s.show ? 0 : nd.len;
          nd.line.setAttribute('marker-end', 'url(#' + uid + (/^(hot|bad|ok)$/.test(s.cls) ? s.cls : 'mut') + ')');
        }
        if (nd.t) setText(nd.t, s.t);
        if (nd.s) setText(nd.s, s.s);
        if (d.kind === 'tok') { const tw = tokWidth(s.t); nd.r.setAttribute('width', tw); nd.r.setAttribute('x', -tw / 2); }
      });
      cap.innerHTML = rich(a.steps[i].cap);
      if (sideBox) {
        sideBox.querySelector('dl').innerHTML = sideAt(i).map((r) =>
          '<dt>' + rich(r[0]) + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + rich(r[1]) + '</dd>').join('');
      }
      [].forEach.call(ctl.querySelectorAll('.sc-bars i'), (b, k) => { b.className = k <= i ? 'on' : ''; });
      ctl.querySelector('.n').textContent = (i + 1) + ' / ' + n;
      ctl.querySelector('[data-a="prev"]').disabled = i === 0;
      ctl.querySelector('[data-a="next"]').disabled = i === n - 1;
      ctl.querySelector('[data-a="play"]').textContent = timer ? '⏸ Пауза' : (i === n - 1 ? '▶ Ещё раз' : '▶ Пуск');
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    onLeave(stop);
    function play() {
      if (i === n - 1) i = 0;
      timer = setInterval(() => {
        if (i < n - 1) { i++; draw(); }
        if (i === n - 1) { stop(); draw(); }
      }, a.speed || 2800);
      draw();
    }
    ctl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const act = b.getAttribute('data-a');
      if (act === 'play') { if (timer) stop(); else play(); draw(); return; }
      stop();
      if (act === 'next') i = Math.min(n - 1, i + 1);
      if (act === 'prev') i = Math.max(0, i - 1);
      if (act === 'reset') i = 0;
      draw();
    });
    // клавиатура: стрелки листают шаги, пока фокус внутри анимации
    w.tabIndex = -1;
    w.addEventListener('click', (e) => { if (!e.target.closest('button, a')) w.focus({ preventScroll: true }); });
    w.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (e.target.closest('input, textarea')) return;
      e.preventDefault(); stop();
      i = e.key === 'ArrowRight' ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
      draw();
    });
    if (reduceMotion) ctl.querySelector('[data-a="play"]').hidden = true;
    draw();
    return w;
  }
};
