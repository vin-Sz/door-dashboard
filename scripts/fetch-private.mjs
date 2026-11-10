// Runs in GitHub Actions (not on the iPad). Fetches WebUntis + Google Calendar
// with credentials from GitHub Secrets, encrypts the result with DATA_KEY and
// writes data/untis.enc.json and data/calendar.enc.json into the site folder.
// Never log fetched content: Actions logs of public repos are public.
//
// Env:
//   DATA_KEY          passphrase (also in the iPad URL as #k=...)
//   UNTIS_QR          "untis://setschool?..." from WebUntis profile -> Data access (preferred)
//   or UNTIS_SERVER, UNTIS_SCHOOL, UNTIS_USER, UNTIS_PASSWORD
//   GCAL_ICS_URLS     one or more secret iCal URLs, separated by spaces/newlines
//   TZ=Europe/Berlin  (set by the workflow)
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeLessons } from './untis-merge.mjs';

const outDir = process.argv[2] || '_site/data';
const env = process.env;
if (!env.DATA_KEY) { console.log('DATA_KEY not set - skipping private data'); process.exit(0); }
mkdirSync(outDir, { recursive: true });

function encrypt(obj) {
  const key = createHash('sha256').update(env.DATA_KEY, 'utf8').digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ iv: iv.toString('base64'), ct: ct.toString('base64') });
}
function save(name, obj) { writeFileSync(join(outDir, name + '.enc.json'), encrypt(obj)); }

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hhmm = (n) => `${pad(Math.floor(n / 100))}:${pad(n % 100)}`;
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);

