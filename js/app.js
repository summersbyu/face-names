/* App state, shared helpers, navigation. Views live in ui-*.js. */
const S = {
  students: new Map(),   // id -> { id, name, section, group, row, seat, notes, personId }
  faces: new Map(),      // id -> { id, studentId, status, kind, photoId, section, box, desc, thumb, date, suggestion }
  photos: new Map(),     // id -> { id, section, date, name, width, height, blob, geo }
  srs: new Map(),        // personOf(studentId) -> { id, ease, ivl, reps, lapses, due, last }
  meta: { id: 'meta', confusions: {}, newPerSession: 10 },
  byStudent: new Map(),  // studentId -> confirmed faces of that person (all linked records), newest first
  view: 'study',
  section: '',
  onKey: null,
};
const VIEWS = {};

// ---------- DOM helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => new Date().toISOString().slice(0, 10);
const naturalSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

function toast(msg, ms = 3500) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function modal(title, body, { actions = [], wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: wide ? 'modal wide' : 'modal' },
    h('header', null, h('h2', null, title), h('button', { class: 'icon', 'aria-label': 'Close', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', null, actions) : null);
  // Finish on close() directly too: the 'close' event is queued and can be delayed (e.g. in background tabs).
  let finished = false;
  const finish = () => { if (finished) return; finished = true; dlg.remove(); onClose && onClose(); };
  const nativeClose = dlg.close.bind(dlg);
  dlg.close = value => { nativeClose(value); finish(); };
  dlg.addEventListener('close', finish);
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Offered before anything that can't be undone.
function backupFirstButton() {
  const btn = h('button', { class: 'left', onclick: async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    await saveBackup();
    btn.textContent = 'Backup saved';
  } }, 'Save a backup first');
  return btn;
}

function confirmBox(msg, okLabel = 'OK', danger = false, { offerBackup = false } = {}) {
  return new Promise(resolve => {
    let ok = false;
    const dlg = modal('Please confirm', h('p', null, msg), {
      actions: [
        offerBackup ? backupFirstButton() : null,
        h('button', { onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: danger ? 'danger' : 'primary', onclick: () => { ok = true; dlg.close(); } }, okLabel),
      ],
      onClose: () => resolve(ok),
    });
  });
}

// capture: 'environment' opens a phone's camera instead of its photo library.
function pickFiles({ accept, multiple = false, directory = false, capture = null } = {}) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, multiple, webkitdirectory: directory, capture, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- Version ----------
// Shown once on each device after an update, newest first. Versions are dates, so they sort as text.
const APP_VERSION = '2026.11.09';
const WHATS_NEW = [
  ['2026.11.09', 'Semesters: the newest is current, and earlier ones are kept for review in the Semester menu at the top. ' +
    'The Save picture roll bookmark saves a class roll in one click (Manage → Students → Import picture roll). ' +
    'On a phone, Class Photos has Take a photo.'],
];
function whatsNew() {
  let seen = '';
  try { seen = localStorage.getItem('fn-seen-version') || ''; } catch {}
  const mark = () => { try { localStorage.setItem('fn-seen-version', APP_VERSION); } catch {} };
  const items = WHATS_NEW.filter(([v]) => v > seen);
  if (seen === APP_VERSION || !items.length || !S.students.size) { mark(); return null; }
  const box = h('div', { class: 'tip toolbar' },
    h('span', { class: 'spacer' }, h('b', null, 'What’s new: '), items.map(i => i[1]).join(' ')),
    h('button', { onclick: () => { mark(); box.remove(); } }, 'Got it'));
  return box;
}

// ---------- Data helpers ----------
// The same student in several sections (e.g. this semester and next) shares a person key: photos and study progress.
const personOf = sid => S.students.get(sid)?.personId || sid;
const srsOf = sid => S.srs.get(personOf(sid));
const linkedOf = sid => [...S.students.values()].filter(o => o.id !== sid && personOf(o.id) === personOf(sid));

function reindex() {
  const byPerson = new Map();
  for (const f of S.faces.values()) {
    if (f.status !== 'confirmed' || !f.studentId) continue;
    const p = personOf(f.studentId);
    if (!byPerson.has(p)) byPerson.set(p, []);
    byPerson.get(p).push(f);
  }
  for (const list of byPerson.values()) list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  S.byStudent = new Map();
  for (const s of S.students.values()) if (byPerson.has(personOf(s.id))) S.byStudent.set(s.id, byPerson.get(personOf(s.id)));
}

// Links records of the same student across sections: the same name (or alias), unless their photos clearly differ.
// Faces alone aren't enough (siblings share last names and look alike). Returns the number of new links.
async function linkStudents() {
  const all = [...S.students.values()].filter(s => !s.linkLocked);
  const keys = s => [...new Set([s.name, ...(s.aliases || [])].map(Engine.normName))];
  const descs = sid => facesOf(sid).map(f => f.desc).filter(Boolean).slice(0, 6);
  const dist = (a, b) => {
    const da = descs(a.id), db = descs(b.id);
    if (!da.length || !db.length) return null;
    return Math.min(...da.flatMap(x => db.map(y => Engine.descDist(x, y))));
  };
  const buckets = new Map();
  const add = (k, s) => { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(s); };
  for (const s of all) for (const k of keys(s)) add(k, s);
  const cands = new Map();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.section === b.section || personOf(a.id) === personOf(b.id)) continue;
      const id = [a.id, b.id].sort().join('|');
      cands.set(id, { a, b });
    }
  }
  const pairs = [...cands.values()].map(c => ({ ...c, d: dist(c.a, c.b) }))
    .filter(c => c.d == null || c.d < 0.75)
    .sort((x, y) => (x.d ?? 0.74) - (y.d ?? 0.74));
  const changed = new Set();
  let links = 0;
  for (const { a, b } of pairs) {
    const group = await mergePeople(a, b);
    if (group) { group.forEach(s => changed.add(s)); links++; }
  }
  if (changed.size) { await saveStudents([...changed]); reindex(); }
  return links;
}

