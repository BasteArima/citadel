// Реестр типов блоков. Модуль блока — объект:
//
//   type       тип блока, как в поле type курса v1
//   render     (block, ctx) → DOM-узел
//   questions  (block) → вопросы, от которых зависит выполнение части; нет функции — блок не влияет
//
// ctx: { tool } — инструмент курса; для вопросов ещё { label, store, onSolve }, для задания руками { store, onChange }.
// Неизвестный тип рисуется заглушкой и не ломает страницу.
import { el, esc } from '../util.js';

const modules = new Map();

export function register(...mods) { mods.forEach((m) => modules.set(m.type, m)); }

export function renderBlock(b, ctx) {
  const m = modules.get(b.type);
  return m ? m.render(b, ctx) : stub(b);
}

export function questionsOf(b) {
  const m = modules.get(b.type);
  return m && m.questions ? m.questions(b) : [];
}

function stub(b) {
  return el('div', 'callout note', '<b>Блок недоступен</b>Тип «' + esc(b.type || '?') + '» эта версия движка не умеет показывать.');
}
