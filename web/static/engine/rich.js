// Текст курса: простой HTML плюс ссылки
// {{ключ}} и {{ключ|текст}} — термин из словаря; {{>id}} и {{>id|текст}} — ссылка на урок.
import { esc } from './util.js';
import { sanitize } from './sanitize.js';

let idx = null;
let used = null;

export function initRich(courseIndex) { idx = courseIndex; }

// Собрать термины, которые встретились на странице: начать перед отрисовкой, забрать после.
export function trackTerms() { used = {}; }
export function takeTerms() { const keys = used ? Object.keys(used) : []; used = null; return keys; }

export function rich(html) {
  return sanitize(String(html ?? '').replace(/\{\{>([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, (m, id, txt) => {
    const l = idx?.meta(id);
    if (!l) return txt || id;
    const name = 'урок ' + l.n + ' «' + esc(l.t) + '»';
    if (!idx.ready(id)) return (txt ? txt + ' — ' : '') + name + ' (скоро)';
    return '<a class="xref" href="#' + id + '">' + (txt ? txt + ' → ' : '') + name + '</a>';
  }).replace(/\{\{([a-z0-9-]+)(?:\|([^}]+))?\}\}/g, (m, k, txt) => {
    const g = idx?.course.glossary[k];
    if (!g) return txt || k;
    if (used) used[k] = 1;
    return '<button type="button" class="term" data-k="' + k + '">' + (txt || g.t) + '</button>';
  }));
}
