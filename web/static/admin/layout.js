import { h } from './ui.js';

// One layout on every routed admin main; field stacks are independent of it.
export function adminLayout(view) {
  if (['passport', 'access'].includes(view)) return 'ad-form';
  if (['edit', 'questions', 'glossary', 'versions', 'agents'].includes(view)) return 'ad-work';
  if (view === 'audio') return 'ad-split';
  return 'ad-list';
}

export function workPage(page, splitSelector, detailSelector) {
  const split = page.querySelector(splitSelector), content = h('div', 'ad-work-content');
  content.append(page.firstElementChild, page.querySelector(detailSelector));
  split.classList.remove('ad-split', 'ad-columns'); split.append(content);
}

// Keep a single 52px row while the rendered crumbs, tabs and actions fit.
export function courseBarLayout(bar, nav) {
  const crumbs = bar.querySelector('.ad-crumbs'), actions = bar.querySelector('.ad-course-actions');
  let alive = true;
  const fit = () => {
    if (!alive) return;
    bar.classList.remove('is-wrapped');
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    const needed = crumbs.getBoundingClientRect().width + nav.scrollWidth + actions.getBoundingClientRect().width + 2 * gap;
    bar.classList.toggle('is-wrapped', matchMedia('(max-width: 879px)').matches || needed > bar.clientWidth + 1);
  };
  const observer = new ResizeObserver(fit);
  [bar, crumbs, actions, ...nav.children].forEach((element) => observer.observe(element));
  document.fonts?.ready.then(fit);
  fit();
  const dispose = () => { alive = false; observer.disconnect(); };
  dispose.update = fit; return dispose;
}

// A card row always has two grid items: its generated label and one value box.
// Moving nodes retains action listeners and keeps rich values out of extra rows.
export function cardValue(cell) {
  const value = h('div', 'ad-cell-value'); value.append(...cell.childNodes); cell.append(value);
}
