// Агенты в админке: токены (выпустить, подключить одной командой, отозвать) и очередь правок.
// Агент не публикует: принятая правка становится версией черновика, публикует админ (решение 0003).
import { esc, h, req, toast, when, plural, walk, dialog, confirmDialog, AREAS, areaOf } from './ui.js';
import { diffCourses, renderDiff, words } from './versions.js';
import { loadSpecs } from './blocks.js';
import { renderBlock } from '../engine/blocks/index.js';
import { indexCourse } from '../engine/course.js';
import { initRich, rich } from '../engine/rich.js';

const STATUS = { pending: ['acc', 'ждёт'], accepted: ['good', 'принята'], rejected: ['', 'отклонена'], invalid: ['bad', 'ошибка схемы'] };

export async function pendingCount() {
  const r = await req('GET', '/api/admin/proposals?status=pending');
  return r.ok ? r.data.length : 0;
}

// ── токены ──
export function renderTokens(box, courses) {
  box.innerHTML = '<div class="ad-head"><div><h2 id="ad-tok-h">Токены агентов</h2>' +
    '<p class="ad-sub">Для API и MCP. Агент может читать курсы и предлагать правки, публиковать — нет.</p></div>' +
    '<button type="button" class="btn pri" id="tk-new" aria-expanded="false">+ Новый токен</button></div>' +
    '<div id="tk-form"></div><div id="tk-made"></div>' +
    '<div class="ad-table-w"><table class="ad-table"><thead><tr><th>Название</th><th>Права</th><th>Курсы</th><th>Токен</th><th>Использован</th><th></th></tr></thead><tbody id="tk-rows"><tr><td colspan="6">Загружаю…</td></tr></tbody></table></div>';
  const formBox = box.querySelector('#tk-form'), made = box.querySelector('#tk-made'), btn = box.querySelector('#tk-new');
  btn.addEventListener('click', () => {
    const open = !formBox.firstChild;
    btn.setAttribute('aria-expanded', String(open));
    formBox.innerHTML = '';
    if (!open) return;
    const f = h('form', 'ad-card tk-form');
    f.innerHTML = '<div class="ad-f"><label for="tk-name">Название</label><input id="tk-name" placeholder="например, claude-desktop" maxlength="60" autocomplete="off"></div>' +
      '<fieldset class="tk-rights"><legend>Права</legend>' +
      '<label class="ad-check-l"><input type="checkbox" checked disabled> Читать</label>' +
      '<label class="ad-check-l"><input type="checkbox" id="tk-propose" checked> Предлагать правки</label>' +
      '<label class="ad-check-l"><input type="checkbox" id="tk-create"> Создавать курсы</label></fieldset>' +
      '<div class="ad-f"><label for="tk-courses">Курсы</label><select id="tk-courses"><option value="">Все курсы</option>' +
      courses.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.title || c.id) + '</option>').join('') + '</select></div>' +
      '<button type="submit" class="btn pri">Создать</button>' +
      '<p class="ad-small ad-mut tk-note">Новый курс от агента тоже появляется черновиком: публикуешь его ты. В базе хранится только хеш токена.</p>';
    formBox.appendChild(f);
    const create = f.querySelector('#tk-create'), propose = f.querySelector('#tk-propose');
    create.addEventListener('change', () => { if (create.checked) propose.checked = true; });
    propose.addEventListener('change', () => { if (!propose.checked) create.checked = false; });
    f.querySelector('#tk-name').focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sel = f.querySelector('#tk-courses').value;
      const r = await req('POST', '/api/admin/tokens', { name: f.querySelector('#tk-name').value, propose: propose.checked, create: create.checked, courses: sel ? [sel] : [] });
      if (!r.ok) { toast(r.data.error || 'Ошибка ' + r.status, 'bad'); return; }
      formBox.innerHTML = '';
      btn.setAttribute('aria-expanded', 'false');
      showConnect(made, r.data.token, r.data.secret);
      loadTokens();
    });
  });
  loadTokens();

  async function loadTokens() {
    const r = await req('GET', '/api/admin/tokens');
    const rows = box.querySelector('#tk-rows');
    if (!r.ok) return;
    if (!r.data.length) { rows.innerHTML = '<tr><td colspan="6">Токенов пока нет. Выпусти первый — и подключи агента одной командой.</td></tr>'; return; }
    const title = (id) => { const c = courses.find((x) => x.id === id); return c ? c.title : id; };
    rows.innerHTML = r.data.map((t) => '<tr' + (t.revokedAt ? ' class="tk-off"' : '') + '><td><strong>' + esc(t.name) + '</strong><br><span class="ad-small ad-mut">выпустил ' + esc(t.createdBy) + ', ' + esc(when(t.createdAt)) + '</span></td>' +
      '<td><span class="tk-pills"><span class="ad-pill">читать</span>' + (t.canPropose ? '<span class="ad-pill acc">предлагать</span>' : '') + (t.canCreate ? '<span class="ad-pill agent">создавать курсы</span>' : '') + '</span></td>' +
      '<td>' + (t.courses.length ? t.courses.map((c) => esc(title(c))).join(', ') : 'все') + '</td>' +
      '<td><code class="tk-mask">cit_••••' + esc(t.tail) + '</code></td>' +
      '<td class="ad-mut">' + esc(t.lastUsedAt ? when(t.lastUsedAt) : 'ещё не использован') + '</td>' +
      '<td class="ad-r">' + (t.revokedAt ? '<span class="ad-pill">отозван</span> <button type="button" class="btn ad-danger" data-del="' + t.id + '" data-name="' + esc(t.name) + '">Удалить</button>' : '<button type="button" class="btn ad-danger" data-revoke="' + t.id + '" data-name="' + esc(t.name) + '">Отозвать</button>') + '</td></tr>').join('');
    rows.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить токен «' + b.dataset.name + '»?', 'Вместе с ним из списка исчезнут его решённые правки. Изменения, уже принятые в курс, останутся.', 'Удалить', true))) return;
      const r2 = await req('DELETE', '/api/admin/tokens/' + b.dataset.del);
      if (!r2.ok) { toast(r2.data.error || 'Ошибка ' + r2.status, 'bad'); return; }
      toast('Токен удалён', 'good');
      loadTokens();
    }));
    rows.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Отозвать токен «' + b.dataset.name + '»?', 'Агент с этим токеном сразу потеряет доступ. Его правки останутся в очереди.', 'Отозвать', true))) return;
      const r2 = await req('POST', '/api/admin/tokens/' + b.dataset.revoke + '/revoke', {});
      if (!r2.ok) { toast(r2.data.error || 'Ошибка ' + r2.status, 'bad'); return; }
      toast('Токен отозван', 'good');
      loadTokens();
    }));
  }
}

