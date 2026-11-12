const join = location.pathname.startsWith('/join/');
const code = location.pathname.split('/')[2] || '';
const $ = (id) => document.getElementById(id);
const form = $('form'), err = $('err'), go = $('go');

async function request(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
  return data;
}

async function boot() {
  try {
    if (join) {
      let me;
      const response = await fetch('/api/me');
      if (response.ok) me = await response.json();
      else if (response.status !== 401) throw new Error('Не удалось проверить текущий аккаунт');
      if (me) {
        $('identity').textContent = 'Ты вошёл как ' + me.name + '. Выйти и создать новый аккаунт?';
        $('signed-in').hidden = false;
        return;
      }
      const info = await request('/api/join/' + encodeURIComponent(code));
      const role = document.createElement('p');
      role.textContent = 'Роль: ' + (info.role === 'author' ? 'автор' : 'ученик');
      $('benefits').replaceChildren(role);
      const title = document.createElement('p');
      title.textContent = info.courses.length ? 'Курсы, к которым откроется доступ:' : 'Все публичные курсы будут доступны после регистрации.';
      $('benefits').append(title);
      if (info.courses.length) {
        const list = document.createElement('ul');
        info.courses.forEach((name) => { const li = document.createElement('li'); li.textContent = name; list.append(li); });
        $('benefits').append(list);
      }
    }
    form.hidden = false;
  } catch (e) {
    $('reason').textContent = e.message;
    $('unavailable').hidden = false;
  } finally { $('loading').hidden = true; }
}

$('sign-out').addEventListener('click', async () => {
  try { await request('/api/logout', {}); location.reload(); }
  catch (e) { $('identity').textContent = e.message; }
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const password = $('password').value;
  const n = [...password].length;
  if (password !== $('repeat').value || n < 10 || n > 256) {
    err.textContent = password !== $('repeat').value ? 'Пароли не совпадают' : 'Пароль — от 10 до 256 символов';
    err.hidden = false; return;
  }
  go.disabled = true;
  try {
    const body = join ? { code, login: $('login').value, name: $('name').value, password } : { token: code, password };
    await request(join ? '/api/join' : '/api/reset', body);
    location.replace('/');
  } catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; }
});
boot();