// ------------------------------------------------------------ WebUntis
async function untis() {
  const mod = await import('webuntis');
  const W = mod.default && mod.default.WebUntis ? mod.default : mod;
  let client;
  if (env.UNTIS_QR) {
    const { authenticator } = await import('otplib');
    client = new W.WebUntisQR(env.UNTIS_QR, 'door-dashboard', authenticator, URL);
  } else if (env.UNTIS_SECRET && env.UNTIS_USER && env.UNTIS_SCHOOL && env.UNTIS_SERVER) {
    // "Schlüssel" from WebUntis -> Profile -> Freigaben -> Untis Mobile
    const { authenticator } = await import('otplib');
    client = new W.WebUntisSecretAuth(env.UNTIS_SCHOOL, env.UNTIS_USER, env.UNTIS_SECRET.replace(/\s+/g, ''),
      env.UNTIS_SERVER, 'door-dashboard', authenticator);
  } else if (env.UNTIS_USER && env.UNTIS_PASSWORD && env.UNTIS_SCHOOL && env.UNTIS_SERVER) {
    client = new W.WebUntis(env.UNTIS_SCHOOL, env.UNTIS_USER, env.UNTIS_PASSWORD, env.UNTIS_SERVER, 'door-dashboard');
  } else {
    console.log('WebUntis: not configured');
    return;
  }
  const today = new Date();
  const from = addDays(today, -1), to = addDays(today, 9);
  await client.login();
  let raw, homework = null, exams = null;
  const untisDay = (n) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
  try {
    raw = await client.getOwnTimetableForRange(from, to);
    // Homework + exams are optional: not every school lets students see them.
    try {
      const hw = await client.getHomeWorksFor(addDays(today, -1), addDays(today, 21));
      const subj = {};
      (hw.lessons || []).forEach((l) => { subj[l.id] = l.subject; });
      homework = (hw.homeworks || []).filter((h) => !h.completed).map((h) => ({
        due: untisDay(h.dueDate), subject: subj[h.lessonId] || '', text: String(h.text || '').trim().slice(0, 120)
      }));
    } catch (e) { console.log(`WebUntis homework: not available (${String(e.message).slice(0, 80)})`); }
    try {
      const ex = await client.getExamsForRange(today, addDays(today, 45));
      exams = (ex || []).map((x) => ({
        date: untisDay(x.examDate), start: hhmm(x.startTime), subject: x.subject || '',
        name: String(x.name || x.examType || 'Exam').slice(0, 60)
      }));
    } catch (e) { console.log(`WebUntis exams: not available (${String(e.message).slice(0, 80)})`); }
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  const name = (arr) => (arr || []).map((x) => x.name || x.longname || '').filter(Boolean).join(', ');
  const changed = (arr) => (arr || []).some((x) => x.orgname || x.orgid);
  const lessons = raw.map((l) => {
    const d = String(l.date);
    let status = 'normal';
    if (l.code === 'cancelled') status = 'cancelled';
    else if (l.code === 'irregular' || changed(l.te) || changed(l.ro)) status = 'changed';
    return {
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      start: hhmm(l.startTime), end: hhmm(l.endTime),
      subject: name(l.su) || l.lstext || '—',
      teacher: name(l.te), room: name(l.ro), status,
      note: (l.substText || l.info || '').trim()
    };
  });
  const merged = mergeLessons(lessons);
  save('untis', { updated: Date.now(), from: dayKey(from), to: dayKey(to), lessons: merged, homework, exams });
  console.log(`WebUntis: ok (${merged.length} entries, homework ${homework ? homework.length : 'n/a'}, exams ${exams ? exams.length : 'n/a'})`);
}

// ------------------------------------------------------------ Google Calendar (iCal)
async function calendar() {
  // Entries separated by spaces/newlines. Prefix "homework:" marks a homework/exam calendar.
  const entries = (env.GCAL_ICS_URLS || '').split(/\s+/).filter(Boolean).map((s) => {
    const m = /^(homework):(https?:.*)$/i.exec(s);
    return m ? { kind: 'homework', url: m[2] } : { kind: 'event', url: s };
  });
  if (!entries.length) { console.log('Calendar: not configured'); return; }
  const IcalExpander = (await import('ical-expander')).default;
  const now = new Date();
  const start = addDays(now, -1), end = addDays(now, 15), far = addDays(now, 366);
  const events = [], countdowns = [], homework = [], exams = [];
  const EXAM = /\b(klausur|klassenarbeit|test|exam|prüfung|pruefung|lk)\b/i;
  let okCount = 0;
  for (const [i, { kind, url }] of entries.entries()) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ics = await r.text();
      const ex = new IcalExpander({ ics, maxIterations: 2000 });
      const res = ex.between(start, far);
      const push = (ev, s, e) => {
        const allDay = s.isDate;
        const sj = s.toJSDate(), ej = (e || s).toJSDate();
        const title = String(ev.summary || '(no title)');
        const startDay = allDay ? s.toString().slice(0, 10) : dayKey(sj);
        if (/#countdown/i.test(title)) {
          countdowns.push({ title: title.replace(/#countdown/ig, '').trim(), day: startDay });
          return;
        }
        if (sj > end) return;
        if (kind === 'homework') {
          (EXAM.test(title) ? exams : homework).push({ due: startDay, date: startDay, subject: '', text: title.slice(0, 120), name: title.slice(0, 60) });
          return;
        }
        events.push({
          title,
          location: (ev.location || '').split('\n')[0].slice(0, 60),
          allDay,
          start: sj.toISOString(), end: ej.toISOString(),
          startDay,
          endDay: allDay ? (e || s).toString().slice(0, 10) : dayKey(ej)
        });
      };
      res.events.forEach((ev) => push(ev, ev.startDate, ev.endDate));
      res.occurrences.forEach((o) => push(o.item, o.startDate, o.endDate));
      okCount++;
    } catch (e) {
      console.log(`Calendar #${i + 1}: failed (${e.message})`);
    }
  }
  if (!okCount) throw new Error('no calendar could be loaded');
  const byDay = (k) => (a, b) => (a[k] < b[k] ? -1 : 1);
  events.sort((a, b) => (a.start < b.start ? -1 : 1));
  countdowns.sort(byDay('day')); homework.sort(byDay('due')); exams.sort(byDay('date'));
  save('calendar', {
    updated: Date.now(), events: events.slice(0, 80), countdowns: countdowns.slice(0, 20),
    homework: homework.slice(0, 30), exams: exams.slice(0, 20)
  });
  console.log(`Calendar: ok (${events.length} events, ${countdowns.length} countdowns, ${homework.length} homework, ${exams.length} exams)`);
}

// ------------------------------------------------------------ dashboard settings + timetable
async function config() {
  if (!env.PRIVATE_CONFIG) { console.log('Config: not configured'); return; }
  const cfg = JSON.parse(env.PRIVATE_CONFIG);
  if (!cfg.config || !cfg.timetable) throw new Error('PRIVATE_CONFIG needs "config" and "timetable"');
  save('config', cfg);
  console.log('Config: ok');
}

let failed = 0;
for (const [name, fn] of [['Config', config], ['WebUntis', untis], ['Calendar', calendar]]) {
  try { await fn(); } catch (e) {
    failed++;
    // Message only - never the payload.
    console.log(`${name}: FAILED - ${String((e && e.message) || e).slice(0, 200)}`);
  }
}
// Don't fail the deploy: the page keeps showing the last good data.
process.exit(0);