// Как подключить агента: у каждого клиента своя команда или свой файл настроек.
// У всех один и тот же сервер: Streamable HTTP на /mcp и токен в заголовке Authorization.
function connectTabs(url, secret) {
  const auth = 'Bearer ' + secret;
  const config = (entry) => JSON.stringify({ mcpServers: { citadel: Object.assign(entry, { headers: { Authorization: auth } }) } }, null, 2);
  return [
    { id: 'cc', label: 'Claude Code', hint: 'Выполни команду в терминале на своём ПК. Claude Code сохранит адрес и токен у себя в конфиге.',
      text: 'claude mcp add --scope user --transport http citadel ' + url + ' --header "Authorization: ' + auth + '"' },
    { id: 'codex', label: 'Codex CLI', hint: 'Codex берёт токен из переменной окружения. Выполни первую команду в PowerShell (в Linux и macOS вместо неё — export), открой новый терминал и выполни вторую. Если команда codex не найдена, а Codex стоит приложением, открой соседнюю вкладку.',
      text: 'setx CITADEL_TOKEN "' + secret + '"\ncodex mcp add citadel --url ' + url + ' --bearer-token-env-var CITADEL_TOKEN' },
    // Приложение не добавляет codex в PATH, зато читает тот же config.toml, что и CLI.
    { id: 'codex-app', label: 'Приложение Codex', hint: 'Терминал не нужен. Добавь в конец файла ~/.codex/config.toml (в Windows — %USERPROFILE%\\.codex\\config.toml) и полностью перезапусти приложение. Если раздел citadel в файле уже есть, замени его.',
      text: '[mcp_servers.citadel]\nurl = "' + url + '"\n\n[mcp_servers.citadel.http_headers]\nAuthorization = "' + auth + '"' },
    { id: 'cursor', label: 'Cursor', hint: 'Добавь в файл ~/.cursor/mcp.json.', text: config({ url }) },
    { id: 'antigravity', label: 'Antigravity', hint: 'Добавь в файл ~/.gemini/config/mcp_config.json и обнови список серверов в настройках MCP.', text: config({ serverUrl: url }) },
    { id: 'gemini', label: 'Gemini CLI', hint: 'Добавь в файл ~/.gemini/settings.json.', text: config({ httpUrl: url }) },
    { id: 'other', label: 'Другой MCP-клиент', hint: 'Настройки для клиента с поддержкой Streamable HTTP. Названия полей у клиентов могут отличаться.', text: config({ type: 'http', url }) }
  ];
}

