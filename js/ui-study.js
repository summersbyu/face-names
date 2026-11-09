/* Study view: Meet new students first, then face -> name flashcards with spaced repetition and mix-up drills. */

const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Person keys of whoever this student gets mixed up with, most often first. Read by person, so a mix-up
// recorded in one section also counts in that person's linked sections.
function confusedWith(sid) {
  const me = personOf(sid), counts = new Map();
  for (const [k, n] of Object.entries(S.meta.confusions || {})) {
    const [a, b] = k.split('|').map(personOf);
    const other = a === me ? b : b === me ? a : null;
    if (other && other !== me) counts.set(other, (counts.get(other) || 0) + n);
  }
  return [...counts].sort((x, y) => y[1] - x[1]).map(x => x[0]);
}

// One record per person, for "All sections" views where a linked student appears more than once.
const onePerPerson = list => { const seen = new Set(); return list.filter(s => !seen.has(personOf(s.id)) && seen.add(personOf(s.id))); };

function studyCounts(sec) {
  const now = Date.now();
  const everyone = onePerPerson(sectionStudents(sec));
  const pool = everyone.filter(s => facesOf(s.id).length);
  const c = { pool: pool.length, met: 0, due: 0, fresh: 0, learning: 0, known: 0, noPhoto: everyone.length - pool.length };
  for (const s of pool) {
    const r = srsOf(s.id);
    if (!r) c.fresh++;
    else {
      c.met++;
      if (r.due <= now) c.due++;
      if (r.ivl >= 1) c.known++; else c.learning++;
    }
  }
  return c;
}

function buildQueue(sec, mode) {
  const now = Date.now();
  const pool = onePerPerson(sectionStudents(sec)).filter(s => facesOf(s.id).length && srsOf(s.id));
  const ids = shuffle((mode === 'all' ? pool : pool.filter(s => srsOf(s.id).due <= now)).map(s => s.id));
  const wanted = new Map(ids.map(id => [personOf(id), id])), queued = new Set(), out = [];
  for (const id of ids) {
    if (queued.has(id)) continue;
    out.push({ sid: id }); queued.add(id);
    for (const person of confusedWith(id).slice(0, 2)) {
      const p = wanted.get(person);
      if (p && !queued.has(p)) { out.push({ sid: p, compareWith: id }); queued.add(p); }
    }
  }
  return out;
}

function centroid(sid) {
  const ds = facesOf(sid).map(f => f.desc).filter(Boolean);
  if (!ds.length) return null;
  const c = new Array(ds[0].length).fill(0);
  for (const d of ds) d.forEach((v, i) => { c[i] += v / ds.length; });
  return c;
}

function lookalikes(sid, n = 6) {
  const s = S.students.get(sid);
  const me = centroid(sid);
  const others = sectionStudents(s.section).filter(o => o.id !== sid && facesOf(o.id).length);
  if (!me) return others.slice(0, n).map(o => o.id);
  return others.map(o => [o.id, centroid(o.id)]).filter(x => x[1])
    .sort((a, b) => Engine.descDist(me, a[1]) - Engine.descDist(me, b[1])).slice(0, n).map(x => x[0]);
}

// A student's name that opens their record, to check or fix it while studying.
const nameLink = s => h('button', { class: 'name-link', title: 'View or edit this student', onclick: e => { e.currentTarget.blur(); editStudent(s); } }, s.name);

const mainFace = fs => fs.find(f => f.kind === 'reference') || fs[0];

// Every photo of the student, so each card shows all the views at once. Fewer photos are drawn larger.
// In recall the extra views can be turned off, leaving only the main photo.
function faceGallery(sid, recall = false) {
  const all = facesOf(sid);
  const fs = recall && S.meta.onePhoto ? [mainFace(all)] : all;
  return h('div', { class: `flash-faces n${Math.min(fs.length, 5)}` }, fs.map(f => h('img', { src: f.thumb, alt: 'Who is this?' })));
}

// The question after a miss: "Who did you think it was?"
const mixupToggle = onChange => h('label', { class: 'inline small' },
  h('input', { type: 'checkbox', checked: !S.meta.skipMixupQuestion, onchange: async e => {
    S.meta.skipMixupQuestion = !e.target.checked;
    await saveMeta();
    onChange();
  } }), ' After a miss, ask who I thought it was');

async function togglePhotos() {
  S.meta.onePhoto = !S.meta.onePhoto;
  await saveMeta();
  render();
}
const photoToggle = () => h('label', { class: 'inline small' },
  h('input', { type: 'checkbox', checked: !S.meta.onePhoto, onchange: togglePhotos }), ' Show alternate photos', h('span', { class: 'key-hint' }, ' (P)'));
