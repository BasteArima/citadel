// Точка входа: кто вошёл, потом курс из API — и запускаем движок.
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
  const [user, course] = await Promise.all([getJSON('/api/me'), getJSON('/api/courses/' + encodeURIComponent(id))]);
  start(course, user);
} catch (e) {
  page.textContent = 'Не удалось загрузить курс: ' + e.message;
  console.error(e);
}