// Gives two records (and anyone already linked to them) one person key, unless that would put the person
// in one section twice. Returns the changed records (not yet saved), or null.
async function mergePeople(a, b) {
  const pa = personOf(a.id), pb = personOf(b.id);
  if (pa === pb) return null;
  const ga = [...S.students.values()].filter(s => personOf(s.id) === pa);
  const gb = [...S.students.values()].filter(s => personOf(s.id) === pb);
  if (ga.some(x => gb.some(y => x.section === y.section))) return null;
  // Keep the study progress with more practice behind it.
  const ra = S.srs.get(pa), rb = S.srs.get(pb);
  const key = rb && (!ra || rb.reps > ra.reps) ? pb : pa, drop = key === pa ? pb : pa;
  if (S.srs.has(drop)) { S.srs.delete(drop); await DB.del('srs', drop); }
  for (const s of [...ga, ...gb]) s.personId = key;
  return [...ga, ...gb];
}

// For linking by hand (e.g. a name change): records in other sections, most similar faces first.
function linkCandidates(sid) {
  const me = S.students.get(sid), mine = facesOf(sid).map(f => f.desc).filter(Boolean);
  const taken = new Set([me.section, ...linkedOf(sid).map(o => o.section)]);
  return [...S.students.values()].filter(o => !taken.has(o.section) && personOf(o.id) !== personOf(sid)).map(o => {
    const ds = facesOf(o.id).map(f => f.desc).filter(Boolean);
    const d = mine.length && ds.length ? Math.min(...mine.flatMap(x => ds.map(y => Engine.descDist(x, y)))) : 9;
    return { s: o, d };
  }).sort((x, y) => x.d - y.d || naturalSort(x.s.name, y.s.name))
    .filter((c, i, arr) => arr.findIndex(o => personOf(o.s.id) === personOf(c.s.id)) === i);
}

// A chart and a roll often hold one picture at two resolutions. Keeps the largest, then sharpest, copy of each person's
// roster photos; class photos are left alone. Checked photos are marked, so only new ones cost any time.
async function removeDuplicatePhotos() {
  const seen = new Set(), drop = [], checked = [];
  for (const s of S.students.values()) {
    const person = personOf(s.id);
    if (seen.has(person)) continue;
    seen.add(person);
    const refs = facesOf(s.id).filter(f => f.kind === 'reference');
    if (refs.length < 2 || refs.every(f => f.dupChecked)) continue;
    const scored = await Promise.all(refs.map(async f => [await Faces.quality(f.thumb), f]));
    const kept = [];
    for (const [, f] of scored.sort(([a], [b]) => b.size - a.size || b.sharpness - a.sharpness)) {
      let copy = false;
      for (const k of kept) if (await Faces.samePicture(k.thumb, f.thumb)) { copy = true; break; }
      if (copy) drop.push(f.id); else { kept.push(f); checked.push({ ...f, dupChecked: true }); }
    }
  }
  if (checked.length) await saveFaces(checked);
  if (drop.length) await deleteFaces(drop);
  return drop.length;
}

