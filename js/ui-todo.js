/* Needs attention: what's missing or unfinished in the sections shown, each with a way to fix it. */

const pairKeyOf = (a, b) => [a, b].sort().join('|');

// Records in different sections that may be one student: close faces and a shared first or last name (a name
// change), or very close faces alone. Linked records and pairs marked "not the same" are left out.
function possibleSamePeople(list) {
  const people = onePerPerson(list).map(s => ({ s, c: centroid(s.id), parts: Engine.normName(s.name).split(' ') })).filter(p => p.c);
  const notSame = S.meta.notSame || {}, out = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = people[i], b = people[j];
    if (a.s.section === b.s.section || a.s.sample || b.s.sample || notSame[pairKeyOf(personOf(a.s.id), personOf(b.s.id))]) continue;
    const d = Engine.descDist(a.c, b.c);
    const shared = a.parts[0] === b.parts[0] || a.parts[a.parts.length - 1] === b.parts[b.parts.length - 1];
    if (d < 0.32 || (shared && d < 0.45)) out.push({ a: a.s, b: b.s, d });
  }
  return out.sort((x, y) => x.d - y.d).slice(0, 20);
}

function todoItems() {
  const secs = sections().filter(x => x !== SAMPLE_SECTION);
  const inShown = new Set(secs);
  const list = [...S.students.values()].filter(s => inShown.has(s.section) && !s.sample);
  const noPhoto = list.filter(s => !facesOf(s.id).length).sort((a, b) => naturalSort(a.section, b.section) || naturalSort(a.name, b.name));
  const photos = [...S.photos.values()].filter(p => inShown.has(p.section)).map(p => ({
    p, open: photoFaces(p.id).filter(f => f.status !== 'confirmed' && f.status !== 'rejected').length,
  })).filter(x => x.open).sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
  const noChart = secs.filter(x => !sectionStudents(x).some(s => s.pos || (s.row != null && s.seat != null)));
  return { secs, noPhoto, photos, noChart, same: possibleSamePeople([...S.students.values()].filter(s => !s.sample)) };
}
const todoCount = () => { const t = todoItems(); return t.noPhoto.length + t.photos.length + t.noChart.length + t.same.length; };

VIEWS.todo = () => {
  const wrap = h('div', { class: 'view' });
  if (!S.students.size) {
    wrap.append(h('div', { class: 'card' }, h('p', null, 'Nothing to check yet: import your students first.'),
      h('button', { class: 'primary', onclick: () => goTo('roster') }, 'Go to Students')));
    return wrap;
  }
  const t = todoItems();
  const card = (title, why, body) => h('div', { class: 'card' }, h('h3', null, title), h('p', { class: 'muted small' }, why), body);
  if (!t.noPhoto.length && !t.photos.length && !t.noChart.length && !t.same.length) {
    wrap.append(h('div', { class: 'card' }, h('h3', null, 'Nothing needs attention'),
      h('p', { class: 'muted' }, `Every student in ${t.secs.length === 1 ? t.secs[0] : 'the sections shown'} has a photo, every class photo is finished, and every section has a seating chart.`)));
    return wrap;
  }
  if (t.noPhoto.length) {
    wrap.append(card(`${t.noPhoto.length} student${t.noPhoto.length === 1 ? '' : 's'} without a photo`,
      'They can’t be studied yet. Open one to add a photo from their student card, or import the section’s roll or chart again.',
      h('div', { class: 'thumb-row' }, t.noPhoto.map(s => h('button', { class: 'chip person', onclick: () => editStudent(s) }, avatarEl(s.id, 28), `${s.name} · ${s.section}`)))));
  }
  if (t.photos.length) {
    wrap.append(card(`${t.photos.length} class photo${t.photos.length === 1 ? '' : 's'} to finish`,
      'Faces still waiting for a name. Each one you confirm adds a photo to that student’s flashcards.',
      h('div', { class: 'section-rows' }, t.photos.map(({ p, open }) => h('div', { class: 'section-row' },
        h('span', null, h('b', null, p.section), h('span', { class: 'muted small' }, ` · ${p.date} · ${open} face${open === 1 ? '' : 's'} to check`)),
        h('button', { onclick: () => { S.section = p.section; S.reviewPhoto = p.id; S.view = 'label'; render(); } }, 'Open'))))));
  }
  if (t.noChart.length) {
    wrap.append(card(`${t.noChart.length} section${t.noChart.length === 1 ? '' : 's'} without a seating chart`,
      'A chart adds seats for the seating-chart quiz and the in-class view, and helps match faces in class photos.',
      h('div', null, h('p', null, t.noChart.join(', ')), h('div', { class: 'toolbar' }, h('button', { onclick: importSeatingCharts }, 'Import seating chart')))));
  }
  if (t.same.length) {
    const link = async (a, b) => {
      const group = await mergePeople(S.students.get(a.id), S.students.get(b.id));
      if (!group) { toast('They can’t be linked: that would put one person in a section twice.'); return; }
      await saveStudents(group); reindex(); render();
      toast(`Linked ${a.name} and ${b.name}: they now share photos and study progress.`);
    };
    const notSame = async (a, b) => {
      S.meta.notSame = S.meta.notSame || {};
      S.meta.notSame[pairKeyOf(personOf(a.id), personOf(b.id))] = Date.now();
      await saveMeta(); render();
    };
    wrap.append(card('Maybe the same student', 'Similar faces in different sections, often after a name change. Linking shares their photos and study progress.',
      h('div', { class: 'section-rows' }, t.same.map(({ a, b }) => h('div', { class: 'section-row' },
        h('span', { class: 'toolbar' }, avatarEl(a.id, 36), avatarEl(b.id, 36), h('span', null, `${a.name} (${a.section}) and ${b.name} (${b.section})`)),
        h('span', { class: 'toolbar' },
          h('button', { onclick: () => link(a, b) }, 'Same student'),
          h('button', { onclick: () => notSame(a, b) }, 'Not the same')))))));
  }
  return wrap;
};

