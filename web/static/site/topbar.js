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
  window.addEventListener('resize', () => { for (const m of openMenus) m.close(); });
  document.addEventListener('scroll', (e) => { for (const m of openMenus) if (!m.menu.contains(e.target)) m.close(); }, true);
}

// Viewport coordinates for every shared menu, including buttons inside scrollers.
export function menuPosition(button, size, viewport, margin = 8, gap = 6) {
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
  const below = button.bottom + gap;
  return {
    left: Math.max(margin, Math.min(button.right - width, viewport.width - margin - width)),
    top: Math.max(margin, Math.min(below + height <= viewport.height - margin ? below : button.top - gap - height, viewport.height - margin - height)),
    width, height
  };
}

// Shared keyboard menu for the avatar and admin row actions.
export function bindMenu(root, button, menu, onSelect, manual = false) {
  initMenuListeners();
  const entry = { root, menu, close };
  const items = () => [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')].filter((item) => item.getClientRects().length);
  function close(focus = true) {
    if (menu.hidden) return;
    openMenus.delete(entry);
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus && button.isConnected) button.focus({ preventScroll: true });
  }
  function open(last = false) {
    for (const m of openMenus) m.close(false);
    openMenus.add(entry);
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    menu.style.position = 'fixed'; menu.style.inset = 'auto';
    menu.style.maxWidth = 'calc(100vw - 16px)'; menu.style.maxHeight = 'calc(100dvh - 16px)';
    const p = menuPosition(button.getBoundingClientRect(), menu.getBoundingClientRect(), { width: document.documentElement.clientWidth, height: window.innerHeight });
    menu.style.left = p.left + 'px'; menu.style.top = p.top + 'px';
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
  if (!top.classList.contains('ad-top')) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px')).observe(top);
  }
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

// Карточки на сегодня: единственный счётчик у «Повторений».
export function setDue(top, due) {
  const badge = top.querySelector('.nav-badge');
  if (badge) { badge.textContent = due || ''; badge.hidden = !due; }
}

// Страницы сайта: тема меняется на месте, счётчик карточек — после ответа API.
export function siteTop(current) {
  const top = document.getElementById('top');
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
      setDue(top, due);
      updateAccount(top, user);
    }
  };
}
