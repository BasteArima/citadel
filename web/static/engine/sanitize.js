// Policy shared with internal/course/html.go; a Go test compares these JSON literals.
export const HTML_TAGS = ["b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "mark", "code", "kbd", "pre", "br", "p", "span", "div", "ul", "ol", "li", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "a"];
export const HTML_ATTRIBUTES = {"*":["class"],"a":["href"]};

export function safeHref(value) {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return true;
  if (!/^https:\/\//i.test(value)) return false;
  try { return !!new URL(value).hostname; } catch (_) { return false; }
}

export function sanitize(html) {
  const input = document.createElement('template');
  input.innerHTML = String(html ?? '');
  const output = document.createElement('template');
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.data));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    const term = tag === 'button' && node.className === 'term' && /^[a-z0-9-]+$/.test(node.getAttribute('data-k') || '');
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || (!HTML_TAGS.includes(tag) && !term)) {
      parent.appendChild(document.createTextNode(node.outerHTML));
      return;
    }
    const clean = document.createElement(tag);
    for (const attr of node.attributes) {
      const key = attr.name, value = attr.value;
      if (HTML_ATTRIBUTES['*'].includes(key) || (HTML_ATTRIBUTES[tag] || []).includes(key)) {
        if (key !== 'href' || (safeHref(value) && (!node.classList.contains('xref') || value.startsWith('#')))) clean.setAttribute(key, value);
      }
    }
    if (term) {
      clean.type = 'button';
      clean.setAttribute('data-k', node.getAttribute('data-k'));
    }
    if (tag === 'a' && /^https:\/\//i.test(clean.getAttribute('href') || '')) {
      clean.target = '_blank';
      clean.rel = 'noopener noreferrer';
    }
    for (const child of node.childNodes) copy(child, clean);
    parent.appendChild(clean);
  }
  for (const node of input.content.childNodes) copy(node, output.content);
  return output.innerHTML;
}
