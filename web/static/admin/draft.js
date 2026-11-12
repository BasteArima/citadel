// Черновик курса, открытый в админке: один на все страницы (редактор, вопросы и словарь, версии),
// чтобы правки не терялись при переходе между ними. Сохранение — новая версия на сервере.
import { req, toast, esc, dialog, plural, AREAS, areaOf } from './ui.js';

export const draft = {
  id: null,
  course: null,   // объект курса, его правят страницы
  version: 0,     // версия, от которой начата правка (base для сохранения)
  published: false,
  check: null,
  dirty: false,
  fresh: new Set() // id узлов, созданных в этой правке: их id ещё можно менять
};

const listeners = new Set();
export function onDraft(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn(draft)); }

export async function openDraft(id, force) {
  if (!force && draft.id === id && draft.course) return true;
  const r = await req('GET', '/api/admin/courses/' + encodeURIComponent(id) + '/draft');
  if (!r.ok) { toast(r.data.error || 'Не открылся черновик: ' + r.status, 'bad'); return false; }
  Object.assign(draft, { id, course: r.data.course, version: r.data.version.version, published: r.data.version.published, check: null, dirty: false });
  draft.fresh = new Set();
  emit();
  return true;
}

export function touch() {
  if (!draft.dirty) { draft.dirty = true; emit(); }
}

let saving = null;
export function save(note) {
  if (saving) return saving;
  saving = (async () => {
    const r = await req('PUT', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/draft', { base: draft.version, note: note || '', course: draft.course });
    saving = null;
    if (r.status === 409) { toast(r.data.error, 'bad'); return false; }
    if (!r.ok) { toast(r.data.error || 'Не сохранилось: ' + r.status, 'bad'); return false; }
    Object.assign(draft, { version: r.data.version, published: false, check: r.data.check, dirty: false });
    draft.fresh = new Set();
    emit();
    const c = r.data.check;
    toast('Сохранено: v' + r.data.version + (c.errors ? ' · ' + c.errors + ' ' + plural(c.errors, 'ошибка', 'ошибки', 'ошибок') + ' — опубликовать пока нельзя' : ''), c.errors ? 'warn' : 'good');
    return true;
  })();
  return saving;
}

// Список находок проверки по пунктам.
export function problemsHTML(check) {
  if (!check || !check.problems.length) return '<p class="ad-ok">✓ Проверка прошла без ошибок и предупреждений.</p>';
  const by = {};
  check.problems.forEach((p) => { (by[areaOf(p)] = by[areaOf(p)] || []).push(p); });
  return '<ul class="ad-probs">' + AREAS.filter((a) => by[a[0]]).map((a) =>
    by[a[0]].map((p) => '<li class="' + (p.warning ? 'warn' : 'bad') + '"><b>' + esc(a[1]) + '</b> · ' + esc(p.path) + ': ' + esc(p.msg) + '</li>').join('')).join('') + '</ul>';
}

// «Опубликовать…»: несохранённое сначала сохраняется; версию с ошибками сервер не примет.
export async function publishFlow(version) {
  if (draft.dirty && !(await save())) return false;
  const v = version || draft.version;
  const ck = await req('GET', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/versions/' + v);
  let check = null;
  if (ck.ok) {
    const r = await req('POST', '/api/admin/check', ck.data.course);
    if (r.ok) check = r.data;
  }
  return new Promise((resolve) => {
    const bad = check && check.errors > 0;
    dialog('Опубликовать v' + v + '?',
      (bad ? '<p>В версии есть ошибки — ученики не должны увидеть сломанный курс. Исправь их и сохрани.</p>'
        : '<p>В каталоге будет доступна эта версия. Доступ к курсу не изменится. Прогресс сохранится: он хранится по id уроков и вопросов.</p>') + problemsHTML(check),
      [
        { label: 'Отмена', onClick: (close) => { close(); resolve(false); } },
        { label: 'Опубликовать v' + v, primary: true, disabled: bad, onClick: async (close) => {
          const r = await req('POST', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/publish', { version: v });
          close();
          if (!r.ok) { toast(r.data.error || 'Не опубликовано: ' + r.status, 'bad'); resolve(false); return; }
          if (v === draft.version) draft.published = true;
          emit();
          toast('Опубликована v' + v, 'good');
          resolve(true);
        } }
      ]);
  });
}

window.addEventListener('beforeunload', (e) => {
  if (draft.dirty) { e.preventDefault(); e.returnValue = ''; }
});