// ---------- In class: who sits where, names showing ----------
function cheatView() {
  const C = S.cheat;
  const secs = sections();
  if (!secs.includes(C.sec)) C.sec = secs[0] || '';
  const list = sectionStudents(C.sec);
  const query = C.query || '';
  const hit = s => !query.trim() || Engine.nameMatches(query, s);
  const show = s => {
    const dlg = modal(s.name, h('div', { class: 'flash' }, faceGallery(s.id, false),
      h('p', { class: 'muted' }, [s.group ? `group ${s.group}` : '', seatText(s)].filter(Boolean).join(' · ')), notesArea(s)));
    return dlg;
  };
  const seats = { cls: s => `${knowledgeOf(s.id)}${hit(s) ? '' : ' dim'}`, label: firstName, click: show, title: true };
  const placed = list.filter(s => s.pos), seated = list.filter(s => !s.pos && s.row != null && s.seat != null);
  const search = h('input', { type: 'search', placeholder: 'Find a name', 'aria-label': 'Find a student', value: query,
    oninput: e => { C.query = e.target.value; const pos = e.target.selectionStart; render(); const box = document.querySelector('.cheat-search'); if (box) { box.focus(); box.setSelectionRange(pos, pos); } },
    class: 'cheat-search' });
  const chart = placed.length ? floorPlan(placed, seats) : seated.length ? seatingChart(seated, seats) : null;
  const others = list.filter(s => !(placed.length ? placed : seated).includes(s));
  return h('div', { class: 'view' },
    h('div', { class: 'session-bar cheat-bar' },
      h('button', { class: 'link', onclick: () => { S.cheat = null; render(); } }, '← Back'),
      h('select', { 'aria-label': 'Section', onchange: e => { C.sec = e.target.value; render(); } }, secs.map(x => h('option', { value: x, selected: x === C.sec }, x))),
      search),
    chart ? h('div', { class: 'card' }, h('p', { class: 'muted small' }, 'Names showing. Tap a seat for their photos and notes.'), chart) : null,
    others.length ? h('div', { class: 'card' }, h('h3', null, chart ? 'Not on the chart' : `${list.length} students`),
      h('div', { class: 'cheat-list' }, others.filter(hit).map(s => h('button', { class: 'cheat-person', onclick: () => show(s) }, avatarEl(s.id, 56), h('span', null, s.name))))) : null);
}
