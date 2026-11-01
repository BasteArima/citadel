// Раздел «Проекты»: плитки проектов (решение 0016).
import { api, esc, today } from './shared.js';
import { initSiteSearch } from './search.js';
import { siteTop } from './topbar.js';
import { projectTile, soonProjectTile } from './projects-ui.js';

initSiteSearch();

const app = document.getElementById('app');
const top = siteTop('projects');

try {
  const [user, ov] = await Promise.all([api('/api/me'), api('/api/overview?today=' + today())]);
  top.update(user, ov.courses.reduce((s, c) => s + c.due, 0));
  const projects = ov.courses.filter((c) => c.type === 'project');
  const soon = (ov.soon || []).filter((c) => c.type === 'project');
  app.innerHTML = '<main class="site-main">' +
    '<div><h1>Проекты</h1><p class="site-sub" style="max-width:640px">Ты получаешь задачу, как на работе, разбираешься сам и пишешь код своими руками. Уроки курсов открываешь, когда они нужны для задачи.</p></div>' +
    (projects.length || soon.length ? '<div class="tiles">' + projects.map(projectTile).join('') + soon.map(soonProjectTile).join('') + '</div>'
      : '<div class="empty">Проектов пока нет.</div>') +
    '</main>';
} catch (e) {
  app.innerHTML = '<main class="site-main"><p class="site-err">Не удалось загрузить проекты: ' + esc(e.message) + '</p></main>';
}