async function toggleNotes() {
  S.meta.hideNotes = !S.meta.hideNotes;
  await saveMeta();
  render();
}
// A student's notes under their revealed name, which can be turned off.
const notesArea = s => h('div', { class: 'notes-area' },
  s.notes && !S.meta.hideNotes ? h('p', { class: 'facts' }, s.notes) : null,
  h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: !S.meta.hideNotes, onchange: toggleNotes }),
    ' Show notes', h('span', { class: 'key-hint' }, ' (N)')));
const withPhotoKey = keys => (e, typing) => {
  if (!typing && e.key.toLowerCase() === 'p') { togglePhotos(); return; }
  if (!typing && e.key.toLowerCase() === 'n') { toggleNotes(); return; }
  keys && keys(e, typing);
};

// Hints step up one at a time, so most of the effort of recalling stays with you.
function hintArea(s, level, more) {
  const steps = Engine.nameHints(s.name, s.notes), shown = steps.slice(0, level);
  const lastName = shown.filter(x => x.kind === 'name').pop();
  return h('div', { class: 'hints' },
    shown.filter(x => x.kind === 'note').map(x => h('p', { class: 'facts' }, x.text)),
    lastName ? h('p', { class: 'hint-name' }, lastName.text) : null,
    level < steps.length ? h('button', { onclick: more }, level ? 'Another hint' : 'Hint', h('span', { class: 'key-hint' }, ' (H)')) : null);
}

// ---------- Practice sets: a chosen handful, through study, mix, and recall ----------
// Least known: shaky students you've met, then people not met yet, then everyone else by how soon they were due.
function leastKnownRank(r) {
  if (!r) return 2;
  return r.ivl < 1 ? 0 : r.ivl < 7 ? 1 : 3;
}
function pickSet(sec, how, size, metOnly) {
  const pool = onePerPerson(sectionStudents(sec)).filter(s => facesOf(s.id).length && (!metOnly || srsOf(s.id)));
  const mixed = shuffle(pool);
  if (how === 'random') return mixed.slice(0, size).map(s => s.id);
  const rec = s => srsOf(s.id);
  return mixed.sort((a, b) => leastKnownRank(rec(a)) - leastKnownRank(rec(b))
    || (rec(b)?.lapses || 0) - (rec(a)?.lapses || 0) || (rec(a)?.ivl || 0) - (rec(b)?.ivl || 0)).slice(0, size).map(s => s.id);
}
function startSet(sec, how, recallOnly) {
  const ids = pickSet(sec, how, S.meta.newPerSession || 10, recallOnly);
  if (!ids.length) { toast(recallOnly ? 'Recall needs people you’ve met. Meet some students first.' : 'No students with photos here yet.'); return; }
  startIds(sec, ids, { how, recallOnly });
}
function startIds(sec, ids, set) {
  const recallOnly = set.recallOnly;
  const chunks = [];
  for (let i = 0; i < ids.length; i += 5) chunks.push(ids.slice(i, i + 5));
  if (chunks.length > 1 && chunks[chunks.length - 1].length <= 2) chunks[chunks.length - 2].push(...chunks.pop());
  S.meet = { sec, chunks, ci: 0, phase: recallOnly ? 'recall' : 'meet', queue: recallOnly ? shuffle(ids) : [], qi: 0, picked: null, revealed: false,
    hint: 0, first: new Map(), set };
  render();
}

// One recall attempt counts toward the schedule. Someone not due yet only moves on a miss.
async function creditRecall(sid, ok, hinted = false) {
  const rec = srsOf(sid) || null, now = Date.now();
  if (ok && rec && rec.due > now) return;
  const r = { ...Engine.schedule(rec, !ok ? 1 : hinted ? 2 : 3, now), id: personOf(sid) };
  S.srs.set(r.id, r);
  await DB.put('srs', r);
}

