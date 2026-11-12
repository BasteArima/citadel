// Общее для страниц с проектами: столбики уровней, плитка проекта, степени помощи (решение 0016).
import { esc, plural, linkIcon, metalName, courseState } from './shared.js';

// Сколько помощи даёт уровень: поле tag у узла section.
export const HELP = {
  guided: { title: 'С подсказками по коду', text: 'Полное ТЗ, контракт API, файлы, подводные камни. Подсказки открываются по одной, в последних есть код.' },
  junior: { title: 'Как у джуна в команде', text: 'ТЗ и направление, куда смотреть, но без кода. Появляются инциденты: вот симптомы, найди причину.' },
  ticket: { title: 'Как настоящий тикет', text: 'Только цель и критерий готовности. Как делать, решаешь сам и объясняешь на защите.' }
};

// Подряд идущие уровни с одной степенью помощи: { tag, from, to }, номера с единицы.
export function helpRanges(tags) {
  const out = [];
  tags.forEach((tag, i) => {
    if (!HELP[tag]) return;
    const last = out[out.length - 1];
    if (last && last.tag === tag && last.to === i) last.to = i + 1;
    else out.push({ tag, from: i + 1, to: i + 1 });
  });
  return out;
}

// Столбик уровня снизу вверх: зелёные — закрытые шаги, синий — текущий (cur — его номер, −1 — нет).
export function levelBars(total, done, cur) {
  let s = '';
  for (let i = 0; i < total; i++) s += '<i class="' + (i < done ? 'ok' : i === cur ? 'cur' : '') + '"></i>';
  return '<span class="pj-ticks" aria-hidden="true">' + s + '</span>';
}

// Все уровни проекта столбиками. Текущий шаг — первый незакрытый.
export function allBars(levels) {
  const curLevel = levels.findIndex((l) => l.closed < l.total);
  return '<div class="pj-mini" role="img" aria-label="Закрыто по уровням: ' + levels.map((l) => l.closed + ' из ' + l.total).join(', ') + '">' +
    levels.map((l, i) => levelBars(l.total, l.closed, i === curLevel ? l.closed : -1)).join('') + '</div>';
}

const STATE = { done: ['Пройден', 'good'], active: ['В работе', 'acc'], new: ['Не начат', ''] };

export function projectTile(c) {
  const st = courseState(c), href = '/p/' + encodeURIComponent(c.id) + '/', levels = c.levels || [];
  const pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
  return '<article class="card tile metal-' + esc(c.metal) + '">' +
    '<div class="tile-h">' + allBars(levels) + '<span class="chip ' + STATE[st][1] + '">' + STATE[st][0] + '</span></div>' +
    (c.onlyYours ? '<span class="chip">Только у тебя</span>' : '') + '<div><h3><a href="' + href + '">' + esc(c.title) + '</a></h3>' + (c.subtitle ? '<p>' + esc(c.subtitle) + '</p>' : '') + '</div>' +
    '<ul class="chips"><li class="chip">' + esc(c.tool.name + ' ' + c.tool.version) + '</li>' +
      '<li class="chip">' + levels.length + ' ' + plural(levels.length, 'уровень', 'уровня', 'уровней') + ', ' + c.lessons + ' ' + plural(c.lessons, 'шаг', 'шага', 'шагов') + '</li>' +
      '<li class="chip"><span class="dot"></span>звено: ' + esc(metalName(c.metal)) + '</li></ul>' +
    '<div class="prog"><div class="prog-t"><span>' + (c.next ? 'Сейчас: шаг ' + esc(c.next.num) + '. ' + esc(c.next.title) : 'Все шаги закрыты') + '</span><span>' + c.done + ' из ' + c.lessons + '</span></div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Прогресс проекта"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="row">' + (c.next ? '<a class="btn btn-l pri" href="' + href + '#' + encodeURIComponent(c.next.id) + '">Открыть ТЗ</a>' : '') +
      '<a class="btn btn-l" href="' + href + '">О проекте</a></div>' +
    '</article>';
}

export function soonProjectTile(c) {
  return '<article class="card tile tile-soon" aria-label="' + esc(c.title) + ' — скоро">' +
    '<div class="tile-h">' + linkIcon(c.metal, 0) + '<span class="chip">Скоро</span></div>' +
    '<div><h3>' + esc(c.title) + '</h3><p>Проект готовится. Откроется, когда его опубликуют.</p></div></article>';
}
