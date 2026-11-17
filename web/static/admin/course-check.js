import { esc, req, walk } from './ui.js';
import { draft, onDraft } from './draft.js';

export function problemLink(course, problem) {
  let node;
  walk(course.root, (n) => { if (problem.path === 'узел ' + n.id || problem.path.startsWith('узел ' + n.id + ', ')) node = n; });
  const text = esc(problem.path + ': ' + problem.msg);
  return node ? '<a href="#/c/' + encodeURIComponent(course.id) + '/edit/' + encodeURIComponent(node.id) + '">' + text + '</a>' : text;
}

// Checks the current in-memory course, including changes that have not been saved.
export function courseCheck(box) {
  const course = draft.course;
  box.innerHTML = '<h2>Проверка курса</h2><p class="ad-small ad-mut" role="status"></p><div data-results></div><button type="button" class="btn">Проверить снова</button>';
  const status = box.querySelector('[role=status]'), results = box.querySelector('[data-results]'), button = box.querySelector('button');
  let alive = true, generation = 0;
  const draw = (check) => {
    results.innerHTML = (check.errors ? '' : '<p class="ad-ok">✓ Без ошибок</p>') +
      ((check.problems || []).length ? '<ul class="ad-probs">' + check.problems.map((p) => '<li class="' + (p.warning ? 'warn' : 'bad') + '">' + problemLink(course, p) + '</li>').join('') + '</ul>' : '');
  };
  const check = async () => {
    const request = ++generation, snapshot = JSON.stringify(course);
    button.disabled = true; status.textContent = 'Проверяю текущий черновик…';
    try {
      const r = await req('POST', '/api/admin/check', snapshot);
      if (!alive || generation !== request) return;
      if (snapshot !== JSON.stringify(course)) { status.textContent = 'Черновик изменился во время проверки. Проверь снова.'; return; }
      if (!r.ok) { status.textContent = 'Не удалось проверить курс'; return; }
      draw(r.data); status.textContent = 'Проверен текущий черновик, включая несохранённые правки.';
    } catch (_) { if (alive && generation === request) status.textContent = 'Нет связи с сервером. Проверь снова.'; }
    finally { if (alive && generation === request) button.disabled = false; }
  };
  const unsubscribe = onDraft(() => { status.textContent = 'Черновик изменился. Проверь снова.'; });
  button.addEventListener('click', check); check();
  return () => { alive = false; unsubscribe(); };
}
