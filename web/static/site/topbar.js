// Шапка — одна на страницы сайта и курса, её разметку отдаёт сервер (internal/server/top.go): она есть
// уже в первом кадре и не моргает при переходах. Здесь — только то, чего сервер не знает:
// счётчик карточек, тема по кнопкам, а в курсе — меню и компактная шапка урока на телефоне.

const UI_KEY = 'citadel-ui';

export function readTheme() {
  try { return (JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}).theme || 'auto'; } catch (e) { return 'auto'; }
}
export function applyTheme(theme) {
  const r = document.documentElement;
  if (theme === 'light' || theme === 'dark') r.setAttribute('data-theme', theme); else r.removeAttribute('data-theme');
}
// Тема общая для всех страниц и курсов: хранится там же, где её хранит движок курса.
export function saveTheme(theme) {
  try {
    const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {};
    ui.theme = theme;
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch (e) { /* тема просто не запомнится */ }
}

// Нажатая кнопка темы видна сразу по CSS (<html data-theme>); aria-pressed — для экранных читалок.
export function markTheme(top, theme) {
  top.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme)));
}

// Карточки на сегодня: счётчик у «Повторений» и кнопка «Повторить» (кроме самой страницы повторений).
export function setDue(top, due, current) {
  const badge = top.querySelector('.nav-badge'), link = top.querySelector('.tb-due');
  if (badge) { badge.textContent = due || ''; badge.hidden = !due; }
  if (link) { link.querySelector('b').textContent = due || ''; link.hidden = !due || current === 'review'; }
}

// Страницы сайта: тема меняется на месте, счётчик карточек — после ответа API.
export function siteTop(current) {
  const top = document.getElementById('top');
  markTheme(top, readTheme());
  top.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (!b) return;
    saveTheme(b.dataset.themeSet);
    applyTheme(b.dataset.themeSet);
    markTheme(top, b.dataset.themeSet);
  });
  return {
    redraw() { markTheme(top, readTheme()); },
    update(user, due) {
      setDue(top, due, current);
      const profile = top.querySelector('.tb-me');
      if (profile && user) {
        profile.textContent = Array.from(user.name)[0].toUpperCase();
        profile.setAttribute('aria-label', 'Профиль: ' + user.name);
      }
    }
  };
}
