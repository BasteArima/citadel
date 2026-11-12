import { req, esc, h, when, toast, dialog, confirmDialog } from './ui.js';

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано', 'good'); }
  catch (e) {
    const box = h('div', 'ad-form');
    box.innerHTML = '<p>Браузер не разрешил копирование. Выдели ссылку и скопируй вручную.</p><input aria-label="Ссылка" readonly>';
    box.querySelector('input').value = text;
    dialog('Скопируй ссылку', box, [{ label: 'Готово' }]);
    box.querySelector('input').select();
  }
}

export function resetLinkDialog(user, onChanged) {
  const form = h('div', 'ad-form');
  form.innerHTML = '<p>Ссылка действует 24 часа и отменяет прежние ссылки сброса. После установки пароля все прежние сессии закроются.</p>' +
    (!user.login ? '<div class="ad-f"><label for="reset-login">Логин · 3–32 символа: латиница, цифры, ._-; первый — буква или цифра</label><input id="reset-login" maxlength="32" autocomplete="off" autocapitalize="none"></div>' : '') + '<p class="ad-err" role="alert"></p>';
  dialog('Сброс пароля · ' + user.name, form, [
    { label: 'Отмена' },
    { label: 'Создать ссылку', primary: true, onClick: async (close, d) => {
      const button = d.querySelector('.pri');
      button.disabled = true;
      try {
        const r = await req('POST', '/api/admin/users/' + user.id + '/reset-link', { login: user.login ? '' : form.querySelector('input').value });
        if (!r.ok) { form.querySelector('.ad-err').textContent = r.data.error || 'Не удалось создать ссылку'; return; }
        close();
        const box = h('div', 'ad-form');
        const url = new URL(r.data.url, location.origin);
        const text = location.origin + url.pathname;
        box.innerHTML = '<p>Скопируй и передай человеку лично. Больше эту ссылку не покажем. Она действует 24 часа и даёт доступ к аккаунту.</p><div class="tk-cmd"><pre></pre><button type="button" class="btn">Скопировать</button></div>';
        box.querySelector('pre').textContent = text;
        box.querySelector('button').addEventListener('click', () => copy(text));
        dialog('Ссылка для сброса пароля создана', box, [{ label: 'Готово' }]);
        onChanged();
      } catch (e) { form.querySelector('.ad-err').textContent = 'Нет связи с сервером. Попробуй ещё раз.'; }
      finally { button.disabled = false; }
    } }
  ]);
}

