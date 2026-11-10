// Turns WebUntis 45-min periods into display rows:
// - merges consecutive periods of the same lesson into double periods
// - when a cancelled lesson is replaced by another one at the same time,
//   keeps only the replacement and notes "instead of X"
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);

export function mergeLessons(input) {
  const seen = new Set();
  const lessons = input.filter((l) => {
    const k = [l.date, l.start, l.subject, l.status].join('|');
    if (seen.has(k)) return false; seen.add(k); return true;
  }).sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));

  const merged = [];
  for (const l of lessons) {
    let p = null;
    for (const m of merged) {
      if (m.date === l.date && m.subject === l.subject && m.status === l.status && m.room === l.room &&
          m.end <= l.start && toMin(l.start) - toMin(m.end) <= 10) p = m;
    }
    if (p) {
      p.end = l.end;
      if (l.note && !p.note.includes(l.note)) p.note = p.note ? p.note + ' / ' + l.note : l.note;
    } else merged.push({ ...l });
  }

  const out = merged.filter((c) => {
    if (c.status !== 'cancelled') return true;
    const rep = merged.find((o) => o !== c && o.date === c.date && o.status !== 'cancelled' &&
      o.start < c.end && o.end > c.start);
    if (!rep) return true;
    if (rep.subject !== c.subject) {
      rep.status = 'changed';
      if (!rep.note) rep.note = 'instead of ' + c.subject;
    }
    return false;
  });
  return out.sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
}
