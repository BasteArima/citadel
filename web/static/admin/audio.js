// Озвучка курса (docs/dev/AUDIO.md): записи частей по опубликованному тексту и словарь произношения.
// Записи делает сервер фоновой задачей; словарь и голос — поля паспорта (speech), правятся в черновике
// и вступают в силу после публикации: тогда части, где встречается слово, станут «устарело».
import { esc, h, toast, req, when, plural } from './ui.js';
import { draft, touch } from './draft.js';

const VOICES = [['ru-RU-SvetlanaNeural', 'Светлана'], ['ru-RU-DmitryNeural', 'Дмитрий']];
const STATUS = { ok: ['good', 'записано'], stale: ['warn', 'устарело — текст изменился'], none: ['', 'нет записи'] };

export function renderAudio(main, courseBar) {
  const c = draft.course;
  const { off } = courseBar(main, '<a href="#/c/' + esc(draft.id) + '/edit">' + esc(c.title) + '</a> / <strong>Озвучка</strong>');
  const page = h('div', 'ad-page');
  main.appendChild(page);
  page.innerHTML = '<div class="ad-head"><div><span class="ad-sub">' + esc(c.title) + '</span><h1>Озвучка</h1>' +
    '<p class="ad-sub">Записи делаются по опубликованному тексту. Ученик слышит запись, только если она совпадает с текстом; иначе — голос браузера.</p></div>' +
    '<div class="ad-acts" id="au-acts"></div></div>' +
    '<div id="au-job" hidden></div>' +
    '<section class="au-stats" aria-label="Сводка" id="au-stats"></section>' +
    '<div class="ad-split au-split"><div class="ad-table-w"><table class="ad-table au-table"><thead><tr><th>Часть</th><th>Длина</th><th>Запись</th><th></th></tr></thead>' +
    '<tbody id="au-rows"><tr><td colspan="4">Загружаю…</td></tr></tbody></table></div>' +
    '<section class="ad-card ad-pad ad-side-form au-lex" aria-labelledby="au-lex-h"></section></div>';
  const rows = page.querySelector('#au-rows'), acts = page.querySelector('#au-acts'), stats = page.querySelector('#au-stats'), jobBox = page.querySelector('#au-job');
  const audio = new Audio();
  let playing = null, data = null, timer = 0, alive = true;
  audio.addEventListener('ended', () => { playing = null; drawRows(); });

  load();
  drawLexicon(page.querySelector('.au-lex'));
  return () => { alive = false; clearTimeout(timer); audio.pause(); off(); };

  async function load() {
    const r = await req('GET', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/audio');
    if (!alive) return;
    if (!r.ok) { rows.innerHTML = '<tr><td colspan="4">Не загрузилось: ' + esc(r.data.error || r.status) + '</td></tr>'; return; }
    data = r.data;
    draw();
    clearTimeout(timer);
    if (data.job.running) timer = setTimeout(load, 2000);
  }

  function draw() {
    const parts = data.parts, job = data.job;
    const ok = parts.filter((p) => p.status === 'ok'), todo = parts.filter((p) => p.status !== 'ok');
    const sec = ok.reduce((s, p) => s + p.dur, 0);
    const voice = (VOICES.find((v) => v[0] === data.voice) || [0, data.voice || '—'])[1];
    stats.innerHTML = stat('Записано', ok.length + ' из ' + parts.length) + stat('Устарело', parts.filter((p) => p.status === 'stale').length) +
      stat('Всего звучит', Math.round(sec / 60) + ' мин') + stat('Голос · edge-tts', esc(voice));

    if (!data.published) acts.innerHTML = '<span class="ad-mut">Курс не опубликован: озвучивается опубликованный текст.</span>';
    else if (!data.tts) acts.innerHTML = '<span class="ad-mut">Синтез речи не настроен на сервере: нужен edge-tts (<code>CITADEL_TTS</code>).</span>';
    else if (job.running) acts.innerHTML = '<button type="button" class="btn" id="au-cancel">Записывается ' + job.done + ' из ' + job.total + '… · отменить</button>';
    else acts.innerHTML = '<button type="button" class="btn pri" id="au-make"' + (todo.length ? '' : ' disabled') + '>' +
      (todo.length ? 'Озвучить изменённое · ' + todo.length + ' ' + plural(todo.length, 'часть', 'части', 'частей') : 'Всё записано') + '</button>';
    const mk = acts.querySelector('#au-make'), cn = acts.querySelector('#au-cancel');
    if (mk) mk.addEventListener('click', () => make());
    if (cn) cn.addEventListener('click', async () => { await req('POST', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/audio/cancel'); load(); });

    jobBox.hidden = !job.running && !job.errors.length;
    jobBox.className = 'ad-card ad-pad au-job' + (job.errors.length ? ' bad' : '');
    jobBox.innerHTML = (job.running ? '<p><b>Сейчас:</b> ' + esc(job.current || '…') + '</p><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + job.total + '" aria-valuenow="' + job.done + '"><i style="width:' + Math.round(job.done / job.total * 100) + '%"></i></div>' : '') +
      (job.errors.length ? '<p><b>Не записалось:</b></p><ul>' + job.errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '');
    drawRows();
  }

  function drawRows() {
    const parts = data.parts, job = data.job;
    if (!parts.length) { rows.innerHTML = '<tr><td colspan="4">' + (data.published ? 'В курсе нет частей теории: озвучиваются только они.' : 'Сначала опубликуй курс.') + '</td></tr>'; return; }
    rows.innerHTML = parts.map((p) => {
      const busy = job.running && job.node === p.node;
      const st = busy ? ['acc', 'записывается…'] : STATUS[p.status];
      const listen = p.url ? '<button type="button" class="btn au-play" data-url="' + esc(p.url) + '">' + (playing === p.url ? 'Пауза' : 'Послушать') + '</button>' : '';
      const rec = data.tts && data.published && !job.running ? '<button type="button" class="btn au-rec" data-node="' + esc(p.node) + '">' + (p.status === 'none' ? 'Озвучить' : 'Переписать') + '</button>' : '';
      return '<tr><td><b>' + esc(p.title) + '</b><br><span class="ad-small ad-mut">Урок ' + p.lesson + ' · часть ' + p.index + ' · ' + p.chars.toLocaleString('ru') + ' симв. · ' +
        p.chapters + ' ' + plural(p.chapters, 'глава', 'главы', 'глав') + '</span></td>' +
        '<td class="ad-mut">' + (p.dur ? clock(p.dur) : '—') + '</td>' +
        '<td><span class="ad-pill ' + st[0] + '"' + (p.madeAt ? ' title="записано ' + esc(when(p.madeAt)) + '"' : '') + '>' + st[1] + '</span></td>' +
        '<td class="ad-r au-btns">' + listen + rec + '</td></tr>';
    }).join('');
    rows.querySelectorAll('.au-play').forEach((b) => b.addEventListener('click', () => {
      const url = b.dataset.url;
      if (playing === url) { audio.pause(); playing = null; }
      else { audio.src = url; audio.play(); playing = url; }
      drawRows();
    }));
    rows.querySelectorAll('.au-rec').forEach((b) => b.addEventListener('click', () => make([b.dataset.node])));
  }

  async function make(nodes) {
    const r = await req('POST', '/api/admin/courses/' + encodeURIComponent(draft.id) + '/audio', { nodes: nodes || [] });
    if (!r.ok) { toast(r.data.error || 'Ошибка ' + r.status, 'bad'); return; }
    toast('Озвучка началась: ' + r.data.total + ' ' + plural(r.data.total, 'часть', 'части', 'частей'), 'good');
    load();
  }

  // ── словарь произношения и голос: в черновике ──
  function drawLexicon(box) {
    const sp = () => { c.speech = c.speech || {}; c.speech.lexicon = c.speech.lexicon || {}; return c.speech; };
    // пустые настройки не оставляем в курсе: без них — голос по умолчанию и словаря нет
    const tidy = () => {
      if (!c.speech.voice) delete c.speech.voice;
      if (c.speech.lexicon && !Object.keys(c.speech.lexicon).length) delete c.speech.lexicon;
      if (!Object.keys(c.speech).length) delete c.speech;
    };
    const lex = (c.speech && c.speech.lexicon) || {};
    const keys = Object.keys(lex).sort((a, b) => a.localeCompare(b, 'ru'));
    const voice = (c.speech && c.speech.voice) || VOICES[0][0];
    box.innerHTML = '<div class="ad-row"><h2 id="au-lex-h">Словарь произношения</h2></div>' +
      '<p class="ad-sub">Как писать → как читать. Слово заменяется целиком и с учётом регистра. Правка идёт в черновик; после публикации устареют части, где слово встречается.</p>' +
      '<ul class="au-words">' + keys.map((k) => '<li data-k="' + esc(k) + '"><code>' + esc(k) + '</code><span aria-hidden="true">→</span>' +
        '<input value="' + esc(lex[k]) + '" aria-label="Как читается ' + esc(k) + '">' +
        '<button type="button" class="ad-ib au-say" aria-label="Послушать, как читается ' + esc(k) + '">' + SOUND + '</button>' +
        '<button type="button" class="ad-ib au-del" aria-label="Убрать ' + esc(k) + '">×</button></li>').join('') + '</ul>' +
      (keys.length ? '' : '<p class="ad-small ad-mut">Словарь пуст. Добавь английские слова и идентификаторы, которые голос читает неверно: Go → гоу, nil → нил.</p>') +
      '<form class="au-add"><input name="from" placeholder="Notifier" aria-label="Как пишется"><span aria-hidden="true">→</span><input name="to" placeholder="нотифайер" aria-label="Как читается">' +
      '<button type="submit" class="btn">+ Слово</button></form>' +
      '<div class="ad-f"><label for="au-try">Проверить фразу со словарём черновика</label><div class="au-try"><input id="au-try" maxlength="300" placeholder="Интерфейс Notifier в Go возвращает nil">' +
      '<button type="button" class="btn au-try-b">' + SOUND + ' Слушать</button></div></div>' +
      '<div class="ad-f"><label for="au-voice">Голос</label><select id="au-voice">' + VOICES.map((v) => '<option value="' + v[0] + '"' + (v[0] === voice ? ' selected' : '') + '>' + v[1] + ' · ' + v[0] + '</option>').join('') +
      (VOICES.some((v) => v[0] === voice) ? '' : '<option value="' + esc(voice) + '" selected>' + esc(voice) + '</option>') + '</select>' +
      '<span class="ad-small ad-mut">Смена голоса после публикации делает устаревшими все записи.</span></div>';

    box.querySelectorAll('.au-words li').forEach((li) => {
      const k = li.dataset.k, input = li.querySelector('input');
      input.addEventListener('input', () => { if (input.value.trim()) { sp().lexicon[k] = input.value.trim(); touch(); } });
      li.querySelector('.au-del').addEventListener('click', () => { delete sp().lexicon[k]; tidy(); touch(); drawLexicon(box); });
      li.querySelector('.au-say').addEventListener('click', (e) => say(k, e.currentTarget));
    });
    box.querySelector('.au-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target, from = f.from.value.trim(), to = f.to.value.trim();
      if (!from || !to) { toast('Нужны оба поля: как пишется и как читается', 'warn'); return; }
      sp().lexicon[from] = to; touch(); drawLexicon(box);
      box.querySelector('.au-add input[name=from]').focus();
    });
    box.querySelector('.au-try-b').addEventListener('click', (e) => {
      const t = box.querySelector('#au-try').value.trim();
      if (t) say(t, e.currentTarget);
    });
    box.querySelector('#au-voice').addEventListener('change', (e) => {
      sp().voice = e.target.value === VOICES[0][0] ? '' : e.target.value;
      tidy();
      touch();
    });
  }

  async function say(text, btn) {
    btn.disabled = true;
    try {
      const r = await fetch('/api/admin/speech/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: (c.speech && c.speech.voice) || '', lexicon: (c.speech && c.speech.lexicon) || {} }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'Синтез не ответил: ' + r.status, 'bad'); return; }
      audio.pause(); playing = null;
      audio.src = URL.createObjectURL(await r.blob());
      audio.play();
      if (data) drawRows();
    } finally { btn.disabled = false; }
  }
}

const SOUND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';

function stat(label, value) { return '<div class="ad-card au-stat"><span>' + label + '</span><b>' + value + '</b></div>'; }

function clock(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