// Токен показывается один раз и больше нигде не хранится — ни на сервере, ни в странице.
function showConnect(box, token, secret) {
  const url = location.origin + '/mcp';
  const tabs = connectTabs(url, secret);
  box.innerHTML = '';
  const s = h('section', 'ad-card tk-made');
  s.setAttribute('aria-labelledby', 'tk-made-h');
  s.innerHTML = '<div class="ad-row"><div class="tk-made-t"><h3 id="tk-made-h">Токен ' + esc(token.name) + ' создан — подключи агента</h3>' +
    '<p class="ad-sub">Подойдёт любой агент с поддержкой MCP. Токен сохранится в его настройках, вводить его в чат не нужно.</p></div>' +
    '<span class="ad-sp"></span><button type="button" class="btn" id="tk-done">Готово</button></div>' +
    '<div class="tk-tabs" role="tablist" aria-label="Агент">' + tabs.map((t) => '<button type="button" role="tab" aria-selected="false" data-t="' + t.id + '">' + esc(t.label) + '</button>').join('') + '</div>' +
    '<p class="ad-sub tk-hint"></p><div class="tk-cmd"><pre></pre><button type="button" class="btn" id="tk-copy">Скопировать</button></div>' +
    '<ul class="tk-facts"><li><strong>Что агент сможет</strong><br><span>' + facts(token) + '</span></li>' +
    '<li><strong>Чего не сможет</strong><br><span>публиковать, видеть прогресс учеников, управлять токенами</span></li>' +
    '<li><strong>Токен виден один раз</strong><br><span>потерял — отзови и выпусти новый</span></li></ul>';
  box.appendChild(s);
  const pre = s.querySelector('pre');
  let text = '';
  const show = (id) => {
    const t = tabs.find((x) => x.id === id);
    text = t.text;
    pre.textContent = text;
    s.querySelector('.tk-hint').textContent = t.hint;
    s.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === id)));
  };
  show(tabs[0].id);
  s.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.t)));
  s.querySelector('#tk-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast('Скопировано', 'good'); } catch (e) { toast('Не скопировалось: выдели текст и скопируй вручную', 'warn'); }
  });
  s.querySelector('#tk-done').addEventListener('click', () => { box.innerHTML = ''; });
  s.scrollIntoView({ block: 'nearest' });
}

function facts(t) {
  const can = ['читать курсы и схему блоков'];
  if (t.canPropose) can.push('предлагать правки');
  if (t.canCreate) can.push('создавать курсы');
  return can.join(', ') + (t.canPropose ? ' — всё черновиками' : '') + (t.courses.length ? '; только ' + t.courses.join(', ') : '');
}