// ---------- Who I keep missing ----------
function missedCard(sec) {
  const pool = onePerPerson(sectionStudents(sec)).filter(s => facesOf(s.id).length);
  const people = new Map(pool.map(s => [personOf(s.id), s]));
  const missed = pool.filter(s => srsOf(s.id)?.lapses > 0).sort((a, b) => srsOf(b.id).lapses - srsOf(a.id).lapses || naturalSort(a.name, b.name)).slice(0, 10);
  const pairs = new Map();
  for (const [k, n] of Object.entries(S.meta.confusions || {})) {
    const [a, b] = k.split('|').map(personOf);
    if (a === b || !people.has(a) || !people.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairs.set(key, (pairs.get(key) || 0) + n);
  }
  const topPairs = [...pairs].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => [...k.split('|').map(p => people.get(p)), n]);
  if (!missed.length && !topPairs.length) return null;
  return h('details', { class: 'card missed-card' },
    h('summary', null, h('b', null, 'Who I keep missing')),
    missed.length ? h('div', null,
      h('h4', null, 'Missed most'),
      h('div', { class: 'missed-list' }, missed.map(s => h('button', { class: 'pick', onclick: () => editStudent(s) }, avatarEl(s.id, 36),
        h('span', { class: 'pick-text' }, h('b', null, s.name), h('small', null, `missed ${srsOf(s.id).lapses} time${srsOf(s.id).lapses === 1 ? '' : 's'}`))))),
      h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: () => startIds(sec, missed.map(s => s.id), { ids: true }) }, 'Practice these'))) : null,
    topPairs.length ? h('div', null,
      h('h4', null, 'People I mix up'),
      h('div', { class: 'missed-list' }, topPairs.map(([a, b, n]) => h('button', { class: 'pick', onclick: () => startIds(sec, [a.id, b.id], { ids: true }) },
        avatarEl(a.id, 36), avatarEl(b.id, 36),
        h('span', { class: 'pick-text' }, h('b', null, `${a.name} & ${b.name}`), h('small', null, `mixed up ${n} time${n === 1 ? '' : 's'} · tap to practice`)))))) : null);
}

// ---------- Seating chart quiz: a face in a seat is the cue you'll have in class ----------
const chartStudents = sec => {
  const list = sectionStudents(sec).filter(s => facesOf(s.id).length);
  const placed = list.filter(s => s.pos);
  return placed.length ? { placed } : { seated: list.filter(s => s.row != null && s.seat != null) };
};
const hasChart = sec => { const c = chartStudents(sec); return (c.placed || c.seated).length > 0; };

function roomView() {
  const R = S.room, chart = chartStudents(R.sec), list = chart.placed || chart.seated;
  const got = list.filter(s => R.marks.get(s.id) === true).length, tried = list.filter(s => R.marks.has(s.id)).length;
  const ask = s => {
    const body = h('div', { class: 'flash room-ask' });
    const mark = async ok => {
      if (!R.marks.has(s.id)) await creditRecall(s.id, ok);
      R.marks.set(s.id, ok);
      dlg.close();
      render();
    };
    const dlg = modal('Who sits here?', body);
    body.append(faceGallery(s.id, true), h('p', { class: 'muted small' }, seatText(s)),
      h('button', { class: 'primary big', onclick: e => {
        e.currentTarget.replaceWith(h('h2', { class: 'name' }, s.name), notesArea(s),
          h('div', { class: 'grades two' },
            h('button', { class: 'grade again', onclick: () => mark(false) }, h('b', null, 'Missed it')),
            h('button', { class: 'grade good', onclick: () => mark(true) }, h('b', null, 'Got it'))));
      } }, 'Show name'));
  };
  const seats = {
    cls: s => (R.marks.get(s.id) === true ? 'known' : R.marks.get(s.id) === false ? 'missed' : 'new'),
    label: s => (R.marks.has(s.id) ? firstName(s) : ''),
    click: ask,
  };
  return h('div', { class: 'view' },
    h('div', { class: 'session-bar' },
      h('button', { class: 'link', onclick: () => { S.room = null; render(); } }, '← End'),
      h('span', null, h('b', null, R.sec), ` · ${tried} of ${list.length} tried · ${got} right`),
      h('button', { onclick: () => { R.marks = new Map(); render(); } }, 'Start over')),
    h('div', { class: 'card' },
      h('p', { class: 'muted small' }, 'Tap a seat, say the name, then check yourself. Green is right, red is missed.'),
      chart.placed ? floorPlan(list, seats) : seatingChart(list, seats)));
}

VIEWS.study = () => (S.room ? roomView() : S.meet ? meetView() : S.session ? sessionView() : studyHome());

