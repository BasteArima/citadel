// Точка входа: берём курс из API и запускаем движок.
import { start } from './app.js';

const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const page = document.getElementById('page');

try {
  const r = await fetch('/api/courses/' + encodeURIComponent(id));
  if (!r.ok) throw new Error('сервер ответил ' + r.status);
  start(await r.json());
} catch (e) {
  page.textContent = 'Не удалось загрузить курс: ' + e.message;
  console.error(e);
}
