// Общая структура плиток курса и проекта.
import { esc, plural, linkIcon, metalName, courseState } from './shared.js';

export function authorContext(courses, user) {
  return { multiple: new Set(courses.map((c) => c.author || '')).size > 1, name: user.name };
}

export function tileMeta(c, context, project = false) {
  const st = courseState(c), tool = [c.tool.name, c.tool.version].filter(Boolean).join(' ');
  const count = c.lessons + ' ' + (project ? plural(c.lessons, 'шаг', 'шага', 'шагов') : plural(c.lessons, 'урок', 'урока', 'уроков'));
  const author = context?.multiple && c.author && c.author !== context.name ? ' · автор ' + c.author : '';
  return '<div class="tile-meta"><span class="tile-link" title="Звено: ' + esc(metalName(c.metal)) + '">' +
    linkIcon(c.metal, st === 'done' ? 1 : c.lessons ? c.done / c.lessons : 0, 32) + '</span><span>' +
    esc((tool ? tool + ' · ' : '') + count + (c.ready < c.lessons ? ' · готово ' + c.ready : '') + author + (c.onlyYours ? ' · только у тебя' : '')) + '</span></div>';
}

export function tileFooter(c, project = false) {
  const st = courseState(c), pct = c.lessons ? Math.min(100, Math.round(c.done / c.lessons * 100)) : 0;
  const href = (project ? '/p/' : '/c/') + encodeURIComponent(c.id) + '/';
  const label = project ? (st === 'done' ? 'Открыть' : 'Открыть ТЗ') : st === 'done' ? 'Открыть' : c.started ? 'Продолжить' : 'Начать';
  const target = st !== 'done' && c.next ? href + '#' + encodeURIComponent(c.next.id) : href;
  return '<footer class="tile-footer"><div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + (project ? 'Прогресс проекта' : 'Прогресс курса') + '"><i style="width:' + pct + '%"></i></div>' +
    '<div class="tile-actions"><a class="btn btn-l pri" href="' + target + '">' + label + '</a><span>' + (st === 'done' ? 'пройден' : st === 'new' ? 'не начат' : pct + '%') + '</span></div></footer>';
}

export function courseTile(c, byId, context) {
  const needs = (c.requires || []).map((id) => byId[id]?.title || id).join(', ');
  return '<article class="card tile metal-' + esc(c.metal) + '">' + tileMeta(c, context) +
    '<h3><a href="/c/' + encodeURIComponent(c.id) + '/">' + esc(c.title) + '</a></h3>' +
    '<p class="tile-subtitle" title="' + esc(c.subtitle || '') + '">' + esc(c.subtitle || '') + '</p>' +
    (needs ? '<p class="tile-requires" title="' + esc('Опирается на: ' + needs) + '">Опирается на: ' + esc(needs) + '</p>' : '') + tileFooter(c) + '</article>';
}

export function soonCourseTile(c) {
  return '<article class="card tile tile-soon" aria-label="' + esc(c.title) + ' — скоро"><div class="tile-meta">' +
    '<span title="Звено: ' + esc(metalName(c.metal)) + '">' + linkIcon(c.metal, 0, 32) + '</span><span>Скоро</span></div><h3>' + esc(c.title) + '</h3><p>Курс готовится</p></article>';
}
