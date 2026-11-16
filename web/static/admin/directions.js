import { req, esc, h, dialog, confirmDialog, toast } from './ui.js';

export function directionSelect(c, directions) {
  return '<label class="ad-f">Направление<select class="ad-direction" aria-label="Направление курса ' + esc(c.title) + '"><option value="">Без направления</option>' +
    directions.map((d) => '<option value="' + esc(d.id) + '"' + (c.direction === d.id ? ' selected' : '') + '>' + esc(d.title) + '</option>').join('') + '</select></label>';
}

export function bindDirectionSelects(rows) {
  rows.querySelectorAll('.ad-direction').forEach((select) => select.addEventListener('change', async () => {
    const before = select.dataset.saved || '';
    select.disabled = true;
    try {
      const r = await req('PUT', '/api/admin/courses/' + encodeURIComponent(select.closest('tr').dataset.id) + '/direction', { direction: select.value });
      if (!r.ok) throw new Error(r.data.error || 'Не удалось назначить направление');
      select.dataset.saved = select.value;
      toast('Направление сохранено', 'good');
    } catch (e) { select.value = before; toast(e.message, 'bad'); }
    finally { select.disabled = false; }
  }));
  rows.querySelectorAll('.ad-direction').forEach((select) => { select.dataset.saved = select.value; });
}

export async function directionsDialog(refresh) {
  const opener = document.activeElement;
  try {
    const initial = await req('GET', '/api/directions');
    if (!initial.ok) throw new Error('Не удалось загрузить направления');
    let list = initial.data, busy = false;
    const body = h('div', 'ad-form');
    body.innerHTML = '<div class="ad-direction-list"></div><h3>Добавить направление</h3>' +
      '<label class="ad-f">id · латиница, цифры, дефис; 2–32 символа<input class="direction-id" maxlength="32" pattern="[a-zA-Z0-9-]{2,32}" autocomplete="off"></label>' +
      '<label class="ad-f">Название<input class="direction-title" maxlength="40"></label><button type="button" class="btn direction-add">Добавить</button><p class="ad-err" role="alert"></p>';
    const d = dialog('Направления', body);
    d.setAttribute('aria-label', 'Направления');
    d.addEventListener('close', async () => {
      try { await refresh(); }
      catch (e) { toast('Не удалось обновить курсы', 'bad'); }
      finally { if (opener?.isConnected) opener.focus(); }
    }, { once: true });
    const box = body.querySelector('.ad-direction-list');
    const draw = (focusId, action) => {
      box.innerHTML = list.map((item, i) => '<div class="ad-form" data-id="' + esc(item.id) + '"><label class="ad-f">' + esc(item.id) + '<input aria-label="Название направления ' + esc(item.title) + '" value="' + esc(item.title) + '" maxlength="40"></label><div class="ad-row">' +
        '<button type="button" class="btn" data-action="rename">Сохранить название</button>' +
        '<button type="button" class="btn" data-action="up" aria-label="Поднять ' + esc(item.title) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn" data-action="down" aria-label="Опустить ' + esc(item.title) + '"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn ad-danger" data-action="delete">Удалить</button></div></div>').join('') || '<p class="ad-mut">Направлений пока нет.</p>';
      if (focusId) {
        const row = [...box.children].find((row) => row.dataset.id === focusId);
        const button = row?.querySelector('[data-action="' + action + '"]');
        (button && !button.disabled ? button : row?.querySelector('input') || body.querySelector('.direction-id')).focus();
      }
    };
    const change = async (method, path, payload, focusId, action) => {
      if (busy) return;
      busy = true;
      body.querySelector('.ad-err').textContent = '';
      try {
        const r = await req(method, path, payload);
        if (!r.ok) throw new Error(r.data.error || 'Не удалось сохранить направление');
        const updated = await req('GET', '/api/directions');
        if (!updated.ok) throw new Error('Не удалось обновить список');
        list = updated.data;
        draw(focusId, action);
      } catch (e) { body.querySelector('.ad-err').textContent = e.message; }
      finally { busy = false; }
    };
    box.addEventListener('click', async (e) => {
      const button = e.target.closest('[data-action]');
      if (!button || busy) return;
      const row = button.closest('[data-id]'), id = row.dataset.id, action = button.dataset.action;
      const at = list.findIndex((item) => item.id === id);
      const path = '/api/admin/directions/' + encodeURIComponent(id);
      if (action === 'delete') {
        if (!(await confirmDialog('Удалить направление?', 'Курсы из «' + list[at].title + '» останутся без направления.', 'Удалить', true))) return;
        await change('DELETE', path, undefined, id, action);
      } else {
        const payload = action === 'rename' ? { title: row.querySelector('input').value } : { position: at + (action === 'up' ? -1 : 1) };
        await change('PUT', path, payload, id, action);
      }
    });
    body.querySelector('.direction-add').addEventListener('click', async () => {
      const id = body.querySelector('.direction-id').value.trim(), title = body.querySelector('.direction-title').value.trim();
      await change('POST', '/api/admin/directions', { id, title }, id, 'rename');
    });
    draw();
  } catch (e) { toast(e.message, 'bad'); }
}