// ── очередь правок ──
export function renderAgents(main, selected, onDecided) {
  const page = h('div', 'ad-page');
  main.appendChild(page);
  page.innerHTML = '<div><h1>Правки агентов</h1><p class="ad-sub">Здесь решаешь ты. ИИ-агент присылает изменение курса, но сам ничего менять не может.</p>' +
    '<ol class="ag-steps"><li><b>Прочитай</b> правку так, как её увидит ученик.</li><li><b>Прими или отклони.</b> Принятая правка попадает в черновик, ученики её пока не видят.</li><li><b>Опубликуй</b> черновик, и правка появится у учеников.</li></ol></div>' +
    '<div class="ad-split ag-split"><section class="ad-card ag-queue" aria-label="Очередь"><div class="lbl v-hh ag-qh"><span>Очередь</span><span id="ag-n"></span></div><ul id="ag-list"><li class="ad-pad">Загружаю…</li></ul></section>' +
    '<section class="ag-detail" id="ag-detail" aria-label="Правка"></section></div>';
  let list = [];
  load();

  async function load() {
    await loadSpecs();
    const r = await req('GET', '/api/admin/proposals');
    if (!r.ok) { toast('Не загрузилась очередь: ' + r.status, 'bad'); return; }
    list = r.data;
    const pending = list.filter((p) => p.status === 'pending').length;
    page.querySelector('#ag-n').textContent = pending ? pending + ' ' + plural(pending, 'ждёт', 'ждут', 'ждут') : '';
    if (!list.length) {
      page.querySelector('#ag-list').innerHTML = '<li class="ad-pad ad-mut">Правок пока нет. Выпусти токен на странице «Пользователи и токены» и подключи агента.</li>';
      page.querySelector('#ag-detail').innerHTML = '';
      return;
    }
    if (!list.some((p) => p.id === selected)) selected = list[0].id;
    drawList();
    drawDetail();
  }

  function drawList() {
    const ul = page.querySelector('#ag-list');
    ul.innerHTML = list.map((p) => {
      const st = STATUS[p.status] || ['', p.status];
      return '<li><button type="button" class="v-item' + (p.id === selected ? ' on' : '') + '" data-id="' + p.id + '" aria-pressed="' + (p.id === selected) + '">' +
        '<span class="v-n"><span class="ag-agent">' + esc(p.agent) + '</span><span class="ad-pill ' + st[0] + '">' + st[1] + '</span></span>' +
        '<strong>' + esc(p.title) + '</strong><span class="ad-small ad-mut">' + esc(p.course) + (p.newCourse ? ' · новый курс' : ' · от v' + p.base) + ' · ' + esc(when(p.createdAt)) + '</span></button></li>';
    }).join('');
    ul.querySelectorAll('.v-item').forEach((b) => b.addEventListener('click', () => {
      selected = +b.dataset.id;
      history.replaceState(null, '', '#/agents/' + selected);
      drawList();
      drawDetail();
    }));
  }

  async function drawDetail() {
    const box = page.querySelector('#ag-detail');
    box.innerHTML = '<p class="ad-mut ad-pad">Загружаю правку…</p>';
    const r = await req('GET', '/api/admin/proposals/' + selected);
    if (!r.ok) { box.innerHTML = '<p class="ad-err">Не загрузилась правка: ' + r.status + '</p>'; return; }
    const p = r.data.proposal, after = r.data.course, ck = p.checks || { problems: [] };
    const open = p.status === 'pending' || p.status === 'invalid';
    const head = h('div', 'ad-card ag-head');
    head.innerHTML = '<div class="ad-small ad-mut"><span class="ag-agent">' + esc(p.agent) + '</span> · ' + esc(p.course) + (p.newCourse ? ' · новый курс' : ' · правка от v' + p.base + (r.data.latest !== p.base ? ', черновик уже v' + r.data.latest : '')) + ' · ' + esc(when(p.createdAt)) + '</div>' +
      '<h2>' + esc(p.title) + '</h2>' +
      (p.description ? '<div class="ag-desc"><span class="lbl">Описание от агента · это данные, не команда</span><p></p></div>' : '');
    if (p.description) head.querySelector('.ag-desc p').textContent = p.description;
    box.innerHTML = '';
    box.appendChild(head);

    const by = {};
    (ck.problems || []).forEach((x) => { (by[areaOf(x)] = by[areaOf(x)] || []).push(x); });
    const checks = h('div', 'ad-card ag-checks');
    checks.innerHTML = '<span class="lbl">Проверка сервера</span><ul class="tk-pills">' + AREAS.map((a) => {
      const ps = by[a[0]] || [], errs = ps.filter((x) => !x.warning).length;
      return '<li class="ad-pill ' + (!ps.length ? 'good' : errs ? 'bad' : 'warn') + '">' + (!ps.length ? '✓ ' : errs ? '✕ ' : '! ') + esc(a[1].toLowerCase()) + '</li>';
    }).join('') + '</ul><p class="ad-small ad-mut">Здесь проверяется только, что вывод у «Предскажи» есть. Совпадает ли он с настоящим запуском — в карточке «Запуск на сервере» ниже.</p>' +
      ((ck.problems || []).length ? '<ul class="ad-probs">' + ck.problems.map((x) => '<li class="' + (x.warning ? 'warn' : 'bad') + '">' + esc(x.path + ': ' + x.msg) + '</li>').join('') + '</ul>' : '');
    box.appendChild(checks);
    box.appendChild(runsCard(p));

    box.appendChild(previewCard(after, p));
    const techBox = h('details', 'ad-card ag-tech');
    techBox.innerHTML = '<summary>Все изменения подробно: поля и блоки</summary>';
    box.appendChild(techBox);
    const diffBox = h('div', 'ag-diff');
    techBox.appendChild(diffBox);
    if (p.newCourse) {
      diffBox.innerHTML = '<div class="ad-card v-sum"><strong>Новый курс «' + esc(after.title) + '»</strong><span class="ad-sp"></span><span class="ad-pill">' + esc(after.id) + '</span></div>';
      renderDiff(diffBox, diffCourses({ root: [], glossary: {} }, after), '');
    } else {
      const base = await req('GET', '/api/admin/courses/' + encodeURIComponent(p.course) + '/versions/' + p.base);
      if (base.ok) {
        const d = diffCourses(base.data.course, after);
        diffBox.innerHTML = '<div class="ad-card v-sum"><strong>v' + p.base + ' → правка агента</strong></div>' + (d.length ? '' : '<p class="ad-mut ad-pad">Правка ничего не меняет.</p>');
        renderDiff(diffBox, d, '');
      } else diffBox.innerHTML = '<p class="ad-err">Не загрузилась v' + p.base + '</p>';
    }

    const act = h('div', 'ad-card ag-act');
    if (open) {
      act.innerHTML = '<div class="ad-f"><label for="ag-cm">Что исправить · нужно, только если отклоняешь</label><textarea id="ag-cm" rows="2"></textarea></div>' +
        '<div class="ad-row"><button type="button" class="btn pri" id="ag-ok"' + (p.status === 'invalid' ? ' disabled title="Правку с ошибкой схемы принять нельзя"' : '') + '>Принять в черновик</button>' +
        '<button type="button" class="btn" id="ag-no">Отклонить</button><span class="ad-sp"></span>' +
        (p.newCourse ? '' : '<a class="btn" href="#/c/' + esc(p.course) + '/versions">Сравнить с публикацией</a>') + '</div>' +
        '<p class="ad-small ad-mut">Агент узнает решение сам: инструмент <code>proposal_status</code> вернёт статус и твой комментарий.' + (p.status === 'invalid' ? ' Правку с ошибкой схемы принять нельзя: отклони с комментарием, агент пришлёт исправленную.' : '') + '</p>';
      act.querySelector('#ag-ok').addEventListener('click', async () => {
        const r2 = await req('POST', '/api/admin/proposals/' + p.id + '/accept', {});
        if (!r2.ok) {
          if (r2.data.check) dialog('Правка не ложится на черновик', '<p>' + esc(r2.data.error) + '</p>', [{ label: 'Понятно' }]);
          else toast(r2.data.error || 'Ошибка ' + r2.status, 'bad');
          return;
        }
        toast('Принята в черновик: v' + r2.data.version + (r2.data.rebased ? ' (применена поверх нового черновика)' : '') + '. Опубликуй, когда проверишь.', 'good');
        onDecided();
        load();
      });
      act.querySelector('#ag-no').addEventListener('click', async () => {
        const comment = act.querySelector('#ag-cm').value.trim();
        if (!comment && !(await confirmDialog('Отклонить без комментария?', 'Агент не узнает, что исправить.', 'Отклонить'))) return;
        const r2 = await req('POST', '/api/admin/proposals/' + p.id + '/reject', { comment });
        if (!r2.ok) { toast(r2.data.error || 'Ошибка ' + r2.status, 'bad'); return; }
        toast('Отклонена', 'good');
        onDecided();
        load();
      });
    } else {
      act.innerHTML = '<p>' + (p.status === 'accepted'
        ? 'Принята ' + esc(when(p.decidedAt)) + ' (' + esc(p.decidedBy) + '): черновик v' + p.version + '. <a href="#/c/' + esc(p.course) + '/versions">Версии курса</a>'
        : 'Отклонена ' + esc(when(p.decidedAt)) + ' (' + esc(p.decidedBy) + ')' + (p.comment ? ': «' + esc(p.comment) + '»' : ' без комментария')) + '</p>';
    }
    box.appendChild(act);
  }
}

