import { h } from './ui.js';
import { bindMenu } from '../site/topbar.js';

// Start with every section visible; move the rightmost links only on overflow.
export function adminNavigation(top, items, current) {
  const nav = top.querySelector('.tb-nav'), inner = top.querySelector('.ad-top-inner');
  nav.id = 'admin-nav'; nav.setAttribute('aria-label', 'Админка');
  nav.innerHTML = items.map(([key, href, title]) => '<a href="' + href + '"' + (key === current ? ' aria-current="page"' : '') + '>' + title + '</a>').join('');
  const links = [...nav.children];
  const more = h('div', 'tb-account ad-actions-menu ad-nav-more', '<button type="button" class="btn" aria-haspopup="menu" aria-expanded="false">Ещё ▾</button><div class="tb-account-menu" role="menu" aria-label="Разделы админки" hidden></div>');
  nav.append(more);
  const button = more.firstElementChild, menu = more.lastElementChild;
  const binding = bindMenu(more, button, menu);
  const fit = () => {
    binding.close(false);
    links.forEach((link) => { link.removeAttribute('role'); link.removeAttribute('tabindex'); nav.insertBefore(link, more); });
    const mobile = matchMedia('(max-width: 879px)').matches;
    more.hidden = true;
    if (mobile) return;
    const move = (link) => { link.setAttribute('role', 'menuitem'); link.tabIndex = -1; menu.prepend(link); };
    for (let i = links.length - 1; i >= 0 && inner.scrollWidth > inner.clientWidth + 1; i--) {
      more.hidden = false; move(links[i]);
    }
    button.classList.toggle('is-active', !!menu.querySelector('[aria-current=page]'));
  };
  const resize = new ResizeObserver(fit);
  resize.observe(inner); resize.observe(nav); resize.observe(top.querySelector('.tb-tools'));
  fit();
  return () => { binding(); resize.disconnect(); };
}
