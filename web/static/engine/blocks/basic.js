// Простые блоки: заголовок, абзац, список, код, таблица, врезка, схема, заглушка для песочницы.
import { el, esc, ic, IC, codeHead, readable } from '../util.js';
import { rich } from '../rich.js';

export const heading = {
  type: 'heading',
  render: (b) => el(b.level === 3 ? 'h3' : 'h2', null, rich(b.text)),
  speak: (node) => readable(node)
};

export const text = {
  type: 'text',
  render: (b) => el('p', null, rich(b.html)),
  speak: (node) => readable(node)
};

export const list = {
  type: 'list',
  render(b) {
    const ul = el(b.ordered ? 'ol' : 'ul', 'list');
    b.items.forEach((li) => ul.appendChild(el('li', null, rich(li))));
    return ul;
  },
  speak: (node) => readable(node)
};

export const code = {
  type: 'code',
  render(b, ctx) {
    const f = document.createDocumentFragment();
    const cb = el('div', 'codebox');
    cb.appendChild(codeHead(b.file || ctx.tool.name, null, b.code));
    const pre = el('pre'); pre.appendChild(el('code', null, esc(b.code)));
    cb.appendChild(pre);
    f.appendChild(cb);
    if (b.cap) f.appendChild(el('div', 'cap', rich(b.cap)));
    return f;
  },
  speak: (node) => readable(node)
};

export const table = {
  type: 'table',
  render(b) {
    const t = '<table><thead><tr>' + b.head.map((x) => '<th>' + rich(x) + '</th>').join('') + '</tr></thead><tbody>' +
      b.rows.map((r) => '<tr>' + r.map((x) => '<td>' + rich(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    return el('div', 'tbl', t);
  },
  speak: (node) => readable(node)
};

export const callout = {
  type: 'callout',
  render(b) {
    if (b.kind === 'cs') {
      // врезка про C# — сбоку от основной линии, поэтому свёрнута
      return el('details', 'callout cs', '<summary>' + ic(IC.chev, 16) + '<span>' + esc(b.title || 'Если ты из C#') + '</span><span class="cs-more">развернуть</span></summary>' +
        '<div class="cs-b">' + rich(b.html) + '</div>');
    }
    const label = b.title || { note: 'Важно', warn: 'Осторожно' }[b.kind] || '';
    return el('div', 'callout ' + b.kind, '<b>' + esc(label) + '</b>' + rich(b.html));
  },
  speak: (node) => readable(node)
};

export const scheme = {
  type: 'scheme',
  render(b) {
    const w = el('div', 'widget');
    w.innerHTML = '<div class="w-head"><div class="kind">Схема</div><div class="w-title">' + rich(b.title) + '</div></div>' +
      '<div class="w-body">' + rich(b.html) + (b.cap ? '<div class="w-cap">' + rich(b.cap) + '</div>' : '') + '</div>';
    return w;
  }
};

// Свой код курса будет работать в песочнице (iframe на отдельном адресе). Пока — заглушка.
export const embed = {
  type: 'embed',
  render: () => el('div', 'callout note', '<b>Интерактивный блок</b>Свой код курса появится вместе с песочницей.')
};
