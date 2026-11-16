import { api, syncStatus } from './shared.js';

let active = null;
const pendingWarning = 'В этом браузере есть отметки, которые ещё не дошли до сервера. После выхода они пропадут. Открой курс при подключении, чтобы они ушли.';

// Shared by the account menu and settings. Cancellation never sends a request.
export function confirmLogout(all = false, trigger = document.activeElement) {
  if (active) return;
  const d = document.createElement('dialog');
  active = d;
  d.className = 'account-dialog';
  d.setAttribute('aria-labelledby', 'logout-title');
  d.setAttribute('aria-describedby', 'logout-description');
  d.innerHTML = '<h2 id="logout-title"></h2><p id="logout-description"></p><p class="note-bad" role="alert" hidden></p>' +
    '<div class="account-dialog-actions"><button type="button" class="btn" data-cancel autofocus>Отмена</button><button type="button" class="btn account-danger" data-confirm>Выйти</button></div>';
  d.querySelector('h2').textContent = all ? 'Выйти на всех устройствах?' : 'Выйти из аккаунта?';
  const description = d.querySelector('#logout-description');
  description.textContent = all ? 'Все браузеры и телефоны, где ты вошёл, выйдут из аккаунта, включая этот.' :
    'На этом устройстве нужно будет войти снова. Прогресс сохранён на сервере.';
  if (syncStatus().pending) {
    description.className = 'note-bad';
    description.textContent = (all ? description.textContent + ' ' : 'На этом устройстве нужно будет войти снова. ') + pendingWarning;
  }
  const close = () => d.close();
  d.addEventListener('close', () => { d.remove(); active = null; if (trigger?.isConnected) trigger.focus(); });
  d.querySelector('[data-cancel]').addEventListener('click', close);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.querySelector('[data-confirm]').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await api(all ? '/api/me/logout-all' : '/api/logout', all ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      } : { method: 'POST' });
      location.href = '/login';
    } catch (err) {
      const error = d.querySelector('[role="alert"]');
      error.textContent = 'Не получилось выйти: ' + err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
  document.body.appendChild(d);
  d.showModal();
  d.querySelector('[data-cancel]').focus();
}
