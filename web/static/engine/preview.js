// Accept draft data only from the embedding editor on this origin.
export function applyPreviewMessage(event, course) {
  if (event.origin !== location.origin || event.source !== window.parent) return null;
  const m = event.data;
  if (!m || m.type !== 'citadel-preview' || !Number.isInteger(m.courseVersion)) return null;
  if (m.course) {
    if (m.course.id !== course.id || !Array.isArray(m.course.root)) return null;
    Object.keys(course).forEach((k) => delete course[k]); Object.assign(course, m.course);
  } else if (m.node && typeof m.node.id === 'string') {
    const replace = (nodes) => (nodes || []).some((n, i) => {
      if (n.id === m.node.id) { nodes[i] = m.node; return true; }
      return replace(n.children);
    });
    if (!replace(course.root)) return null;
  } else if (typeof m.navigate !== 'string') return null;
  return m;
}