function studyHome() {
  const wrap = h('div', { class: 'view' });
  if (!S.byStudent.size) {
    wrap.append(h('div', { class: 'card' },
      h('h2', null, 'Nothing to study yet'),
      h('p', null, 'Flashcards are made from student photos. Under Manage, add students with their photos, or label a class photo.'),
      h('button', { class: 'primary', onclick: () => goTo('roster') }, 'Go to Manage')));
    return wrap;
  }
  const sec = S.studySection ?? '';
  const c = studyCounts(sec);
  const perMeet = S.meta.newPerSession || 10;
  const newInput = h('input', { type: 'number', min: 3, max: 30, value: perMeet, style: { width: '4.5em' },
    onchange: async e => { S.meta.newPerSession = Math.min(30, Math.max(3, +e.target.value || 10)); await saveMeta(); render(); } });
  const start = mode => {
    const queue = buildQueue(sec, mode);
    if (!queue.length) { toast(c.met ? 'Nothing due. Try “Practice everyone.”' : 'Meet some students first.'); return; }
    S.session = { queue, i: 0, revealed: false, picking: false, face: null, seen: 0, again: 0, section: sec };
    render();
  };
  const nextMeet = meetChunks(sec, perMeet);
  const nextCount = nextMeet.flat().length;
  const nextGroups = [...new Set(nextMeet.flat().map(id => S.students.get(id).group).filter(Boolean))];
  const news = whatsNew();
  if (news) wrap.append(news);
  const paused = folderPausedTip();
  if (paused) wrap.append(paused);
  const stale = !paused && S.srs.size && (!S.meta.lastBackup || Date.now() - S.meta.lastBackup > 7 * Engine.DAY);
  if (stale) {
    const save = h('button', { onclick: async () => { save.disabled = true; save.textContent = 'Saving…'; await saveBackup(); render(); toast('Backup saved. Keep it somewhere safe.'); } }, 'Save a backup');
    wrap.append(h('div', { class: 'tip toolbar' }, h('span', { class: 'spacer' }, `Your progress is only in this browser. ${lastBackupText()}`), save));
  }
  const chartSections = sections().filter(hasChart);
  const roomSection = sec && chartSections.includes(sec) ? sec : chartSections.includes(S.roomSection) ? S.roomSection : chartSections[0];
  S.roomSection = roomSection;
  wrap.append(h('div', { class: 'card study-home' },
    h('div', { class: 'toolbar' }, sectionSelect(sec, v => { S.studySection = v; render(); }, { all: true })),
    h('div', { class: 'stats' },
      [['Not met yet', c.fresh], ['Due now', c.due], ['Learning', c.learning], ['Known', c.known]].map(([k, v]) =>
        h('div', { class: 'stat' }, h('b', null, String(v)), h('span', null, k)))),
    c.noPhoto ? h('p', { class: 'muted small' }, c.noPhoto === 1 ? '1 student has no photo yet, so isn’t included.'
      : `${c.noPhoto} students have no photo yet, so they aren’t included.`) : null),
  h('div', { class: 'study-paths' },
    h('div', { class: 'card' },
      h('h3', null, '1. Meet new students'),
      h('p', { class: 'muted small' }, 'See a few people at a time with their names, facts, and photos, then a quick check. ',
        'Groups of about 5 are what memory handles best; with a seating chart, each group is a table.'),
      h('button', { class: 'primary big', disabled: !nextCount, onclick: () => startMeet(sec) },
        nextCount ? `Meet ${nextCount} students${nextGroups.length ? ` (group${nextGroups.length > 1 ? 's' : ''} ${nextGroups.join(' & ')})` : ''}` : 'Everyone met'),
      h('label', { class: 'inline small' }, 'Students per session ', newInput)),
    h('div', { class: 'card' },
      h('h3', null, '2. Test yourself'),
      h('p', { class: 'muted small' }, 'Recall the people you’ve met, on a spaced schedule. Misses come back sooner; people you mix up are drilled together.'),
      h('button', { class: c.due && !nextCount ? 'primary big' : 'big', disabled: !c.due, onclick: () => start('due') },
        c.due ? `Review ${c.due} due` : c.met ? 'All caught up' : 'Nothing to review yet'),
      h('button', { disabled: !c.met, onclick: () => start('all') }, `Practice everyone met (${c.met})`),
      mixupToggle(render)),
    (() => {
      S.setHow = S.setHow || 'weak';
      return h('div', { class: 'card' },
        h('h3', null, '3. Practice a set'),
        h('p', { class: 'muted small' }, `Choose about ${perMeet} students and study, mix, and recall them, or go straight to recall.`),
        h('select', { 'aria-label': 'Which students', onchange: e => { S.setHow = e.target.value; } },
          h('option', { value: 'weak', selected: S.setHow === 'weak' }, 'Least known students'),
          h('option', { value: 'random', selected: S.setHow === 'random' }, 'Random students')),
        h('div', { class: 'toolbar' },
          h('button', { class: 'primary', disabled: !c.pool, onclick: () => startSet(sec, S.setHow, false) }, 'Study, mix, recall'),
          h('button', { disabled: !c.met, onclick: () => startSet(sec, S.setHow, true) }, 'Recall only')));
    })(),
    chartSections.length ? h('div', { class: 'card' },
      h('h3', null, '4. Seating chart quiz'),
      h('p', { class: 'muted small' }, 'Faces in their seats, names hidden. Tap a seat and recall who sits there.'),
      h('select', { 'aria-label': 'Section for the quiz', onchange: e => { S.roomSection = e.target.value; } },
        chartSections.map(x => h('option', { value: x, selected: x === roomSection }, x))),
      h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: () => { S.room = { sec: S.roomSection, marks: new Map() }; render(); } }, 'Start the quiz'))) : null),
    missedCard(sec));

  const secs = sections();
  if (secs.length > 1) {
    wrap.append(h('div', { class: 'card' }, h('h3', null, 'Before class'),
      h('p', { class: 'muted small' }, 'Drill the section you’re about to teach.'),
      h('div', { class: 'section-list' }, secs.map(s => {
        const sc = studyCounts(s);
        return h('button', { class: 'section-btn', onclick: () => { S.studySection = s; render(); } },
          h('b', null, s), h('span', null, `${sc.known} of ${sc.pool} known · ${sc.due} due · ${sc.fresh} not met`));
      }))));
  }
  return wrap;
}

