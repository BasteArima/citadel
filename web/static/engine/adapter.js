// Временный переходник: курс v1 из API → модель v0, которую понимает прежний движок (app.js).
// Уйдёт на шаге 2 пункта 1.6 плана, когда движок начнёт читать v1 сам.
// Обратное преобразование — internal/legacy/convert.go; тест проверяет, что туда и обратно ничего не теряется.
// Пишется на ES5: файл исполняется и в браузере, и в тесте на Go (goja).
function citadelV1ToV0(c) {
  var out = { title: c.title, sub: c.subtitle, go: c.tool.version, lessons: {}, sections: [], glossary: c.glossary };
  (c.root || []).forEach(function (s) {
    var sec = { id: s.id, name: s.title, kind: s.tag, about: s.about, lessons: [] };
    (s.children || []).forEach(function (l) {
      sec.lessons.push({ n: l.n, id: l.id, t: l.title });
      if (!l.planned) out.lessons[l.id] = lessonToV0(l);
    });
    out.sections.push(sec);
  });
  return out;

  function lessonToV0(l) {
    var les = { time: l.time, lead: l.lead, simple: l.simple, say: l.say, blocks: [], summary: l.summary, test: [], videos: l.videos };
    if (l.children) {
      var k = 0;
      l.children.forEach(function (p) {
        if (p.practice === 'hands') { les.hands = handsToV0(p.blocks[0]); return; }
        if (p.practice === 'test') { (p.blocks || []).forEach(function (b) { les.test.push(questionToV0(b)); }); return; }
        k++;
        les.blocks.push({ part: p.title });
        (p.blocks || []).forEach(function (b) {
          if (b.type === 'question') { var q = questionToV0(b); q.part = k; les.test.push(q); }
          else les.blocks.push(blockToV0(b));
        });
      });
      return les;
    }
    (l.blocks || []).forEach(function (b) {
      if (b.type === 'hands') les.hands = handsToV0(b);
      else if (b.type === 'question') les.test.push(questionToV0(b));
      else les.blocks.push(blockToV0(b));
    });
    return les;
  }

  function rest(b, skip) {
    var r = {};
    Object.keys(b).forEach(function (k) { if (skip.indexOf(k) < 0) r[k] = b[k]; });
    return r;
  }

  function blockToV0(b) {
    var r = {};
    switch (b.type) {
      case 'heading': r[b.level === 3 ? 'h3' : 'h'] = b.text; return r;
      case 'text': return { p: b.html };
      case 'list': r.list = b.items; if ('ordered' in b) r.ordered = b.ordered; return r;
      case 'code': return rest(b, ['type']);
      case 'callout': r[b.kind] = b.html; if ('title' in b) r.title = b.title; return r;
      default: r[b.type] = rest(b, ['type']); return r;
    }
  }

  function questionToV0(b) {
    var q = rest(b, ['type', 'kind']);
    q.type = b.kind;
    return q;
  }

  function handsToV0(b) {
    var h = rest(b, ['type']);
    if (h.check) h.check = h.check.map(function (q) { var r = rest(q, ['kind']); r.type = q.kind; return r; });
    return h;
  }
}
