// Плеер записанной озвучки — капсула внизу экрана под колонкой текста (макет «Плеер · капсула»,
// на телефоне — две строки). Записи и главы приходят из /api/courses/<id>/audio: там только части,
// чья запись сделана по опубликованному тексту (docs/dev/AUDIO.md). Плеер живёт поверх страниц курса:
// переход на другую часть не останавливает звук. Позиция каждой части запоминается в браузере.
import { el, esc } from './util.js';

const POS = 'citadel-audio-pos';
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.8];

function readPos() { try { return JSON.parse(localStorage.getItem(POS) || '{}'); } catch (e) { return {}; } }
function writePos(p) { try { localStorage.setItem(POS, JSON.stringify(p)); } catch (e) { /* без хранилища — без памяти позиции */ } }
function clock(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

// parts — { <id части>: { url, dur, ch: [{ t, s }] } }; rate/setRate — скорость из настроек ученика.
export function createPlayer(parts, opts) {
  const audio = new Audio();
  audio.preload = 'metadata';
  const listeners = new Set();
  let node = null, info = null, heads = [], chapter = -1, saved = 0;

  const box = el('div', 'ap');
  box.hidden = true;
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Озвучка урока');
  box.innerHTML = '<div class="ap-menu" role="listbox" aria-label="Главы части" hidden></div>' +
    '<div class="ap-cap">' +
      '<button type="button" class="ap-play" aria-label="Слушать"></button>' +
      '<button type="button" class="ap-skip ap-back" data-d="-15" aria-label="Назад на 15 секунд">−15</button>' +
      '<button type="button" class="ap-skip ap-fwd" data-d="15" aria-label="Вперёд на 15 секунд">+15</button>' +
      '<button type="button" class="ap-title" aria-haspopup="listbox" aria-expanded="false"><small></small><b><span></span>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></b></button>' +
      '<span class="ap-time"></span>' +
      '<button type="button" class="ap-rate" aria-label="Скорость"></button>' +
      '<button type="button" class="ap-x" aria-label="Закрыть плеер"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '<div class="ap-track" role="slider" tabindex="0" aria-label="Позиция" aria-valuemin="0">' +
        '<div class="ap-rail"><i class="ap-fill"></i></div><div class="ap-ticks"></div><span class="ap-thumb"></span><span class="ap-tip" aria-hidden="true"></span></div>' +
    '</div>';
  document.body.appendChild(box);
  const $ = (s) => box.querySelector(s);
  const playB = $('.ap-play'), titleB = $('.ap-title'), menu = $('.ap-menu'), track = $('.ap-track'), tip = $('.ap-tip');

  const cur = () => (node ? parts[node] : null);
  const dur = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (cur() ? cur().dur : 0));
  const chapterAt = (t) => { const ch = cur() ? cur().ch : []; let k = 0; ch.forEach((c, i) => { if (t >= c.s) k = i; }); return k; };
  const emit = () => listeners.forEach((fn) => fn());
  // браузер может не дать включить звук (правила автозапуска): тогда кнопки просто остаются «Слушать»
  const play = () => audio.play().catch(() => { draw(); emit(); });

  function remember(force) {
    if (!node) return;
    const t = audio.currentTime;
    if (!force && Math.abs(t - saved) < 5) return;
    saved = t;
    const p = readPos();
    if (t > 3 && t < dur() - 3) p[node] = Math.round(t); else delete p[node];
    writePos(p);
  }

  function open(id, about) {
    if (node === id) return;
    remember(true);
    node = id; info = about; chapter = -1;
    const rec = parts[id];
    audio.src = rec.url;
    audio.playbackRate = opts.rate();
    const at = readPos()[id] || 0;
    saved = at;
    if (at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; }, { once: true });
    $('.ap-ticks').innerHTML = rec.ch.slice(1).map((c, i) =>
      '<button type="button" class="ap-tick" tabindex="-1" data-i="' + (i + 1) + '" style="left:' + (c.s / rec.dur * 100) + '%" aria-label="Глава «' + esc(c.t) + '», ' + clock(c.s) + '"></button>').join('');
    menu.innerHTML = rec.ch.map((c, i) => '<button type="button" role="option" data-i="' + i + '"><span>' + esc(c.t) + '</span><span class="ap-mono">' + clock(c.s) + '</span></button>').join('');
    $('.ap-title small').innerHTML = '<span class="ap-w-l">' + esc(about.lesson) + ' · часть</span><span class="ap-w-m">Часть</span> ' + about.part + '<span class="ap-w-t"> · ' + esc(about.title) + '</span><span class="ap-w-time"></span>';
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: about.title, artist: about.lesson + ' · часть ' + about.part, album: about.course });
    box.hidden = false;
    document.body.classList.add('has-player');
    place();
    draw();
  }

  function draw() {
    if (!node) return;
    const t = audio.currentTime, d = dur(), pct = d ? Math.min(100, t / d * 100) : 0;
    const on = !audio.paused;
    playB.innerHTML = on ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    playB.setAttribute('aria-label', on ? 'Пауза' : 'Слушать');
    const time = clock(t) + ' / ' + clock(d);
    $('.ap-time').textContent = time;
    $('.ap-w-time').textContent = ' · ' + time;
    $('.ap-rate').textContent = String(audio.playbackRate).replace('.', ',') + '×';
    $('.ap-rate').setAttribute('aria-label', 'Скорость: ' + audio.playbackRate + '×');
    $('.ap-fill').style.width = pct + '%';
    $('.ap-thumb').style.left = pct + '%';
    track.setAttribute('aria-valuemax', String(Math.round(d)));
    track.setAttribute('aria-valuenow', String(Math.round(t)));
    track.setAttribute('aria-valuetext', time);
    const ch = cur().ch;
    box.querySelectorAll('.ap-tick').forEach((x) => x.classList.toggle('passed', t >= ch[+x.dataset.i].s));
    const k = chapterAt(t);
    if (k !== chapter) {
      chapter = k;
      $('.ap-title b span').textContent = ch[k].t;
      menu.querySelectorAll('[role=option]').forEach((b, i) => b.setAttribute('aria-selected', String(i === k)));
      mark();
    }
  }

  // подсветка заголовка главы, которая звучит, — если на экране та же часть
  function mark() {
    document.querySelectorAll('.ap-now').forEach((x) => x.classList.remove('ap-now'));
    const h = heads.find((x) => x.node === node && x.title === (cur() && cur().ch[chapter] ? cur().ch[chapter].t : null));
    if (h && !audio.paused) h.el.classList.add('ap-now');
  }

  function seek(t) {
    audio.currentTime = Math.max(0, Math.min(dur() - 0.25, t));
    draw();
    remember(true);
  }
  function close() {
    remember(true);
    audio.pause();
    box.hidden = true;
    menu.hidden = true;
    document.body.classList.remove('has-player');
    node = null; info = null;
    mark();
    emit();
  }

  // капсула — под колонкой текста; на телефоне — во всю ширину с полями
  function place() {
    if (box.hidden) return;
    const col = document.querySelector('.ls-main') || document.getElementById('page');
    const r = col ? col.getBoundingClientRect() : null;
    if (r && r.width && window.innerWidth > 880) {
      box.style.setProperty('--ap-l', Math.round(r.left) + 'px');
      box.style.setProperty('--ap-w', Math.round(r.width) + 'px');
    } else {
      box.style.removeProperty('--ap-l');
      box.style.removeProperty('--ap-w');
    }
  }
  window.addEventListener('resize', place);

  audio.addEventListener('timeupdate', () => { draw(); remember(false); });
  audio.addEventListener('loadedmetadata', draw);
  ['play', 'pause'].forEach((e) => audio.addEventListener(e, () => { draw(); mark(); remember(true); emit(); }));
  audio.addEventListener('ended', () => { remember(true); emit(); });
  audio.addEventListener('error', () => { if (node) opts.onError && opts.onError(); });

  playB.addEventListener('click', () => (audio.paused ? play() : audio.pause()));
  box.querySelectorAll('.ap-skip').forEach((b) => b.addEventListener('click', () => seek(audio.currentTime + +b.dataset.d)));
  $('.ap-rate').addEventListener('click', () => {
    const r = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length];
    audio.playbackRate = r;
    opts.setRate(r);
    draw();
  });
  $('.ap-x').addEventListener('click', close);
  titleB.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    titleB.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) (menu.querySelector('[aria-selected=true]') || menu.firstChild).focus();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    seek(cur().ch[+b.dataset.i].s);
    menu.hidden = true;
    titleB.setAttribute('aria-expanded', 'false');
    if (audio.paused) play();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.ap-menu, .ap-title')) { menu.hidden = true; titleB.setAttribute('aria-expanded', 'false'); }
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; titleB.setAttribute('aria-expanded', 'false'); titleB.focus(); }
  });

  // полоса: нажал и тянешь — перемотка; на засечке — к началу главы; стрелки — по 5 секунд
  const posAt = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur(); };
  let drag = false;
  track.addEventListener('pointerdown', (e) => {
    const tick = e.target.closest('.ap-tick');
    if (tick) { seek(cur().ch[+tick.dataset.i].s); return; }
    drag = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('drag');
    seek(posAt(e.clientX));
  });
  track.addEventListener('pointermove', (e) => {
    const t = posAt(e.clientX);
    if (drag) seek(t);
    const r = track.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(r.width, e.clientX - r.left)) + 'px';
    tip.textContent = clock(t) + ' · ' + cur().ch[chapterAt(t)].t;
  });
  const end = () => { drag = false; track.classList.remove('drag'); };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step) { e.preventDefault(); seek(audio.currentTime + step); }
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    if (e.key === 'End') { e.preventDefault(); seek(dur()); }
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => seek(audio.currentTime - 15));
    ms.setActionHandler('seekforward', () => seek(audio.currentTime + 15));
  }
  window.addEventListener('pagehide', () => remember(true));

  return {
    has: (id) => !!parts[id],
    dur: (id) => (parts[id] ? parts[id].dur : 0),
    // 'playing' | 'paused' (открыта в плеере, стоит) | 'idle'
    state: (id) => (node !== id ? 'idle' : audio.paused ? 'paused' : 'playing'),
    // кнопка «Слушать часть»: пуск и пауза; другая часть — переключиться на неё
    toggle(id, about) {
      if (node !== id) { open(id, about); play(); return; }
      if (audio.paused) play(); else audio.pause();
    },
    // заголовки части на экране: { node, title, el } — для подсветки главы
    setHeadings(list) { heads = list; mark(); },
    pause() { audio.pause(); },
    place,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get node() { return node; }
  };
}
