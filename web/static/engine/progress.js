// Прогресс и настройки в localStorage.
// Настройки (тема, скорость озвучки, режим чтения) общие для всех курсов — ключ citadel-ui.
// Прогресс курса — ключ citadel-progress:<id>: по уроку { t: { id вопроса: 1 }, seen: { часть: 1 }, done, rev }.
// На этапе 2 прогресс переедет на сервер, ключи вопросов останутся теми же.
export const UI_KEY = 'citadel-ui';

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

export function loadState(courseId) {
  const ui = read(UI_KEY), pr = read('citadel-progress:' + courseId);
  const S = {
    lessons: pr.lessons || {},
    theme: ui.theme || 'auto',
    ui: { open: pr.open || {}, runs: pr.runs || {}, rate: ui.rate || 1, focus: !!ui.focus }
  };
  S.save = function () {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ theme: S.theme, rate: S.ui.rate, focus: S.ui.focus }));
      localStorage.setItem('citadel-progress:' + courseId, JSON.stringify({ lessons: S.lessons, open: S.ui.open, runs: S.ui.runs }));
    } catch (e) { /* приватный режим: работаем без сохранения */ }
  };
  // состояние урока: решённые вопросы, дочитанные части, дата прохождения, повторы
  S.lesson = function (id) {
    const st = S.lessons[id] || (S.lessons[id] = {});
    st.t = st.t || {};
    return st;
  };
  return S;
}