function sessionView() {
  const ss = S.session;
  const wrap = h('div', { class: 'view study' });
  const end = () => { S.session = null; render(); };

  if (ss.i >= ss.queue.length) {
    wrap.append(h('div', { class: 'card done' },
      h('h2', null, 'Session done'),
      h('p', null, `You reviewed ${ss.seen} faces${ss.again ? `; ${ss.again} needed another look` : ''}.`),
      h('button', { class: 'primary', onclick: end }, 'Back')));
    S.onKey = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); end(); } };
    return wrap;
  }

  const item = ss.queue[ss.i];
  const s = S.students.get(item.sid);
  if (!s || !facesOf(item.sid).length) { ss.i++; return sessionView(); }
  const now = Date.now();
  const rec = srsOf(item.sid);

  // Practicing ahead of schedule is massed practice: a success doesn't earn a longer gap, and only a miss changes the date.
  const early = rec && rec.due > now;
  const advance = () => { ss.i++; ss.revealed = false; ss.picking = false; ss.hint = 0; render(); };
  const grade = async g => {
    if (ss.hint) g = Math.min(g, 2);  // a hinted answer counts as Hard at most
    if (!early || g === 1) {
      const r = { ...Engine.schedule(rec, g, now), id: personOf(item.sid) };
      S.srs.set(r.id, r);
      await DB.put('srs', r);
    }
    ss.seen++;
    if (g === 1) {
      ss.again++;
      ss.queue.splice(Math.min(ss.i + 4, ss.queue.length), 0, { sid: item.sid });
      if (S.meta.skipMixupQuestion) advance();
      else { ss.picking = true; render(); }
    } else advance();
  };
  const confusedAs = async other => {
    if (other) {
      const k = pairKey(item.sid, other);
      S.meta.confusions = S.meta.confusions || {};
      S.meta.confusions[k] = (S.meta.confusions[k] || 0) + 1;
      await saveMeta();
      // Someone not met yet is drilled once they've been met; a graded card here would skip Meet.
      if (srsOf(other)) ss.queue.splice(ss.i + 1, 0, { sid: other, compareWith: item.sid });
    }
    advance();
  };

  const bar = h('div', { class: 'session-bar' },
    h('button', { class: 'link', onclick: end }, '← End session'),
    h('progress', { max: ss.queue.length, value: ss.i }),
    h('span', { class: 'muted small' }, `${ss.i + 1} / ${ss.queue.length}`), photoToggle());

  const card = h('div', { class: 'card flash' });
  if (item.compareWith && S.students.get(item.compareWith)) {
    card.append(h('p', { class: 'note' }, `You’ve mixed this person up with ${S.students.get(item.compareWith).name}. Look for what’s different.`));
  }
  card.append(faceGallery(item.sid, true));

  if (!ss.revealed) {
    const more = () => { const n = Engine.nameHints(s.name, s.notes).length; if ((ss.hint || 0) < n) { ss.hint = (ss.hint || 0) + 1; render(); } };
    card.append(hintArea(s, ss.hint || 0, more),
      h('button', { class: 'primary big', onclick: () => { ss.revealed = true; render(); } }, 'Show name', h('span', { class: 'key-hint' }, ' (Space)')));
    S.onKey = (e, typing) => {
      if (typing) return;
      if (e.key.toLowerCase() === 'h') more();
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ss.revealed = true; render(); }
    };
  } else if (ss.picking) {
    const looks = lookalikes(item.sid);
    card.append(h('h2', { class: 'name' }, nameLink(s)),
      h('p', null, 'Who did you think it was? Picking someone drills the two of you together.'),
      h('div', { class: 'alts grid' }, looks.map((id, i) =>
        h('button', { class: 'pick', onclick: () => confusedAs(id) }, h('kbd', null, String(i + 1)), avatarEl(id, 44),
          h('span', { class: 'pick-text' }, h('b', null, S.students.get(id).name))))),
      h('button', { onclick: () => confusedAs(null) }, 'I didn’t know', h('span', { class: 'key-hint' }, ' (0)')),
      mixupToggle(advance));
    S.onKey = (e, typing) => {
      if (typing) return;
      if (e.key === '0' || e.key === 'Escape') confusedAs(null);
      else if (/^[1-6]$/.test(e.key) && looks[+e.key - 1]) confusedAs(looks[+e.key - 1]);
    };
  } else {
    const label = g => Engine.formatInterval((early && g > 1 ? rec.due : Engine.schedule(rec, g, now).due) - now);
    card.append(
      h('h2', { class: 'name' }, nameLink(s)),
      h('p', { class: 'muted' }, [s.section, s.group ? `group ${s.group}` : '', seatText(s)].filter(Boolean).join(' · ')),
      notesArea(s),
      ss.hint ? h('p', { class: 'muted small' }, 'You used a hint, so this counts as Hard at most.') : '',
      early ? h('p', { class: 'muted small' }, 'Ahead of schedule: only a miss changes the next review date.') : '',
      h('div', { class: 'grades' },
        [[1, 'Again', 'again'], [2, 'Hard', 'hard'], [3, 'Good', 'good'], [4, 'Easy', 'easy']].map(([g, t, c]) =>
          h('button', { class: `grade ${c}`, disabled: !!ss.hint && g > 2, onclick: () => grade(g) }, h('b', null, t), h('small', null, h('span', { class: 'key-hint' }, `${g} · `), label(g))))));
    S.onKey = (e, typing) => { if (!typing && /^[1-4]$/.test(e.key)) grade(+e.key); };
  }
  S.onKey = ss.picking ? S.onKey : withPhotoKey(S.onKey);
  wrap.append(bar, card);
  return wrap;
}

