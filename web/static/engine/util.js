// Общие утилиты движка: DOM, иконки, даты, случайность с зерном, копирование.

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// иконки — тонкие линии в цвет текста
export function ic(d, size) {
  return '<svg class="ic" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

export const IC = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  repeat: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  sound: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  term: '<path d="M4 17l6-5-6-5M12 19h8"/>'
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }
export function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function addDays(iso, n) {
  const p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function seeded(seed) { return function () { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Что остановить при уходе со страницы: таймеры анимаций, наблюдатели.
let cleanups = [];
export function onLeave(fn) { cleanups.push(fn); }
export function leave() { cleanups.forEach((f) => f()); cleanups = []; }

// копирование с запасным путём: если буфер обмена недоступен, выделяем текст
export function copyText(text, btn, pre) {
  function done(msg) { btn.setAttribute('data-done', msg); setTimeout(() => btn.removeAttribute('data-done'), 1600); }
  function fallback() {
    if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    done('Выделено');
  }
  try { navigator.clipboard.writeText(text).then(() => done('Скопировано'), fallback); } catch (e) { fallback(); }
}

// шапка блока кода: имя файла, отметка «проверено на …» (если вывод получен запуском), копировать
export function codeHead(file, checked, text) {
  const h = el('div', 'code-h', '<span class="code-f">' + esc(file) + '</span>' +
    (checked ? '<span class="code-v">' + esc(checked) + '</span>' : '') +
    '<button type="button" class="code-cp" aria-label="Скопировать код" title="Скопировать">' + ic(IC.copy, 16) + '</button>');
  const btn = h.querySelector('.code-cp');
  btn.addEventListener('click', () => copyText(text, btn, h.parentNode && h.parentNode.querySelector('pre')));
  return h;
}

export function cmdBlock(text) {
  const row = el('div', 'cmd');
  const pre = el('pre'); pre.appendChild(el('code', null, esc(text)));
  const cp = el('button', 'copy', 'Копировать'); cp.type = 'button';
  cp.addEventListener('click', () => copyText(text, cp, pre));
  row.appendChild(pre); row.appendChild(cp);
  return row;
}

// Элементы, которые читает озвучка: заголовки третьего уровня, абзацы, пункты списков, врезка C#.
const READABLE = 'h3, p, li, .cs-b';
export function readable(node) {
  const out = [];
  if (node.nodeType === 1 && node.matches(READABLE)) out.push(node);
  if (node.querySelectorAll) out.push(...node.querySelectorAll(READABLE));
  return out;
}
