// Модель курса v1 для движка: разделы, уроки по порядку, части урока и его вопросы.
// Формат описан в docs/dev/CONTENT-FORMAT.md.

export function indexCourse(c) {
  const sections = [], all = [], byId = new Map();
  (c.root || []).filter((n) => n.kind === 'section').forEach((s) => {
    const sec = { id: s.id, name: s.title, kind: s.tag, about: s.about, node: s, lessons: [] };
    (s.children || []).forEach((l) => {
      const m = { n: l.n, id: l.id, t: l.title, sec, node: l };
      sec.lessons.push(m);
      all.push(m);
      byId.set(l.id, m);
    });
    sections.push(sec);
  });
  const pages = (c.root || []).filter((n) => n.kind === 'page');
  const lessons = new Map();
  return {
    course: c,
    sections,
    pages,
    all,
    total: all.length,
    review: c.review && c.review.length ? c.review : [1, 3, 7],
    meta: (id) => byId.get(id) || null,
    ready: (id) => { const m = byId.get(id); return !!(m && !m.node.planned); },
    page: (id) => pages.find((p) => p.id === id) || null,
    hasGlossary: !c.pages || c.pages.includes('glossary'),
    lesson(id) {
      if (!lessons.has(id)) lessons.set(id, lessonModel(byId.get(id).node));
      return lessons.get(id);
    }
  };
}

// Урок одной страницей — blocks; урок по частям — children из узлов part.
// Части практики: practice = 'hands' («Сделай руками») или 'test' («Проверка»).
function lessonModel(node) {
  const les = {
    id: node.id, node,
    time: node.time, lead: node.lead, simple: node.simple, say: node.say,
    summary: node.summary, videos: node.videos,
    parts: null, blocks: [], hands: null,
    questions: [], // все вопросы урока: урок пройден, когда решены все
    partOf: {}      // id вопроса → номер части теории, где он стоит («Проверь себя»)
  };
  const isQ = (b) => b.type === 'question';
  if (node.children && node.children.length) {
    let k = 0;
    les.parts = node.children.map((p, i) => {
      const blocks = p.blocks || [];
      if (p.practice === 'hands') return { node: p, title: p.title, kind: 'practice', type: 'hands', hands: blocks.find((b) => b.type === 'hands'), blocks: [] };
      if (p.practice === 'test') {
        const qs = blocks.filter(isQ);
        les.questions.push(...qs);
        return { node: p, title: p.title, kind: 'practice', type: 'test', blocks: [], questions: qs };
      }
      k = i + 1;
      const own = blocks.filter(isQ);
      own.forEach((q) => { les.partOf[q.id] = k; });
      les.questions.push(...own);
      return { node: p, title: p.title, kind: 'theory', blocks: blocks.filter((b) => !isQ(b)), questions: own };
    });
    les.hands = (les.parts.find((p) => p.type === 'hands') || {}).hands || null;
  } else {
    const blocks = node.blocks || [];
    les.blocks = blocks.filter((b) => !isQ(b) && b.type !== 'hands');
    les.hands = blocks.find((b) => b.type === 'hands') || null;
    les.questions = blocks.filter(isQ);
  }
  return les;
}