// ---------- Meet: study new students before being quizzed on them ----------
// About 10 per session, in chunks of ~5 (roughly what working memory holds at once). With a seating chart,
// each chunk is one table group, so you also learn who sits together. Each chunk: see everyone with names,
// facts, and all their photos; then a quick pick-the-name check with feedback. After all chunks, a mixed
// recall round of everyone; first-try results hand off to the regular spaced reviews.

function meetChunks(sec, size) {
  const unmet = onePerPerson(sectionStudents(sec)).filter(s => facesOf(s.id).length && !srsOf(s.id))
    .sort((a, b) => naturalSort(a.section, b.section) || naturalSort(a.group || '', b.group || '') ||
      naturalSort(a.seatLabel || '', b.seatLabel || '') || naturalSort(a.name, b.name));
  const chunks = [];
  if (unmet.some(s => s.group)) {
    const byGroup = new Map();
    for (const s of unmet) {
      const k = `${s.section}|${s.group || ''}`;
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push(s.id);
    }
    for (const ids of byGroup.values()) {
      for (let i = 0; i < ids.length; i += 6) chunks.push(ids.slice(i, i + 6));
    }
    // Fold leftovers of 1-2 students into the previous chunk when it stays small.
    for (let i = chunks.length - 1; i > 0; i--) {
      if (chunks[i].length <= 2 && chunks[i - 1].length + chunks[i].length <= 7) { chunks[i - 1].push(...chunks[i]); chunks.splice(i, 1); }
    }
  } else {
    for (let i = 0; i < unmet.length; i += 5) chunks.push(unmet.slice(i, i + 5).map(s => s.id));
  }
  const out = [];
  let total = 0;
  for (const c of chunks) {
    if (out.length && total + c.length > size + 2) break;
    out.push(c);
    total += c.length;
    if (total >= size) break;
  }
  return out;
}

function startMeet(sec) {
  const chunks = meetChunks(sec, S.meta.newPerSession || 10);
  if (!chunks.length) { toast('Everyone with a photo has been met.'); return; }
  S.meet = { sec, chunks, ci: 0, phase: 'meet', queue: [], qi: 0, picked: null, revealed: false, first: new Map() };
  render();
}