// Правка глазами ученика: узлы, которые она добавила или изменила, нарисованные движком.
function changedNodes(course, p) {
  const ids = new Set();
  const take = (node) => { ids.add(node.id); (node.children || []).forEach(take); };
  (Array.isArray(p.changes) ? p.changes : []).forEach((c) => { if (c.op === 'put_node' && c.node) take(c.node); });
  const out = [];
  walk(course.root, (n) => { if (ids.has(n.id) && (n.blocks || []).length) out.push(n); });
  return out;
}

function previewCard(course, p) {
  const card = h('section', 'ad-card ag-preview');
  const nodes = changedNodes(course, p);
  if (!nodes.length) {
    card.innerHTML = '<span class="lbl">Как увидит ученик</span><p class="ad-small ad-mut">В этой правке нет текста урока: смотри подробные изменения ниже.</p>';
    return card;
  }
  card.innerHTML = '<span class="lbl">Как увидит ученик · ' + nodes.length + ' ' + plural(nodes.length, 'часть', 'части', 'частей') + '</span>';
  const page = h('div', 'ed-page');
  page.id = 'page';
  card.appendChild(page);
  initRich(indexCourse(course));
  const ctx = { tool: course.tool || { name: '', version: '' }, csLabel: course.labels && course.labels.cs, label: 'Вопрос', store: { state: () => 0, answer() {} }, onSolve() {} };
  nodes.forEach((n, k) => {
    const part = h('details', 'ag-part');
    part.open = k === 0;
    part.innerHTML = '<summary>' + esc(n.title) + '</summary>';
    if (n.lead) part.appendChild(h('p', 'lead', rich(n.lead)));
    n.blocks.forEach((b, i) => {
      try {
        const bctx = b.type === 'hands' ? Object.assign({}, ctx, { store: () => ctx.store }) : Object.assign({}, ctx, { label: 'Вопрос ' + (i + 1) });
        part.appendChild(renderBlock(b, bctx));
      } catch (e) {
        part.appendChild(h('div', 'callout warn', '<b>Блок ' + (i + 1) + ' не рисуется</b>' + esc(e.message)));
      }
    });
    page.appendChild(part);
  });
  return card;
}