// Splits a record from its links; both sides keep a copy of the shared study progress.
async function unlinkStudent(s) {
  const key = personOf(s.id), others = linkedOf(s.id), r = S.srs.get(key);
  const newKey = key === s.id && others.length ? others[0].id : key;
  for (const o of others) o.personId = newKey;
  for (const k of [newKey, s.id]) {
    if (r && k !== key) { const copy = { ...r, id: k }; S.srs.set(k, copy); await DB.put('srs', copy); }
  }
  s.personId = s.id; s.linkLocked = true;
  await saveStudents([s, ...others]);
  reindex();
}

// Removes one section's record of a student. Someone also in other sections keeps their photos and progress there.
async function dropRecord(s) {
  const key = personOf(s.id), heir = linkedOf(s.id)[0];
  const mine = [...S.faces.values()].filter(f => f.studentId === s.id);
  const unlabeled = f => ({ ...f, studentId: null, status: f.status === 'rejected' ? 'rejected' : 'unknown' });
  if (heir) {
    await saveFaces(mine.map(f => (f.status === 'confirmed' ? { ...f, studentId: heir.id } : unlabeled(f))));
  } else {
    await deleteFaces(mine.filter(f => f.kind === 'reference' || !f.photoId).map(f => f.id));
    await saveFaces(mine.filter(f => f.kind !== 'reference' && f.photoId).map(unlabeled));
    if (S.srs.delete(key)) await DB.del('srs', key);
  }
  S.students.delete(s.id);
  await DB.del('students', s.id);
  await markDeleted([s.id]);
  reindex();
}

async function moveSectionContents(from, to) {
  await saveFaces([...S.faces.values()].filter(f => f.section === from).map(f => ({ ...f, section: to })));
  for (const p of S.photos.values()) if (p.section === from) { p.section = to; p.edited = Date.now(); await DB.put('photos', p); }
  if (S.section === from) S.section = to;
}

async function renameSection(from, to) {
  await saveStudents(sectionStudents(from).map(s => ({ ...s, section: to })));
  await moveSectionContents(from, to);
}

// Combines two sections. Someone in both becomes one record in the section kept, with all their photos and notes.
async function mergeSections(from, to) {
  const { pairs, moves } = Engine.planSectionMerge(sectionStudents(from), sectionStudents(to), s => personOf(s.id));
  for (const [a, b] of pairs) {
    if (personOf(a.id) !== personOf(b.id)) {
      const group = await mergePeople(a, b);
      if (group) await saveStudents(group);
    }
    await saveFaces([...S.faces.values()].filter(f => f.studentId === a.id).map(f => ({ ...f, studentId: b.id })));
    const kept = S.students.get(b.id);
    await saveStudents([{ ...kept, notes: Engine.unionNotes(kept.notes, a.notes), group: kept.group || a.group, row: kept.row ?? a.row, seat: kept.seat ?? a.seat,
      seatLabel: kept.seatLabel || a.seatLabel, pos: kept.pos || a.pos, aliases: [...new Set([...(kept.aliases || []), ...(a.aliases || [])])], legalName: kept.legalName || a.legalName }]);
    S.students.delete(a.id);
    await DB.del('students', a.id);
    await markDeleted([a.id]);
  }
  await saveStudents(moves.map(s => ({ ...s, section: to })));
  await moveSectionContents(from, to);
  reindex();
}

// Class photos go with the section; a labeled face stays on the flashcards of anyone who's still here.
async function deleteSection(sec) {
  for (const s of sectionStudents(sec)) await dropRecord(s);
  const photos = [...S.photos.values()].filter(p => p.section === sec), ids = new Set(photos.map(p => p.id));
  const faces = [...S.faces.values()].filter(f => ids.has(f.photoId));
  const kept = f => f.status === 'confirmed' && f.studentId;
  await saveFaces(faces.filter(kept).map(f => ({ ...f, photoId: null })));
  await deleteFaces(faces.filter(f => !kept(f)).map(f => f.id));
  for (const p of photos) { S.photos.delete(p.id); await DB.del('photos', p.id); }
  await markDeleted(photos.map(p => p.id));
}

