import { walk } from './ui.js';

export function plain(html) { return String(html || '').replace(/<[^>]+>/g, '').replace(/\{\{>?([^}|]+)\|([^}]+)\}\}/g, '$2').replace(/\{\{>?([^}]+)\}\}/g, '$1'); }

// Все вопросы курса по порядку: блоки question и вопросы заданий руками.
export function allQuestions(c) {
  const out = [];
  const parents = new Map(); walk(c.root, (n, p) => parents.set(n, p));
  const lessonOf = (n) => { while (parents.get(n) && n.kind !== 'lesson') n = parents.get(n); return n; };
  walk(c.root, (n) => (n.blocks || []).forEach((b) => {
    if (b.type === 'question') out.push({ q: b, node: n, lesson: lessonOf(n) });
    if (b.type === 'hands') (b.check || []).forEach((q) => out.push({ q, node: n, lesson: lessonOf(n), hands: true }));
  }));
  return out;
}

const REF = /\{\{(>?)([^}|]+)(\|[^}]*)?\}\}/g;

// Где используется каждый термин: ключ → id узлов (по разу на ссылку).
export function usage(c) {
  const out = Object.create(null);
  const scan = (v, id) => {
    if (typeof v === 'string') { for (const m of v.matchAll(REF)) if (!m[1]) (out[m[2].trim()] = out[m[2].trim()] || []).push(id); }
    else if (Array.isArray(v)) v.forEach((x) => scan(x, id));
    else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (k !== 'children') scan(v[k], id); });
  };
  walk(c.root, (n) => scan(n, n.id));
  Object.keys(c.glossary).forEach((k) => scan(c.glossary[k].d, 'словарь: ' + k));
  scan([c.about, c.howto], 'настройки');
  return out;
}

// Переименовывает ключ термина во всех строках курса; возвращает число замен.
export function renameTerm(c, from, to) {
  let n = 0;
  const fix = (s) => s.replace(REF, (m, arrow, key, rest) => {
    if (arrow || key.trim() !== from) return m;
    n++;
    return '{{' + to + (rest || '') + '}}';
  });
  const deep = (v) => {
    if (typeof v === 'string') return fix(v);
    if (Array.isArray(v)) { v.forEach((x, i) => { v[i] = deep(x); }); return v; }
    if (v && typeof v === 'object') { Object.keys(v).forEach((k) => { v[k] = deep(v[k]); }); return v; }
    return v;
  };
  c.glossary[to] = c.glossary[from];
  delete c.glossary[from];
  deep(c.root);
  Object.keys(c.glossary).forEach((k) => { c.glossary[k].d = fix(c.glossary[k].d || ''); });
  if (c.about) c.about = fix(c.about);
  if (c.howto) c.howto = c.howto.map(fix);
  return n;
}