// Запуск «Предскажи» на сервере (решение 0013): сервер прогоняет блоки, которые правка добавила
// или изменила, и сравнивает вывод с тем, что прислал агент.
function runsCard(p) {
  const card = h('div', 'ad-card ag-checks');
  const runs = Array.isArray(p.runs) ? p.runs : null;
  if (!runs) {
    card.innerHTML = '<span class="lbl">Запуск на сервере</span><p class="ad-small ad-mut">' +
      (p.status === 'pending' ? 'Ещё не запускалось: сервер прогоняет «Предскажи» в фоне, обнови правку через минуту. Если запуск на сервере не настроен, этой проверки не будет.' : 'Не запускалось.') + '</p>';
    return card;
  }
  if (!runs.length) {
    card.innerHTML = '<span class="lbl">Запуск на сервере</span><p class="ad-small ad-mut">Правка не добавляет и не меняет блоков «Предскажи и запусти».</p>';
    return card;
  }
  const pill = { match: ['good', '✓ вывод совпал'], differs: ['warn', '! вывод другой'], error: ['bad', '✕ не запустилось'] };
  card.innerHTML = '<span class="lbl">Запуск на сервере · ' + runs.length + ' ' + plural(runs.length, 'блок', 'блока', 'блоков') + ' «Предскажи»</span><div class="ag-runs"></div>';
  const list = card.querySelector('.ag-runs');
  runs.forEach((r) => {
    const st = pill[r.status] || ['', r.status];
    const row = h('div', 'ag-run');
    row.innerHTML = '<div class="ad-row"><span class="ad-pill ' + st[0] + '">' + st[1] + '</span><span class="ad-small ad-mut">узел ' + esc(r.node) + ', блок ' + (r.block + 1) + (r.version ? ' · ' + esc(r.version) : '') + '</span></div>' +
      (r.error ? '<p class="ad-err">' + esc(r.error) + '</p>' : '') +
      (r.status === 'differs' ? '<div class="v-body v-fields"></div><p class="ad-small ad-mut">Зачёркнуто — вывод агента, подсвечено — что получилось на сервере.</p>' : '');
    const d = row.querySelector('.v-body');
    if (d) d.innerHTML = words(String(r.expected || '').replace(/\n+$/, ''), String(r.got || '').replace(/\n+$/, ''));
    list.appendChild(row);
  });
  return card;
}