// ---------- Semesters ----------
// A section's semester is set on its students when it's imported, or read from its name ("W27-1"). The newest
// semester is current; earlier ones are kept for review but left out of the lists and daily study until chosen.
// A section with no semester always shows.
function sectionTerms() {
  const out = new Map();
  for (const s of S.students.values()) if (s.term != null && !out.has(s.section)) out.set(s.section, s.term);
  for (const s of S.students.values()) if (!out.has(s.section)) out.set(s.section, Engine.parseTerm(s.section));
  return out;
}
const termOf = sec => sectionTerms().get(sec) ?? Engine.parseTerm(sec);
const terms = () => [...new Set(sectionTerms().values())].filter(Boolean).sort((a, b) => Engine.termRank(b) - Engine.termRank(a));
const shownTerm = () => { const all = terms(); return S.term === 'all' ? 'all' : all.includes(S.term) ? S.term : all[0] || 'all'; };
// For a new section: the term in its name, else the one the file names ("Winter 2027").
const termFor = (sec, label) => termOf(sec) || Engine.parseTerm(label);

const allSections = () => [...sectionTerms().keys()].sort(naturalSort);
const sections = () => {
  const shown = shownTerm(), byTerm = sectionTerms();
  return allSections().filter(x => shown === 'all' || !byTerm.get(x) || byTerm.get(x) === shown)
    .sort((a, b) => Engine.termRank(byTerm.get(b)) - Engine.termRank(byTerm.get(a)) || naturalSort(a, b));
};
// With no section, everyone in the sections shown.
function sectionStudents(sec) {
  const shown = sec ? null : new Set(sections());
  return [...S.students.values()].filter(s => (sec ? s.section === sec : shown.has(s.section))).sort((a, b) => naturalSort(a.name, b.name));
}

// After an import: show what came in, and say so when a new semester has become the current one.
function showImported(sec, newestBefore) {
  const t = termOf(sec), newest = terms()[0];
  if (!t || sections().includes(sec)) {
    return !S.term && newestBefore && t === newest && t !== newestBefore
      ? `${Engine.termLabel(t)} is now the current semester. ${Engine.termLabel(newestBefore)} is kept for review: choose it from the Semester menu at the top.` : '';
  }
  S.term = t === newest ? null : t;
  return `Now showing ${Engine.termLabel(t)}.`;
}

function termBar() {
  const all = terms(), shown = shownTerm();
  if (all.length < 2) return null;
  const pick = v => { S.term = v === all[0] ? null : v; S.studySection = ''; render(); };
  return h('div', { class: 'term-bar' },
    h('label', { class: 'inline' }, 'Semester ',
      h('select', { onchange: e => pick(e.target.value) },
        all.map((t, i) => h('option', { value: t, selected: t === shown }, `${Engine.termLabel(t)}${i ? '' : ' (current)'}`)),
        h('option', { value: 'all', selected: shown === 'all' }, 'All semesters'))),
    shown !== 'all' && shown !== all[0] ? h('span', { class: 'muted small' }, 'An earlier semester, for review.') : null);
}
const facesOf = sid => S.byStudent.get(sid) || [];
const firstName = s => (s ? s.name.split(' ')[0] : '');

function avatarOf(sid) {
  const fs = facesOf(sid);
  return (fs.find(f => f.kind === 'reference' && f.studentId === sid) || fs.find(f => f.kind === 'reference') || fs[0] || {}).thumb || null;
}

function avatarEl(sid, size = 40) {
  const src = avatarOf(sid);
  const s = S.students.get(sid);
  if (src) return h('img', { class: 'avatar', src, alt: '', width: size, height: size });
  const initials = s ? s.name.split(' ').map(p => p[0]).slice(0, 2).join('') : '?';
  return h('span', { class: 'avatar empty', style: { width: size + 'px', height: size + 'px' } }, initials);
}

const seatText = s => (s.seatLabel ? `seat ${s.seatLabel}` : s.row != null && s.seat != null ? `row ${s.row}, seat ${s.seat}` : '');

// Records carry the time they last changed and deletions are remembered, so a backup from another device can be merged.
async function saveStudents(list) { for (const s of list) { s.edited = Date.now(); S.students.set(s.id, s); } await DB.putMany('students', list); }
async function saveFaces(list) { for (const f of list) { f.edited = Date.now(); S.faces.set(f.id, f); } await DB.putMany('faces', list); reindex(); }
async function deleteFaces(ids) { for (const id of ids) S.faces.delete(id); await DB.delMany('faces', ids); await markDeleted(ids); reindex(); }
async function saveMeta() { await DB.put('meta', S.meta); }
async function markDeleted(ids) {
  if (!ids.length) return;
  S.meta.deleted = S.meta.deleted || {};
  for (const id of ids) S.meta.deleted[id] = Date.now();
  await saveMeta();
}