export function renderInvites(main, courses) {
  const page = h('div', 'ad-page');
  main.append(page);
  page.innerHTML = `<div class="ad-head"><div><h1>Приглашения</h1><p class="ad-sub">Новые аккаунты по ссылке: выбери роль, курсы, число использований и срок.</p></div><button type="button" class="btn pri" id="iv-new" aria-expanded="false">+ Новое приглашение</button></div><div id="iv-form"></div><div class="ad-table-w"><table class="ad-table"><thead><tr><th>Пометка</th><th>Роль и курсы</th><th>Использования</th><th>Срок и статус</th><th>Кто зарегистрировался</th><th></th></tr></thead><tbody id="iv-rows"><tr><td colspan="6">Загружаю…</td></tr></tbody></table></div>`;
  const formBox = page.querySelector('#iv-form'), newButton = page.querySelector('#iv-new');
  newButton.addEventListener('click', () => {
    const open = !formBox.firstChild;
    newButton.setAttribute('aria-expanded', String(open));
    formBox.replaceChildren();
    if (!open) return;
    const f = h('form', 'ad-card ad-pad ad-form');
    f.innerHTML = `<div class="ad-grid2"><div class="ad-f"><label for="iv-note">Пометка</label><input id="iv-note" maxlength="1000" placeholder="например, для Саши"></div><div class="ad-f"><label for="iv-role">Роль</label><select id="iv-role"><option value="student">Ученик</option><option value="author">Автор</option></select></div></div>
      <fieldset class="tk-rights iv-courses"><legend>Закрытые курсы</legend>${courses.filter((c) => c.access === 'private').map((c) => '<label class="ad-check-l"><input type="checkbox" name="course" value="' + esc(c.id) + '"> ' + esc(c.title || c.id) + '</label>').join('') || '<p class="ad-mut">Закрытых курсов пока нет.</p>'}</fieldset>
      <div class="ad-grid2"><div class="ad-f"><label for="iv-uses">Сколько раз</label><select id="iv-uses"><option value="one">Один раз</option><option value="number">N раз</option><option value="unlimited">Без ограничения</option></select><label for="iv-number" hidden>Число использований</label><input id="iv-number" type="number" min="1" max="9007199254740991" step="1" value="2" hidden disabled></div>
      <div class="ad-f"><label for="iv-ttl">Срок</label><select id="iv-ttl"><option value="1">1 час</option><option value="24">1 день</option><option value="168" selected>7 дней</option><option value="720">30 дней</option><option value="date">До даты</option><option value="forever">Бессрочно</option></select><label for="iv-date" hidden>Дата и время окончания</label><input id="iv-date" type="datetime-local" hidden disabled></div></div><p class="ad-err" role="alert"></p><div><button class="btn pri" type="submit">Создать приглашение</button></div>`;
    formBox.append(f);
    const uses = f.querySelector('#iv-uses'), number = f.querySelector('#iv-number'), ttl = f.querySelector('#iv-ttl'), date = f.querySelector('#iv-date');
    const toggle = (input, show) => { input.hidden = input.disabled = !show; input.required = show; f.querySelector('label[for="' + input.id + '"]').hidden = !show; };
    uses.addEventListener('change', () => toggle(number, uses.value === 'number'));
    ttl.addEventListener('change', () => toggle(date, ttl.value === 'date'));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = f.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const expiresAt = ttl.value === 'forever' ? '' : ttl.value === 'date' ? new Date(date.value).toISOString() : new Date(Date.now() + Number(ttl.value) * 3600000).toISOString();
        const maxUses = uses.value === 'unlimited' ? null : uses.value === 'one' ? 1 : Number(number.value);
        const r = await req('POST', '/api/admin/invites', { note: f.querySelector('#iv-note').value, role: f.querySelector('#iv-role').value, courses: [...f.querySelectorAll('[name="course"]:checked')].map((x) => x.value), maxUses, expiresAt });
        if (!r.ok) { f.querySelector('.ad-err').textContent = r.data.error || 'Не удалось создать приглашение'; return; }
        formBox.replaceChildren(); newButton.setAttribute('aria-expanded', 'false');
        toast('Приглашение создано — скопируй ссылку в списке', 'good');
        await load();
      } catch (e) { f.querySelector('.ad-err').textContent = 'Не удалось создать приглашение. Проверь дату и связь с сервером.'; }
      finally { button.disabled = false; }
    });
    f.querySelector('input').focus();
  });
  load();

  async function load() {
    const rows = page.querySelector('#iv-rows');
    const r = await req('GET', '/api/admin/invites');
    if (!r.ok) { rows.innerHTML = '<tr><td colspan="6">Не удалось загрузить приглашения</td></tr>'; return; }
    const statuses = { active: 'активна', exhausted: 'исчерпана', expired: 'истекла', revoked: 'отозвана' };
    const title = (id) => { const c = courses.find((c) => c.id === id); return c ? c.title : id + ' (удалён)'; };
    rows.innerHTML = r.data.map((i) => `<tr><td><strong>${esc(i.note || 'Без пометки')}</strong><br><span class="ad-small ad-mut">${esc(when(i.createdAt))}</span></td><td>${i.role === 'author' ? 'автор' : 'ученик'}<br><span class="ad-small ad-mut">${esc(i.courses.map(title).join(', ') || 'публичные курсы')}</span></td><td>использована ${i.uses}${i.maxUses === null ? ' · без ограничения' : ' из ' + i.maxUses}</td><td>${esc(i.expiresAt ? when(i.expiresAt) : 'бессрочно')}<br><span class="ad-pill ${i.status === 'active' ? 'good' : ''}">${statuses[i.status]}</span></td><td>${esc(i.users.join(', ') || '—')}</td><td class="ad-r"><div class="ad-acts"><button type="button" class="btn" data-copy="${i.id}">Скопировать ссылку</button>${i.status !== 'revoked' ? '<button type="button" class="btn ad-danger" data-revoke="' + i.id + '">Отозвать</button>' : ''}${i.status !== 'active' ? '<button type="button" class="btn ad-danger" data-delete="' + i.id + '">Удалить</button>' : ''}</div></td></tr>`).join('') || '<tr><td colspan="6">Приглашений пока нет. Создай первое.</td></tr>';
    rows.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(location.origin + '/join/' + r.data.find((i) => String(i.id) === b.dataset.copy).code)));
    rows.querySelectorAll('[data-revoke], [data-delete]').forEach((b) => b.addEventListener('click', async () => {
      const remove = !!b.dataset.delete, id = b.dataset.delete || b.dataset.revoke;
      if (!(await confirmDialog(remove ? 'Удалить приглашение?' : 'Отозвать приглашение?', remove ? 'Приглашение исчезнет из списка. Созданные аккаунты и доступ к курсам сохранятся.' : 'По этой ссылке больше нельзя будет создать аккаунт. Уже созданные аккаунты сохранятся.', remove ? 'Удалить' : 'Отозвать', true))) return;
      const result = await req(remove ? 'DELETE' : 'POST', '/api/admin/invites/' + id + (remove ? '' : '/revoke'), remove ? undefined : {});
      if (!result.ok) { toast(result.data.error || 'Не удалось изменить приглашение', 'bad'); return; }
      load();
    }));
  }
}
