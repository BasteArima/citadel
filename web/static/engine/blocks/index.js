// Все типы блоков, которые знает движок. Новый тип — новый модуль и строка здесь,
// плюс запись в internal/course/blocks.go, чтобы сервер его пропускал.
import { register } from './registry.js';
import { heading, text, list, code, table, callout, scheme, embed } from './basic.js';
import { steps } from './steps.js';
import { anim } from './anim.js';
import { predict } from './predict.js';
import { question } from './question.js';
import { hands } from './hands.js';

register(heading, text, list, code, table, callout, scheme, steps, anim, predict, question, hands, embed);

export { renderBlock, speakables, questionsOf } from './registry.js';
export { renderQuestion } from './question.js';
