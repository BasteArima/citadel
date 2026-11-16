// Шапка — одна на страницы сайта и курса, её разметку отдаёт сервер (internal/server/top.go): она есть
// уже в первом кадре и не моргает при переходах. Здесь — только то, чего сервер не знает:
// счётчик карточек, тема по кнопкам, а в курсе — меню и компактная шапка урока на телефоне.

import { avatarHTML } from './shared.js';
import { confirmLogout } from './logout.js';

const UI_KEY = 'citadel-ui';

export function updateAccount(top, user) {
  const button = top.querySelector('.tb-me');
  if (!button || !user) return;
  button.innerHTML = avatarHTML(user, 32);
  button.setAttribute('aria-label', 'Меню аккаунта: ' + user.name);
  top.querySelector('.tb-account-name').textContent = user.name;
}

const openMenus = new Set();
let menuListeners = false;
function initMenuListeners() {
  if (menuListeners) return; menuListeners = true;
  document.addEventListener('click', (e) => { for (const m of openMenus) if (!m.root.contains(e.target)) m.close(); });
  document.addEventListener('focusin', (e) => { for (const m of openMenus) if (!m.root.contains(e.target)) m.close(false); });
}

// Shared keyboard menu for the avatar and admin row actions.
export function bindMenu(root, button, menu, onSelect, manual = false) {
  initMenuListeners();
  const entry = { root, close };
  const items = () => [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  function close(focus = true) {
    if (menu.hidden) return;
    openMenus.delete(entry);
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus && button.isConnected) button.focus();
  }
  function open(last = false) {
    for (const m of openMenus) m.close(false);
    openMenus.add(entry);
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    const list = items(); list[last ? list.length - 1 : 0]?.focus();
  }
  const toggle = () => menu.hidden ? open() : close();
  const keydown = (e) => {
    if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (menu.hidden) { open(e.key === 'ArrowUp' || e.key === 'End'); return; }
      const list = items(), i = list.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    }
    if (e.key === 'Tab') close(false);
    if (e.key === ' ' && e.target.matches('a[role="menuitem"]')) { e.preventDefault(); e.target.click(); }
  };
  const select = (e) => {
    const item = e.target.closest('[role="menuitem"]');
    if (!item || item.disabled) return;
    close(); if (onSelect) onSelect(item);
  };
  if (!manual) button.addEventListener('click', toggle);
  root.addEventListener('keydown', keydown);
  menu.addEventListener('click', select, { capture: true });
  const dispose = () => {
    close(false); button.removeEventListener('click', toggle); root.removeEventListener('keydown', keydown); menu.removeEventListener('click', select, true);
  };
  dispose.open = open; dispose.close = close; return dispose;
}

export function initAccountMenu(top) {
  const account = top.querySelector('.tb-account');
  if (!account || account.dataset.bound) return;
  account.dataset.bound = 'true';
  const button = account.querySelector('.tb-me'), menu = account.querySelector('[role="menu"]');
  bindMenu(account, button, menu, (item) => {
    if (item.hasAttribute('data-account-logout')) confirmLogout(false, button);
  });
}

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
  if (top.classList.contains('site')) {
    // Mobile navigation may wrap; anchor offsets and menus follow the actual header height.
    new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px')).observe(top);
  }
  initAccountMenu(top);
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
      updateAccount(top, user);
    }
  };
}