function sectionSelect(value, onChange, { all = false } = {}) {
  const secs = sections();
  return h('select', { onchange: e => onChange(e.target.value), 'aria-label': 'Section' },
    all ? h('option', { value: '', selected: value === '' }, 'All sections') : null,
    !all && !secs.length ? h('option', { value: '' }, 'No sections yet') : null,
    secs.map(s => h('option', { value: s, selected: s === value },
      `${s}${sectionStudents(s).some(o => o.pos || (o.row != null && o.seat != null)) ? '' : ' (no seating chart)'}`)));
}

function ensureSection() {
  const secs = sections();
  if (!secs.includes(S.section)) S.section = secs[0] || '';
  if (S.studySection && !secs.includes(S.studySection)) S.studySection = '';
}

// ---------- Navigation ----------
const MANAGE = [['roster', 'Students'], ['sections', 'Sections'], ['label', 'Class Photos']];
const TABS = [['study', 'Study'], ['manage', 'Manage'], ['backup', 'Backup']];
const inManage = view => MANAGE.some(([id]) => id === view);
let lastManage = 'roster';
const goTo = view => { S.view = view; S.reviewPhoto = null; S.meet = null; S.room = null; render(); };

function manageNav() {
  return h('nav', { class: 'subtabs', 'aria-label': 'Manage' }, MANAGE.map(([id, label]) =>
    h('button', { class: S.view === id ? 'subtab active' : 'subtab', 'aria-current': S.view === id ? 'page' : null, onclick: () => goTo(id) }, label)));
}

function render() {
  S.onKey = null;
  ensureSection();
  const nav = $('#tabs');
  const managing = inManage(S.view);
  if (managing) lastManage = S.view;
  const current = managing ? 'manage' : S.view;
  nav.replaceChildren(...TABS.map(([id, label]) =>
    h('button', { class: current === id ? 'tab active' : 'tab', 'aria-current': current === id ? 'page' : null,
      onclick: () => goTo(id === 'manage' ? lastManage : id) }, label)));
  const main = $('#main');
  const busy = S.session || S.meet || S.room || S.reviewPhoto || S.newSemester || S.view === 'backup';
  main.replaceChildren(...(managing ? [manageNav()] : []), ...(busy ? [] : [termBar()].filter(Boolean)), VIEWS[S.view]());
  try { localStorage.setItem('fn-view', JSON.stringify({ view: S.view, section: S.section, term: S.term || null })); } catch {}
}

document.addEventListener('keydown', e => {
  if (!S.onKey || document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  S.onKey(e, typing);
});

function setModelStatus(text, cls) {
  const el = $('#model-status');
  el.textContent = text;
  el.className = 'pill ' + (cls || '');
}

async function init() {
  const [students, faces, photos, srs, meta] = await Promise.all(DB.STORES.map(s => DB.getAll(s)));
  students.forEach(s => S.students.set(s.id, s));
  faces.forEach(f => S.faces.set(f.id, f));
  photos.forEach(p => S.photos.set(p.id, p));
  srs.forEach(r => S.srs.set(r.id, r));
  if (meta.length) Object.assign(S.meta, meta[0]);
  reindex();
  await linkStudents();
  try {
    const saved = JSON.parse(localStorage.getItem('fn-view') || '{}');
    if (saved.view && VIEWS[saved.view]) S.view = saved.view;
    if (saved.section != null) S.section = saved.section;
    if (saved.term) S.term = saved.term;
  } catch {}
  if (!S.students.size) S.view = 'roster';
  render();
  try {
    const merged = sessionStorage.getItem('fn-merged');
    if (merged) { sessionStorage.removeItem('fn-merged'); toast(merged, 9000); }
  } catch {}
  removeDuplicatePhotos().then(n => {
    if (!n) return;
    toast(`Removed ${n} duplicate photos (the same picture at a lower resolution).`, 6000);
    if (!S.session && !S.meet) render();
  }).catch(() => {});
  // On a phone they load when a photo is added, so opening the app to study stays quick.
  if (matchMedia('(pointer: fine)').matches) {
    setModelStatus('Loading face models…');
    Faces.load().then(() => setModelStatus('Face models ready', 'ok'))
      .catch(() => setModelStatus('Face models failed to load', 'bad'));
  }
  // Opened from a web address: lets it open offline and be added to a home screen.
  if (location.protocol !== 'file:' && navigator.serviceWorker) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    document.head.append(h('link', { rel: 'manifest', href: 'manifest.webmanifest' }));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