function meetView() {
  const M = S.meet;
  // A student can be deleted, or lose their last photo, from their record during the session.
  const here = id => S.students.has(id) && facesOf(id).length > 0;
  M.chunks = M.chunks.map(c => c.filter(here)).filter(c => c.length);
  M.qi = M.queue.slice(0, M.qi).filter(here).length;
  M.queue = M.queue.filter(here);
  if (!M.chunks.length) { S.meet = null; return studyHome(); }
  M.ci = Math.min(M.ci, M.chunks.length - 1);
  const all = M.chunks.flat();
  const wrap = h('div', { class: 'view meet' });
  const end = () => { S.meet = null; render(); };
  const name = id => S.students.get(id)?.name || '?';
  const begin = (phase, ids) => { Object.assign(M, { phase, queue: shuffle(ids), qi: 0, picked: null, revealed: false, hint: 0, face: null }); render(); };
  const toGroup = i => { Object.assign(M, { ci: i, phase: 'meet', queue: [], qi: 0, picked: null, revealed: false, hint: 0 }); render(); };
  const nextPhase = () => {
    if (M.phase === 'check') {
      if (M.ci + 1 < M.chunks.length) { M.ci++; M.phase = 'meet'; render(); }
      else if (M.chunks.length > 1) begin('mixed', all);
      else begin('recall', all);
    } else if (M.phase === 'mixed') begin('recall', all);
    else { M.phase = 'done'; render(); }
  };
  const advance = () => {
    M.qi++; M.picked = null; M.revealed = false; M.hint = 0;
    if (M.qi >= M.queue.length) nextPhase(); else render();
  };

  if (['check', 'mixed', 'recall'].includes(M.phase) && M.qi >= M.queue.length) { queueMicrotask(nextPhase); return wrap; }

  const late = ['mixed', 'recall', 'done'].includes(M.phase);
  const stepClass = (done, cur) => (done ? 'on' : cur ? 'cur' : '');
  const step = (cls, label, go) => h('button', { class: cls, onclick: go }, label);
  wrap.append(h('div', { class: 'session-bar' },
    h('button', { class: 'link', onclick: end }, '← End'),
    h('span', { class: 'meet-steps' },
      M.chunks.map((c, i) => step(stepClass(late || i < M.ci, !late && i === M.ci), `Group ${i + 1}`, () => toGroup(i))),
      M.chunks.length > 1 ? step(stepClass(['recall', 'done'].includes(M.phase), M.phase === 'mixed'), 'Mix', () => begin('mixed', all)) : null,
      step(stepClass(M.phase === 'done', M.phase === 'recall'), 'Recall', () => begin('recall', all)))));

  if (M.phase === 'meet') {
    const ids = M.chunks[M.ci];
    const first = S.students.get(ids[0]);
    const groupText = first?.group && ids.every(id => S.students.get(id).group === first.group) ? ` — group ${first.group}` : '';
    wrap.append(h('div', { class: 'card' },
      h('h2', null, `Meet ${ids.length} students${groupText}`),
      h('p', { class: 'tip' }, 'For each person: say the name out loud, pick one feature that stands out (hair, glasses, smile, eyebrows…), ',
        'and link it to the name. Look at every photo; people look different from shot to shot.'),
      h('div', { class: 'meet-grid' }, ids.map(id => {
        const s = S.students.get(id);
        const fs = facesOf(id);
        const main = mainFace(fs);
        // The name stays in view while scrolling down a column of photos.
        return h('div', { class: 'meet-card' },
          h('div', { class: 'meet-name' }, h('h3', null, nameLink(s)),
            h('p', { class: 'muted small' }, [s.group ? `group ${s.group}` : '', seatText(s)].filter(Boolean).join(' · '))),
          [main, ...fs.filter(f => f !== main)].map(f => h('img', { class: 'meet-photo', src: f.thumb, alt: s.name })),
          s.notes ? h('p', { class: 'facts small' }, s.notes) : null);
      })),
      h('div', { class: 'toolbar meet-actions' },
        h('button', { class: 'primary big', onclick: () => begin('check', ids) }, 'I’ve studied them — quiz me', h('span', { class: 'key-hint' }, ' (Enter)')),
        h('button', { onclick: () => begin('recall', all) }, 'Go to recall'))));
    S.onKey = (e, typing) => { if (!typing && e.key === 'Enter') { e.preventDefault(); begin('check', ids); } };
    return wrap;
  }

  if (M.phase === 'done') {
    const firstTry = [...M.first.values()].filter(Boolean).length;
    const more = meetChunks(M.sec, S.meta.newPerSession || 10).length > 0;
    wrap.append(h('div', { class: 'card done' },
      h('h2', null, M.set ? `You practiced ${all.length} students` : `You met ${all.length} students`),
      h('p', null, `${firstTry} of ${all.length} recalled on the first try without a hint.`),
      h('p', { class: 'muted' }, M.set ? 'Anyone you missed comes back in about 10 minutes. ' : 'They’re now in your Study deck: anyone you missed comes back in about 10 minutes, the rest tomorrow. ',
        'A short break before the next batch helps the names settle.'),
      h('div', { class: 'toolbar' },
        M.set?.ids ? null : M.set ? h('button', { onclick: () => startSet(M.sec, M.set.how, M.set.recallOnly) }, 'Another set')
          : more ? h('button', { onclick: () => startMeet(M.sec) }, `Meet the next ${S.meta.newPerSession || 10}`) : null,
        h('button', { class: 'primary', onclick: end }, 'Done'))));
    S.onKey = (e, typing) => { if (!typing && e.key === 'Enter') { e.preventDefault(); end(); } };
    return wrap;
  }

  const sid = M.queue[M.qi];
  const card = h('div', { class: 'card flash' },
    h('p', { class: 'muted small' }, `${{ check: 'Quick check', mixed: 'Mix it up', recall: 'Recall' }[M.phase]} · ${M.qi + 1} of ${M.queue.length}`),
    M.phase === 'recall' ? photoToggle() : '',
    faceGallery(sid, M.phase === 'recall'));

  if (M.phase === 'check' || M.phase === 'mixed') {
    const options = (M.phase === 'check' ? M.chunks[M.ci] : all).slice().sort((a, b) => naturalSort(name(a), name(b)));
    const choose = id => {
      if (M.picked) return;
      M.picked = id;
      if (id === sid) { render(); setTimeout(() => { if (M.picked === id && M.queue[M.qi] === sid) advance(); }, 700); }
      else { M.queue.push(sid); render(); }
    };
    const wrong = M.picked && M.picked !== sid;
    card.append(
      h('p', null, M.picked ? (wrong ? h('span', null, 'This is ', h('b', null, name(sid)), '.') : h('b', { class: 'ok' }, `✓ ${name(sid)}`)) : 'Who is this?'),
      h('div', { class: 'choices' }, options.map((id, i) => h('button', {
        class: `choice${M.picked && id === sid ? ' right' : ''}${wrong && id === M.picked ? ' wrong' : ''}`,
        disabled: !!M.picked && id !== sid && id !== M.picked, onclick: () => choose(id),
      }, i < 10 ? h('kbd', null, String((i + 1) % 10)) : null, name(id)))),
      wrong && S.students.get(sid).notes ? notesArea(S.students.get(sid)) : '',
      wrong ? h('button', { class: 'primary', onclick: advance }, 'Next', h('span', { class: 'key-hint' }, ' (Enter)')) : '');
    S.onKey = (e, typing) => {
      if (typing) return;
      if (wrong && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); return; }
      if (wrong && e.key.toLowerCase() === 'n') { toggleNotes(); return; }
      if (/^[0-9]$/.test(e.key)) { const i = e.key === '0' ? 9 : +e.key - 1; if (options[i]) choose(options[i]); }
    };
  } else {
    const s = S.students.get(sid);
    const mark = async ok => {
      const hinted = ok && M.hint > 0;
      if (!M.first.has(sid)) {
        M.first.set(sid, ok && !hinted);
        await creditRecall(sid, ok, hinted);
      }
      if (!ok || hinted) M.queue.splice(Math.min(M.qi + 3, M.queue.length), 0, sid);  // try again later, unaided
      advance();
    };
    if (!M.revealed) {
      const more = () => { if ((M.hint || 0) < Engine.nameHints(s.name, s.notes).length) { M.hint = (M.hint || 0) + 1; render(); } };
      card.append(h('p', null, 'Say the name, then check yourself.'), hintArea(s, M.hint || 0, more),
        h('button', { class: 'primary big', onclick: () => { M.revealed = true; render(); } }, 'Show name', h('span', { class: 'key-hint' }, ' (Space)')));
      S.onKey = withPhotoKey((e, typing) => {
        if (typing) return;
        if (e.key.toLowerCase() === 'h') more();
        else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); M.revealed = true; render(); }
      });
    } else {
      card.append(h('h2', { class: 'name' }, nameLink(s)), notesArea(s),
        M.hint ? h('p', { class: 'muted small' }, 'You used a hint, so this comes back once more to try without one.') : '',
        h('div', { class: 'grades two' },
          h('button', { class: 'grade again', onclick: () => mark(false) }, h('b', null, 'Missed it'), h('small', { class: 'key-hint' }, '1')),
          h('button', { class: 'grade good', onclick: () => mark(true) }, h('b', null, 'Got it'), h('small', { class: 'key-hint' }, '2'))));
      S.onKey = withPhotoKey((e, typing) => { if (!typing && (e.key === '1' || e.key === '2')) mark(e.key === '2'); });
    }
  }
  wrap.append(card);
  return wrap;
}
