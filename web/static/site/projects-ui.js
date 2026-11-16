// Общее для страниц с проектами: столбики уровней, плитка проекта, степени помощи (решение 0016).
import { esc, linkIcon } from './shared.js';
import { tileMeta, tileFooter } from './tiles.js';

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

export function projectCard(projects) {
  const c = projects.find((x) => x.started && x.next);
  if (!c) return '';
  return '<section class="card top-card" aria-labelledby="project-now-title"><div class="lbl" id="project-now-title">В проекте сейчас</div>' +
    '<div><p>' + esc(c.title) + '</p><h2>Шаг ' + esc(c.next.num || c.next.n) + '. ' + esc(c.next.title) + '</h2></div>' +
    '<div class="row"><a class="btn btn-l pri" href="/p/' + encodeURIComponent(c.id) + '/#' + encodeURIComponent(c.next.id) + '">Открыть ТЗ</a></div></section>';
}

export function projectTile(c, context) {
  return '<article class="card tile metal-' + esc(c.metal) + '">' + tileMeta(c, context, true) +
    '<h3><a href="/p/' + encodeURIComponent(c.id) + '/">' + esc(c.title) + '</a></h3>' +
    '<p class="tile-subtitle" title="' + esc(c.subtitle || '') + '">' + esc(c.subtitle || '') + '</p>' +
    tileFooter(c, true) + '</article>';
}

export function soonProjectTile(c) {
  return '<article class="card tile tile-soon" aria-label="' + esc(c.title) + ' — скоро">' +
    '<div class="tile-meta">' + linkIcon(c.metal, 0, 32) + '<span>Скоро</span></div>' +
    '<h3>' + esc(c.title) + '</h3><p>Проект готовится</p></article>';
}
