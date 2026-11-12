// Run this function in a browser on a running Citadel origin (e.g. Playwright
// page.evaluate). No npm dependencies or test-only code in the embedded frontend.
async function testHTMLSecurity() {
  const { sanitize, safeHref, HTML_TAGS } = await import('/static/engine/sanitize.js');
  const { rich, initRich } = await import('/static/engine/rich.js');
  const { courseText } = await import('/static/site/shared.js');
  const { anim } = await import('/static/engine/blocks/anim.js');
  const { renderQuestion } = await import('/static/engine/blocks/question.js');
  const { blockForm } = await import('/static/admin/blocks.js');
  let count = 0;
  const assert = (ok, message) => { count++; if (!ok) throw new Error(message); };
  const parse = (s) => { const t = document.createElement('template'); t.innerHTML = s; return t.content; };
  const attacks = [
    '<script>alert(1)</script>', '<script>', '<img src=x onerror="alert(1)">',
    '<iframe src="/">', '<b style="color:red" ONCLICK="alert(1)">x</b>',
    '<a href="javascript:alert(1)">x</a>', '<a href="data:text/html,x">x</a>',
    '<a href="//evil">x</a>', '<a href="/\\evil">x</a>',
    '<a HREF="jav&#x61;script:alert(1)">x</a>', '<a href="java&#9;script:alert(1)">x</a>',
    '<scr<script>ipt>alert(1)</scr<script>ipt>', '<nil>',
    '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
    '<template><img src=x onerror=alert(1)></template>',
    '<button class="term" data-k="term" formaction="https://evil" onclick="alert(1)">x</button>',
    '<a class="xref" href="https://evil">x</a>'
  ];
  for (const attack of attacks) {
    const cleaned = sanitize(attack), tree = parse(cleaned);
    for (const e of tree.querySelectorAll('*')) {
      assert(HTML_TAGS.includes(e.localName) || e.matches('button.term[data-k]'), 'forbidden element: ' + attack);
      assert([...e.attributes].every(a => !/^on/i.test(a.name) && !['style', 'src', 'formaction'].includes(a.name)), 'forbidden attribute: ' + attack);
      if (e.hasAttribute('href')) assert(safeHref(e.getAttribute('href')), 'unsafe href: ' + attack);
    }
    assert(sanitize(cleaned) === cleaned, 'not idempotent: ' + attack);
  }
  assert(parse(sanitize('<img src=x onerror="alert(1)"><nil>')).textContent.includes('<img'), 'forbidden markup must stay visible');
  assert(parse(sanitize('<nil>')).textContent.includes('<nil>'), 'nil must stay visible');
  assert(sanitize('<b class="ok">bold</b>') === '<b class="ok">bold</b>', 'allowed markup');
  for (const url of ['#lesson', '/c/go/', 'https://example.org/a?q=1&b=2']) {
    const a = parse(sanitize('<a href="' + url + '">x</a>')).querySelector('a');
    assert(a.getAttribute('href') === url, 'allowed href');
    if (url.startsWith('https://')) assert(a.target === '_blank' && a.rel === 'noopener noreferrer', 'external link isolation');
  }
  const course = { glossary: { term: { t: 'Термин' } } };
  initRich({ course, meta: () => ({ n: 1, t: 'Урок' }), ready: () => true });
  const refs = parse(rich('{{term}} {{term|текст}} {{>lesson}}'));
  assert(refs.querySelectorAll('button.term[data-k="term"]').length === 2, 'term placeholders');
  assert(refs.querySelector('a.xref').getAttribute('href') === '#lesson', 'node placeholder');
  assert(!parse(courseText('<img src=x onerror="alert(1)">', course)).querySelector('img'), 'project/review bypass');
  course.glossary.term.t = '<img src=x onerror="alert(1)">';
  assert(!parse(rich('{{term}}')).querySelector('img'), 'glossary bypass');
  const a = anim.render({ title: 'Test', els: [], side: { title: 'State', rows: [['a', 'b', '"><img src=x onerror=alert(1)>']] }, steps: [{ cap: 'Caption' }] });
  assert(!a.querySelector('img'), 'animation class injection');
  const q = renderQuestion({ kind: 'text', q: 'q', a: ['a'] }, '<img src=x onerror=alert(1)>', { state: () => 0 });
  assert(!q.querySelector('img'), 'question label injection');
  const form = blockForm({ type: 'anim', steps: { length: '<img src=x onerror=alert(1)>' } }, {});
  assert(!form.querySelector('img'), 'invalid draft block length injection');
  return { assertions: count, attacks: attacks.length };
}
