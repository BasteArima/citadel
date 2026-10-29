// Точка входа: кто вошёл, курс и список курсов из API — и запускаем движок.
import { start } from './app.js';

const id = decodeURIComponent(location.pathname.split('/')[2] || '');
const page = document.getElementById('page');

async function getJSON(url) {
  const r = await fetch(url);
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
    return new Promise(() => {}); // страница уходит на вход
  }
  if (!r.ok) throw new Error('сервер ответил ' + r.status);
  return r.json();
}

try {
  const [user, course, catalog] = await Promise.all([
    getJSON('/api/me'),
    getJSON('/api/courses/' + encodeURIComponent(id)),
    getJSON('/api/courses')
  ]);
  start(course, user, catalog);
} catch (e) {
  page.textContent = 'Не удалось загрузить курс: ' + e.message;
  console.error(e);
}
