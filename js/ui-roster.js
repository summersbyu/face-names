/* Manage: students (imports, seating chart, roster photos, student details) and sections. */

// Sections are shown by name alone, so each import needs a name of its own. Reusing one updates that section.
async function askSectionName(message, suggested = '') {
  let value = suggested;
  for (;;) {
    const name = await promptBox('Name this section', message, value);
    if (name === null) return null;
    if (!name) { toast('The section needs a name, like F26-1.'); continue; }
    if (!allSections().includes(name)) return name;
    const n = sectionStudents(name).length;
    if (await confirmBox(`“${name}” already exists, with ${n} student${n === 1 ? '' : 's'}. Update it with this file? To keep them apart, cancel and choose a different name.`, 'Update it')) return name;
    value = name;
  }
}

function promptBox(title, label, value = '') {
  return new Promise(resolve => {
    let out = null;
    const input = h('input', { type: 'text', value });
    const dlg = modal(title, h('label', { class: 'field' }, label, input), {
      actions: [
        h('button', { onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: 'primary', onclick: () => { out = input.value.trim(); dlg.close(); } }, 'OK'),
      ],
      onClose: () => resolve(out),
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { out = input.value.trim(); dlg.close(); } });
    input.focus();
  });
}

function formatHelp() {
  return h('details', { class: 'help' },
    h('summary', null, 'File formats'),
    h('h4', null, 'Seating chart: PDF with photos'),
    h('p', null, 'Charts with a headshot, first name, last name, and a “group.seat” number (like 2.4) for each student. ',
      'Choose all the PDFs at once; each asks for a section name (suggested from the chart, e.g. “F26-1”). ',
      'Students’ positions on the chart become the room’s seat map for matching class photos. ',
      'Importing a chart again updates the same students and replaces their chart photo.'),
    h('h4', null, 'Picture roll'),
    h('ol', null,
      h('li', null, 'Click ', h('b', null, 'Import picture roll'), ' and drag the ', h('b', null, 'Save picture roll'), ' button to your bookmarks bar (once).'),
      h('li', null, 'Open a section’s class photo roll and click that bookmark. It loads every photo and saves the roll as one file in Downloads. Repeat for each section.'),
      h('li', null, 'Click ', h('b', null, 'Import picture roll'), ', then ', h('b', null, 'Choose saved roll files'), ', and pick them all. Names, preferred names, and photos come in together; each roll asks for a section name.')),
    h('p', null, 'Saved with Ctrl+S → “Webpage, Complete” instead? Choose ', h('b', null, 'Choose a folder'), ' and pick the folder that holds the page and its _files folder.'),
    h('p', null, 'Students are listed by preferred name (“Allen Rivera”); their legal name still matches in roster and seating-chart files. ',
      'Importing a page again updates the same students and replaces their roll photo.'),
    h('h4', null, 'Roster CSV (one row per student)'),
    h('p', null, 'Needs a header row. Recognized columns: ', h('code', null, 'Section, Name'), ' (or ',
      h('code', null, 'First Name, Last Name'), '), ', h('code', null, 'Group, Row, Seat, Photo, Notes'),
      '. Any other columns (hometown, major…) are kept as facts shown on the flashcards. Only Name is required. ',
      'Importing again updates existing students instead of duplicating them, and notes you typed yourself are kept.'),
    h('pre', null, 'Section,First Name,Last Name,Group,Row,Seat,Hometown\n1,Maria,Garcia,A,1,1,"Mesa, AZ"\n1,Sam,Lee,A,1,2,Boise'),
    h('h4', null, 'Seating chart: CSV laid out like the room'),
    h('p', null, 'No header. Each cell is a student’s name, placed where they sit; leave empty seats blank. ',
      'First names or “Maria G” work if they’re unique in the section. Which edge is the front doesn’t matter, ',
      'as long as the grid matches the room. This only seats students already in the section, so import them first; it asks which section.'),
    h('pre', null, 'Maria Garcia,Sam Lee,,Ana Ruiz,Ben Cho\nTom Hale,Ivy Park,,Jo Kim,Raj Patel'),
    h('h4', null, 'Student photos'),
    h('p', null, 'One photo per person (roster photos or headshots). Name the files after the student (',
      h('code', null, 'Maria Garcia.jpg'), ') or list the file name in the roster’s Photo column, and they’re matched automatically.'));
}

// Search box for the Students page: looks through every section, one row per person. The text stays through re-renders.
let studentQuery = '';
function studentSearch() {
  const results = h('div', { class: 'search-results' });
  const found = () => onePerPerson([...S.students.values()]
    .sort((a, b) => (b.section === S.section) - (a.section === S.section))
    .filter(s => Engine.nameMatches(studentQuery, s)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const STATUS = { known: 'Known', learning: 'Learning', new: 'Not met' };
  const draw = () => {
    const list = found();
    results.replaceChildren(...list.slice(0, 20).map(s => h('button', { class: 'search-result', onclick: () => editStudent(s) },
      avatarEl(s.id, 36),
      h('span', null, h('b', null, s.name), h('span', { class: 'muted small' }, ` · ${[s, ...linkedOf(s.id)].map(o => o.section).join(', ')}`)),
      h('span', { class: 'muted small' }, STATUS[knowledgeOf(s.id)]))));
    if (studentQuery.trim() && !list.length) results.append(h('p', { class: 'muted small' }, 'No student by that name.'));
    if (list.length > 20) results.append(h('p', { class: 'muted small' }, `Showing 20 of ${list.length}. Type more of the name.`));
  };
  draw();
  return h('div', { class: 'student-search' },
    h('input', { type: 'search', placeholder: 'Search all students by name', 'aria-label': 'Search students', value: studentQuery,
      oninput: e => { studentQuery = e.target.value; draw(); },
      onkeydown: e => { if (e.key === 'Enter') { const [first] = found(); if (first) editStudent(first); } } }),
    results);
}

VIEWS.roster = () => {
  const secs = sections();
  const list = sectionStudents(S.section);
  const wrap = h('div', { class: 'view' });
  wrap.append(h('div', { class: 'toolbar' },
    secs.length ? sectionSelect(S.section, v => { S.section = v; render(); }) : null,
    h('button', { class: 'primary', onclick: importSeatingCharts }, 'Import seating chart'),
    h('button', { class: 'needs-computer', onclick: importRollPages }, 'Import picture roll'),
    h('button', { onclick: importRoster }, 'Import roster CSV'),
    h('button', { onclick: addPortraits, disabled: !S.students.size }, 'Add student photos'),
    h('button', { onclick: () => editStudent(null) }, 'Add student')));

  if (!S.students.size) {
    const choice = (title, text, onclick, cls = '') => h('button', { class: `start-choice ${cls}`, onclick }, h('b', null, title), h('span', { class: 'muted small' }, text));
    const openFile = () => { S.openFileNow = true; goTo('backup'); };
    wrap.append(h('div', { class: 'card intro' },
      h('h2', null, 'Welcome'),
      h('p', null, 'Where are your students coming from? You can add more later.'),
      h('div', { class: 'choice-grid' },
        choice('Try a sample class first', '20 made-up students with faces, seats, and facts. No real student data; remove it in one click.', loadSample, 'try-sample'),
        choice('A file from a colleague', 'A student file with names, photos, and labels, ready to study. Your progress is your own.', openFile),
        choice('Seating chart PDFs', 'Names, groups, seats, and a photo of each student.', importSeatingCharts),
        choice('The class photo roll', 'Names, preferred names, and photos from the university’s roll page.', importRollPages, 'needs-computer'),
        choice('A roster spreadsheet (CSV)', 'Names, plus groups, seats, and facts for the flashcards.', importRoster),
        choice('My own backup', 'Moving from another device or browser.', openFile)),
      h('p', null, 'Next, add class photos under ', h('b', null, 'Class Photos'), ' if you like, and practice under ', h('b', null, 'Study'), '.'),
      h('p', { class: 'muted' }, 'Everything is stored only in this browser on this device. Nothing is uploaded. Use Backup to save a copy.')),
      formatHelp());
    return wrap;
  }

  wrap.append(studentSearch(), formatHelp());
  const placed = list.filter(s => s.pos);
  const seated = list.filter(s => !s.pos && s.row != null && s.seat != null);
  if (placed.length) wrap.append(floorPlan(placed));
  else if (seated.length) wrap.append(seatingChart(seated));

  const now = Date.now();
  wrap.append(h('div', { class: 'card' },
    h('h3', null, `${list.length} students`),
    h('table', { class: 'students' },
      h('thead', null, h('tr', null, ['', 'Name', 'Group', 'Seat', 'Photos', 'Study'].map(t => h('th', null, t)))),
      h('tbody', null, list.map(s => {
        const r = srsOf(s.id);
        const status = !r ? 'new' : r.ivl >= 1 ? `known · next in ${Engine.formatInterval(Math.max(0, r.due - now))}` : 'learning';
        return h('tr', { onclick: () => editStudent(s), tabindex: 0, onkeydown: e => { if (e.key === 'Enter') editStudent(s); } },
          h('td', null, avatarEl(s.id, 36)),
          h('td', null, s.name, linkedOf(s.id).length ? h('span', { class: 'muted small' }, ` · also ${linkedOf(s.id).map(o => o.section).join(', ')}`) : null),
          h('td', null, s.group || ''),
          h('td', null, seatText(s)),
          h('td', null, String(facesOf(s.id).length)),
          h('td', { class: 'muted' }, status));
      })))));
  return wrap;
};

// How well a student is known, the same way the Study tab counts it. Seats on the chart are colored by this.
const knowledgeOf = sid => { const r = srsOf(sid); return !r ? 'new' : r.ivl >= 1 ? 'known' : 'learning'; };

function seatKey(list) {
  const count = k => list.filter(s => knowledgeOf(s.id) === k).length;
  return h('div', { class: 'legend small seat-key' }, [['known', 'Known'], ['learning', 'Learning'], ['new', 'Not met']].map(([k, label]) =>
    h('span', { class: `seat-swatch ${k}` }, `${label}: ${count(k)}`)));
}

// A quiz reuses the charts with its own colors, labels, and click.
const plainSeats = { cls: s => knowledgeOf(s.id), label: firstName, click: s => editStudent(s), title: true };

function seatingChart(seated, seats = plainSeats) {
  const rows = seated.map(s => +s.row), cols = seated.map(s => +s.seat);
  const r0 = Math.min(...rows), r1 = Math.max(...rows), c0 = Math.min(...cols), c1 = Math.max(...cols);
  const grid = h('div', { class: 'seat-grid', style: { gridTemplateColumns: `auto repeat(${c1 - c0 + 1}, minmax(64px, 1fr))` } });
  const at = new Map(seated.map(s => [`${s.row}|${s.seat}`, s]));
  for (let r = r0; r <= r1; r++) {
    grid.append(h('div', { class: 'row-label' }, `Row ${r}`));
    for (let c = c0; c <= c1; c++) {
      const s = at.get(`${r}|${c}`);
      grid.append(s
        ? h('button', { class: `seat ${seats.cls(s)}`, title: seats.title ? `${s.name}${s.group ? ' · group ' + s.group : ''}` : null, onclick: () => seats.click(s) },
          avatarEl(s.id, 40), h('span', null, seats.label(s)))
        : h('div', { class: 'seat empty' }));
    }
  }
  if (seats !== plainSeats) return h('div', { class: 'scroll-x' }, grid);
  return h('div', { class: 'card' }, h('h3', null, 'Seating chart'), seatKey(seated), h('div', { class: 'scroll-x' }, grid));
}

// Students placed from a seating-chart PDF, drawn where they sit on the chart.
function floorPlan(placed, seats = plainSeats) {
  const xs = placed.map(s => s.pos.x), ys = placed.map(s => s.pos.y);
  const x0 = Math.min(...xs) - 0.8, y0 = Math.min(...ys) - 0.8;
  const W = Math.max(...xs) + 0.8 - x0, H = Math.max(...ys) + 0.8 - y0;
  const plan = h('div', { class: 'floor-plan', style: { aspectRatio: `${W} / ${H}` } },
    placed.map(s => h('button', {
      class: `seat placed ${seats.cls(s)}`, title: seats.title ? `${s.name}${s.seatLabel ? ' · seat ' + s.seatLabel : ''}` : null, onclick: () => seats.click(s),
      style: { left: `${((s.pos.x - x0) / W) * 100}%`, top: `${((s.pos.y - y0) / H) * 100}%` },
    }, avatarEl(s.id, 36), h('span', null, seats.label(s)))));
  if (seats !== plainSeats) return h('div', { class: 'scroll-x' }, plan);
  return h('div', { class: 'card' }, h('h3', null, 'Seating chart'), seatKey(placed), h('div', { class: 'scroll-x' }, plan));
}

async function importRoster() {
  const [file] = await pickFiles({ accept: '.csv,.tsv,.txt,text/csv' });
  if (file) await importRosterFile(file);
}

async function importRosterFile(file) {
  const { records, columns } = Engine.rosterFromCSV(Engine.parseCSV(await file.text()));
  if (!('name' in columns) && !('first' in columns)) {
    toast('Couldn’t find a Name (or First Name / Last Name) column. See “File formats.”', 6000);
    return;
  }
  let fallback = '';
  const newestBefore = terms()[0];
  if (records.some(r => !r.section)) {
    fallback = await askSectionName('This file has no Section column. Section name for these students:', S.section);
    if (!fallback) return;
  }
  const existing = new Map([...S.students.values()].flatMap(s =>
    [s.name, ...(s.aliases || [])].map(n => [`${s.section}|${Engine.normName(n)}`, s])));
  let added = 0, updated = 0;
  const out = [];
  for (const r of records) {
    const section = r.section || fallback;
    const key = `${section}|${Engine.normName(r.name)}`;
    let s = existing.get(key);
    if (s) updated++;
    else { s = { id: uid(), section, term: termFor(section), name: r.name, group: '', row: null, seat: null, notes: '' }; existing.set(key, s); added++; }
    if (!s.aliases?.length) s.name = r.name;  // keep the preferred name from a roll page
    if (r.has.group) s.group = r.group;
    if (r.has.row) s.row = r.row;
    if (r.has.seat) s.seat = r.seat;
    if (r.has.notes) { s.notes = Engine.mergeNotes(s.notes, s.fileNotes, r.notes); s.fileNotes = r.notes; }
    if (r.photo) s.photoFile = r.photo;
    out.push(s);
  }
  await saveStudents(out);
  const links = await linkStudents();
  if (!S.section) S.section = out[0]?.section || '';
  const shown = out.length ? showImported(out[0].section, newestBefore) : '';
  toast(`Added ${added} and updated ${updated} students.${links ? ` Linked ${links} to their records in other sections.` : ''}${shown ? ` ${shown}` : ''}`, shown ? 8000 : undefined);
  render();
}

function pickSection(message, exclude = null) {
  return new Promise(resolve => {
    let out = null;
    const select = h('select', { 'aria-label': 'Section' }, sections().filter(x => x !== exclude).map(x => h('option', { value: x, selected: x === S.section }, x)));
    const dlg = modal('Which section?', h('label', { class: 'field' }, message, select), {
      actions: [
        h('button', { onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: 'primary', onclick: () => { out = select.value; dlg.close(); } }, 'OK'),
      ],
      onClose: () => resolve(out),
    });
  });
}

// One button for both kinds of chart. A PDF brings in students, photos, and seats; a CSV seats students already here.
async function importSeatingCharts() {
  const files = await pickFiles({ accept: '.pdf,.csv,.tsv,.txt,application/pdf,text/csv', multiple: true });
  const isPdf = f => /\.pdf$/i.test(f.name);
  if (files.some(isPdf)) await importSeatingPdfs(files.filter(isPdf));
  for (const file of files.filter(f => !isPdf(f))) await importSeatingCsv(file);
}

async function importSeatingCsv(file) {
  const rows = Engine.parseCSV(await file.text());
  const { columns } = Engine.rosterFromCSV(rows);
  if ('name' in columns || 'first' in columns) { await importRosterFile(file); return; }  // a roster, by its header row
  if (!sections().length) { toast('A CSV chart seats students already here. Import a roster, picture roll, or PDF chart first.', 7000); return; }
  const sec = await pickSection(`${file.name}: seat students in section:`);
  if (!sec) return;
  S.section = sec;
  const students = sectionStudents(sec);
  const placed = new Map(), unmatched = [], dupes = [];
  rows.forEach((row, r) => row.forEach((cell, c) => {
    const text = cell.replace(/[([].*?[)\]]/g, '').trim();
    if (!text) return;
    const s = Engine.findStudent(text, students);
    if (!s) unmatched.push(cell);
    else if (placed.has(s.id)) dupes.push(cell);
    else placed.set(s.id, { row: r + 1, seat: c + 1 });
  }));
  if (!placed.size) { toast(`No names in that file matched section ${sec}.`, 6000); return; }
  for (const s of students) {
    const p = placed.get(s.id);
    s.row = p ? p.row : null;
    s.seat = p ? p.seat : null;
  }
  await saveStudents(students);
  const unseated = students.filter(s => !placed.has(s.id));
  render();
  modal('Seating chart imported', h('div', null,
    h('p', null, `Placed ${placed.size} of ${students.length} students in section ${sec}.`),
    unmatched.length ? h('p', null, h('b', null, 'Cells that didn’t match anyone: '), unmatched.join(', ')) : null,
    dupes.length ? h('p', null, h('b', null, 'Listed twice (kept the first): '), dupes.join(', ')) : null,
    unseated.length ? h('p', null, h('b', null, 'Students with no seat: '), unseated.map(s => s.name).join(', ')) : null));
}

function studentOptions(selectedId) {
  return sections().map(sec => h('optgroup', { label: sec },
    sectionStudents(sec).map(s => h('option', { value: s.id, selected: s.id === selectedId }, s.name))));
}

async function addPortraits() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  const all = sectionStudents('');
  const byFile = new Map(all.filter(s => s.photoFile).map(s => [Engine.normName(s.photoFile.replace(/\.[^.]+$/, '')), s]));
  const rows = files.map(file => {
    const guessName = Engine.nameFromFilename(file.name);
    const s = byFile.get(Engine.normName(file.name.replace(/\.[^.]+$/, '')))
      || Engine.findStudent(guessName, sectionStudents(S.section)) || Engine.findStudent(guessName, all);
    const url = URL.createObjectURL(file);
    // Hundreds of rows with the whole roster would stall the page, so each list fills in when first opened.
    const select = h('select', null, h('option', { value: '' }, '— skip —'),
      s ? h('option', { value: s.id, selected: true }, s.name) : null);
    const fill = () => {
      const chosen = select.value;
      select.replaceChildren(h('option', { value: '' }, '— skip —'), ...studentOptions(chosen));
      select.value = chosen;
    };
    select.addEventListener('pointerdown', fill, { once: true });
    select.addEventListener('focus', fill, { once: true });
    return { file, url, select };
  });
  rows.sort((a, b) => !b.select.value - !a.select.value);  // unmatched files first
  const matched = rows.filter(r => r.select.value).length;
  const status = h('p', { class: 'muted' }, matched === files.length ? `All ${files.length} matched by file name.`
    : `${matched} of ${files.length} matched by file name. Files without a match are listed first.`);
  const go = h('button', { class: 'primary' }, 'Add photos');
  const dlg = modal('Add student photos', h('div', null, status,
    h('div', { class: 'portrait-list' }, rows.map(r => h('div', { class: 'portrait-row' },
      h('img', { src: r.url, alt: '', width: 56, height: 56 }), h('span', { class: 'fname' }, r.file.name), r.select)))),
  { wide: true, actions: [h('button', { onclick: () => dlg.close() }, 'Cancel'), go],
    onClose: () => rows.forEach(r => URL.revokeObjectURL(r.url)) });
  go.addEventListener('click', async () => {
    go.disabled = true;
    const todo = rows.filter(r => r.select.value);
    const failed = [];
    for (let i = 0; i < todo.length; i++) {
      status.textContent = `Reading faces… ${i + 1} of ${todo.length}`;
      try {
        const res = await Faces.processPortrait(todo[i].file);
        if (!res || !res.desc) { failed.push(todo[i].file.name); continue; }
        const sid = todo[i].select.value;
        await saveFaces([{ id: uid(), studentId: sid, status: 'confirmed', kind: 'reference', photoId: null,
          section: S.students.get(sid).section, desc: res.desc, thumb: res.thumb, date: today() }]);
      } catch (e) { failed.push(`${todo[i].file.name} (${e.message})`); }
    }
    status.textContent = 'Checking for duplicates…';
    const dupes = await removeDuplicatePhotos();
    dlg.close();
    render();
    const added = todo.length - failed.length;
    toast(`Added ${added} photo${added === 1 ? '' : 's'}.${dupes ? ` Removed ${dupes} that duplicated a photo already here.` : ''}${failed.length ? ` No face found in: ${failed.join(', ')}` : ''}`, failed.length ? 9000 : 5000);
  });
}

function editStudent(s) {
  const isNew = !s;
  s = s ? { ...s } : { id: uid(), name: '', section: S.section || '1', term: S.section ? termOf(S.section) : '', group: '', row: null, seat: null, notes: '' };
  const f = {
    name: h('input', { type: 'text', value: s.name }),
    section: h('input', { type: 'text', value: s.section, list: 'section-list' }),
    group: h('input', { type: 'text', value: s.group || '' }),
    row: h('input', { type: 'number', value: s.row ?? '' }),
    seat: h('input', { type: 'number', value: s.seat ?? '' }),
    notes: h('textarea', { rows: 4 }, s.notes || ''),
  };
  const faceGrid = h('div', { class: 'face-grid' });
  const drawFaces = () => faceGrid.replaceChildren(...facesOf(s.id).map(fc => h('figure', null,
    h('img', { src: fc.thumb, alt: '', width: 96, height: 96 }),
    h('figcaption', null, `${fc.kind !== 'reference' ? 'Class' : fc.source === 'chart' ? 'Chart' : fc.source === 'roll' ? 'Roll' : 'Photo'} · ${fc.date || ''}${fc.studentId !== s.id ? ` · ${S.students.get(fc.studentId)?.section || ''}` : ''}`,
      h('button', { class: 'link', title: 'Not this student', onclick: async () => {
        if (fc.kind === 'reference' || !fc.photoId) await deleteFaces([fc.id]);
        else await saveFaces([{ ...fc, status: 'unknown', studentId: null }]);
        drawFaces();
      } }, 'Remove')))));
  drawFaces();
  const addPhoto = h('button', { onclick: async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    addPhoto.disabled = true; addPhoto.textContent = 'Reading face…';
    try {
      const res = await Faces.processPortrait(file);
      if (!res || !res.desc) toast('No face found in that photo.');
      else await saveFaces([{ id: uid(), studentId: s.id, status: 'confirmed', kind: 'reference', photoId: null,
        section: f.section.value.trim(), desc: res.desc, thumb: res.thumb, date: today() }]);
    } catch (e) { toast(e.message); }
    addPhoto.disabled = false; addPhoto.textContent = 'Add a photo';
    drawFaces();
  } }, 'Add a photo');

  const save = async () => {
    const name = f.name.value.trim();
    if (!name) { toast('Name is required.'); return; }
    const num = el => (el.value === '' ? null : +el.value);
    const section = f.section.value.trim() || '1';
    if (linkedOf(s.id).some(o => o.section === section)) { toast(`${name} is already in section ${section}.`); return; }
    Object.assign(s, { name, section, group: f.group.value.trim(),
      row: num(f.row), seat: num(f.seat), notes: f.notes.value });
    await saveStudents([s]);
    await linkStudents();
    dlg.close();
    render();
  };
  const del = async () => {
    const here = S.students.get(s.id), others = linkedOf(s.id).map(o => o.section);
    const msg = others.length
      ? `Drop ${here.name} from ${here.section}? They stay in ${others.join(', ')}, with their photos and study progress.`
      : `Drop ${here.name} from ${here.section}? It’s their only section, so their roster photos and study history are removed, and faces in class photos become unlabeled.`;
    if (!(await confirmBox(msg, 'Drop', true))) return;
    await dropRecord(here);
    if (!sectionStudents(here.section).length) await deleteSection(here.section);  // the last one out: nothing else could show its photos
    dlg.close();
    render();
  };
  const dlg = modal(isNew ? 'Add student' : s.name, h('div', { class: 'student-form' },
    h('datalist', { id: 'section-list' }, sections().map(x => h('option', { value: x }))),
    h('label', { class: 'field' }, 'Name', f.name),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, 'Section', f.section),
      h('label', { class: 'field' }, 'Group', f.group),
      h('label', { class: 'field' }, 'Row', f.row),
      h('label', { class: 'field' }, 'Seat', f.seat)),
    h('label', { class: 'field' }, 'Notes and facts (shown on the flashcard)', f.notes),
    isNew || !linkedOf(s.id).length ? null : h('p', { class: 'muted small' },
      `Also in ${linkedOf(s.id).map(o => `${o.section}${o.name === s.name ? '' : ` (as ${o.name})`}`).join(', ')}: this is one student, with shared photos and study progress. `,
      h('button', { class: 'link', onclick: async () => { await unlinkStudent(S.students.get(s.id)); dlg.close(); render(); toast('Unlinked.'); } }, 'Not the same person')),
    isNew ? null : linkPicker(s, dlg => dlg.close(), () => dlg),
    isNew ? null : h('div', null, h('h4', null, 'Photos'), faceGrid, addPhoto)),
  { wide: true, onClose: () => { if (S.view === 'study') render(); }, actions: [
    isNew ? null : h('button', { class: 'danger left', onclick: del }, `Drop from ${s.section}`),
    h('button', { onclick: () => dlg.close() }, 'Cancel'),
    h('button', { class: 'primary', onclick: save }, 'Save')] });
  (isNew ? f.name : f.notes).focus();
}

// ---------- Sections ----------

VIEWS.sections = () => {
  const wrap = h('div', { class: 'view' });
  if (S.newSemester) return newSemesterView();
  if (!S.students.size) {
    wrap.append(h('div', { class: 'card' }, h('p', null, 'Sections appear here once you’ve imported students.'),
      h('button', { class: 'primary', onclick: () => goTo('roster') }, 'Go to Students')));
    return wrap;
  }
  const rename = async sec => {
    const to = await promptBox('Rename section', `New name for ${sec}:`, sec);
    if (!to || to === sec) return;
    if (allSections().includes(to)) { toast(`There’s already a section named ${to}. Choose a different name, or use Merge to combine them.`, 5000); return; }
    await renameSection(sec, to);
    render();
    toast(`Renamed to ${to}.`);
  };
  const remove = async sec => {
    const list = sectionStudents(sec), elsewhere = list.filter(s => linkedOf(s.id).length).length, only = list.length - elsewhere;
    const photos = [...S.photos.values()].filter(p => p.section === sec).length;
    const msg = [`Delete ${sec}? This can’t be undone, so save a backup first if you may want it back.`,
      only ? `${only} student${only === 1 ? '' : 's'} in no other section will be removed, with their photos and study progress.` : '',
      elsewhere ? `${elsewhere} also in other sections will stay there, with their photos and progress.` : '',
      photos ? `${photos} class photo${photos === 1 ? '' : 's'} will be deleted; faces labeled in them stay on the flashcards of students who remain.` : ''].filter(Boolean).join(' ');
    if (!(await confirmBox(msg, 'Delete section', true, { offerBackup: true }))) return;
    await deleteSection(sec);
    render();
    toast(`Deleted ${sec}.`);
  };
  const setTerm = async sec => {
    const typed = await promptBox('Semester', `Semester for ${sec}, like W27 or Winter 2027. Leave it blank for none: a section with no semester always shows.`, termOf(sec));
    if (typed === null) return;
    const term = Engine.parseTerm(typed);
    if (typed && !term) { toast('Use a semester like F26, W27, Sp27, Su27, or Fall 2026.', 5000); return; }
    await saveStudents(sectionStudents(sec).map(s => ({ ...s, term })));
    if (term && !sections().includes(sec)) S.term = term === terms()[0] ? null : term;
    render();
    toast(term ? `${sec} is in ${Engine.termLabel(term)}.` : `${sec} has no semester.`);
  };
  const merge = async sec => {
    const to = await pickSection(`Combine ${sec} into which section? ${sec} goes away; the one you pick keeps its name.`, sec);
    if (!to) return;
    const { pairs, moves } = Engine.planSectionMerge(sectionStudents(sec), sectionStudents(to), s => personOf(s.id));
    const photos = [...S.photos.values()].filter(p => p.section === sec).length;
    const msg = [`Merge ${sec} into ${to}?`,
      pairs.length ? `${pairs.length} student${pairs.length === 1 ? ' is' : 's are'} in both and will become one record, with all their photos and notes.` : '',
      moves.length ? `${moves.length} will move to ${to}.` : '',
      photos ? `${photos} class photo${photos === 1 ? '' : 's'} will move too.` : '',
      'Use this for the same class imported twice, not for different semesters. This can’t be undone.'].filter(Boolean).join(' ');
    if (!(await confirmBox(msg, 'Merge', true, { offerBackup: true }))) return;
    await mergeSections(sec, to);
    render();
    toast(`Merged ${sec} into ${to}.`);
  };
  wrap.append(h('div', { class: 'card' },
    h('h3', null, `${sections().length} section${sections().length === 1 ? '' : 's'}`),
    h('div', { class: 'section-rows' }, sections().map(sec => {
      const list = sectionStudents(sec), photos = [...S.photos.values()].filter(p => p.section === sec).length;
      const term = termOf(sec);
      return h('div', { class: 'section-row' },
        h('span', null, h('b', null, sec), h('span', { class: 'muted small' },
          ` · ${term ? Engine.termLabel(term) : 'no semester'} · ${list.length} student${list.length === 1 ? '' : 's'} · ${photos} class photo${photos === 1 ? '' : 's'}`)),
        h('span', { class: 'toolbar' },
          h('button', { onclick: () => rename(sec) }, 'Rename'),
          h('button', { onclick: () => setTerm(sec) }, 'Semester'),
          sections().length > 1 ? h('button', { onclick: () => merge(sec) }, 'Merge') : null,
          h('button', { class: 'danger', onclick: () => remove(sec) }, 'Delete')));
    }))),
    h('div', { class: 'toolbar' }, h('button', { onclick: () => { S.newSemester = { before: allSections(), remove: new Set() }; render(); } }, 'Start a new semester')),
    h('p', { class: 'muted small' }, 'The newest semester is current. Earlier ones are kept for review but left out of the lists and daily study; choose them from the Semester menu at the top. '),
    h('p', { class: 'muted small' }, 'A student in several sections or classes is one student: their records are linked by name, so photos and study progress are shared and they’re only studied once. Open a student to check or undo a link.'));
  return wrap;
};

// Guided setup: bring in the new rosters, see who's returning, and clear out old sections.
function newSemesterView() {
  const N = S.newSemester;
  const old = N.before.filter(x => allSections().includes(x));
  const added = allSections().filter(x => !N.before.includes(x));
  const newcomers = onePerPerson(added.flatMap(x => sectionStudents(x)));
  const returning = newcomers.filter(s => linkedOf(s.id).some(o => old.includes(o.section)));
  const finish = () => { S.newSemester = null; render(); };
  const removeOld = async () => {
    const chosen = old.filter(x => N.remove.has(x));
    if (!chosen.length) { toast('Tick the sections to remove first.'); return; }
    const records = chosen.flatMap(x => sectionStudents(x));
    const stay = records.filter(s => linkedOf(s.id).some(o => !chosen.includes(o.section))).length;
    if (!(await confirmBox(`Remove ${chosen.join(', ')}? ${records.length - stay} student record${records.length - stay === 1 ? '' : 's'} in no other section will be removed, with their photos and progress. ${stay} also in other sections will stay there. This can’t be undone.`, 'Remove', true, { offerBackup: true }))) return;
    for (const x of chosen) await deleteSection(x);
    N.remove.clear();
    render();
    toast(`Removed ${chosen.join(', ')}.`);
  };
  return h('div', { class: 'view' },
    h('div', { class: 'card' },
      h('h2', null, 'Start a new semester'),
      h('p', { class: 'muted' }, 'Include the semester in each new name, like W27-1. Once the new sections are in, they become the current semester. ',
        'Earlier semesters are kept for review, out of the lists and daily study, and can be chosen anytime from the Semester menu at the top.')),
    h('div', { class: 'card' },
      h('h3', null, '1. Bring in the new rosters'),
      h('div', { class: 'toolbar' },
        h('button', { class: 'primary', onclick: importSeatingCharts }, 'Import seating chart'),
        h('button', { class: 'needs-computer', onclick: importRollPages }, 'Import picture roll'),
        h('button', { onclick: importRoster }, 'Import roster CSV')),
      added.length ? h('p', null, `Added so far: ${added.join(', ')}.`) : h('p', { class: 'muted small' }, 'Nothing added yet.')),
    h('div', { class: 'card' },
      h('h3', null, '2. Returning students'),
      newcomers.length
        ? h('p', null, `${returning.length} of ${newcomers.length} new students are returning: they’re linked by name and keep their photos and study progress.`)
        : h('p', { class: 'muted small' }, 'This fills in once you’ve imported a new section.'),
      returning.length ? h('details', { class: 'small' }, h('summary', null, 'Who’s returning'),
        h('div', { class: 'thumb-row' }, returning.map(s => h('button', { class: 'chip person', onclick: () => editStudent(s) }, avatarEl(s.id, 28), s.name)))) : null,
      newcomers.length > returning.length ? h('p', { class: 'muted small' }, 'Someone’s name changed? Open them under Students and link them by hand.') : null),
    h('div', { class: 'card' },
      h('h3', null, '3. Earlier sections'),
      h('p', { class: 'muted small' }, 'There’s no need to remove them: they’re kept for review and stay out of the way. Remove only sections you won’t want again.'),
      old.length ? h('div', { class: 'section-rows' }, old.map(x => h('label', { class: 'inline' },
        h('input', { type: 'checkbox', checked: N.remove.has(x), onchange: e => { if (e.target.checked) N.remove.add(x); else N.remove.delete(x); } }),
        ` ${x} · ${termOf(x) ? `${Engine.termLabel(termOf(x))} · ` : ''}${sectionStudents(x).length} students`))) : h('p', { class: 'muted small' }, 'No earlier sections.'),
      old.length ? h('div', { class: 'toolbar' }, h('button', { class: 'danger', onclick: removeOld }, 'Remove selected')) : null),
    h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: finish }, 'Done')));
}

// ---------- Picture roll: saved class photo roll pages ----------

const normPath = p => {
  const out = [];
  for (const part of String(p).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/').toLowerCase();
};

// Finds each photo whose surrounding cell has a "Last, First (Preferred)" caption.
function readRollPage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Join text nodes with spaces; textContent runs table cells together ("407Section").
  const texts = [];
  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode.nodeValue);
  const header = Engine.parseRollHeader(texts.join(' '));
  const people = [], seen = new Set();
  for (const img of doc.querySelectorAll('img')) {
    let cap = null;
    for (let el = img.parentElement, i = 0; el && i < 6; el = el.parentElement, i++) {
      if (el.querySelectorAll('img').length > 1) break;
      cap = Engine.parseRollCaption(el.textContent);
      if (cap) break;
    }
    if (!cap) continue;
    const key = `${cap.last}|${cap.first}`;
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ ...cap, src: img.getAttribute('src') || '' });
  }
  return { ...header, people };
}

// Runs on the university's class roll page from a bookmark, not in this app: loads every photo and saves the page
// as one .html file with the photos inside it. Self-contained, since the bookmark carries only this function's text.
async function saveRollBookmark() {
  if (window.__faceNamesSaving) return;
  window.__faceNamesSaving = true;
  const note = document.createElement('div');
  note.id = 'face-names-note';
  note.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:340px;padding:12px 16px;border-radius:8px;' +
    'background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.append(note);
  const say = t => { note.textContent = 'Face Names: ' + t; };
  try {
    say('loading every photo…');
    // Some rolls add students as you scroll: scroll until nothing new appears.
    for (let i = 0, last = -1, still = 0; i < 40 && still < 3; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 400));
      const n = document.images.length;
      still = n === last ? still + 1 : 0;
      last = n;
    }
    window.scrollTo(0, 0);
    const live = [...document.querySelectorAll('img')];
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector('#face-names-note')?.remove();
    copy.querySelectorAll('script').forEach(s => s.remove());
    const imgs = [...copy.querySelectorAll('img')];
    let saved = 0, missed = 0;
    for (let i = 0; i < imgs.length && i < live.length; i++) {
      const src = live[i].currentSrc || live[i].src;
      if (!src || src.startsWith('data:') || (live[i].naturalWidth && live[i].naturalWidth < 20)) continue;
      say(`saving photos… ${saved + missed + 1}`);
      try {
        const res = await fetch(src, { credentials: 'include' });
        const blob = await res.blob();
        if (!res.ok || !blob.size || blob.type.includes('html')) throw new Error();
        imgs[i].setAttribute('src', await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }));
        imgs[i].removeAttribute('srcset');
        saved++;
      } catch { missed++; }
    }
    const text = document.body.innerText.replace(/\s+/g, ' ');
    const find = re => (text.match(re) || [])[1] || '';
    const name = ['Picture roll', find(/Course:\s*([A-Z]{1,5}\s+\d{3}[A-Z]?)/), find(/Section:\s*(\d+)/), find(/((?:Winter|Spring|Summer|Fall)\s+\d{4})/)]
      .filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['<!doctype html>\n<!-- Saved by Face Names -->\n' + copy.outerHTML], { type: 'text/html' }));
    a.download = name + '.html';
    document.body.append(a);
    a.click();
    a.remove();
    say(`saved “${name}.html” to Downloads with ${saved} photos${missed ? `; ${missed} couldn’t be saved` : ''}. ` +
      'In Face Names, click Import picture roll, then Choose saved roll files.');
  } catch (e) {
    say('couldn’t save this page (' + (e && e.message || 'unknown error') + ').');
  }
  window.__faceNamesSaving = false;
  setTimeout(() => note.remove(), 20000);
}

function rollBookmarkLink() {
  return h('a', { class: 'bookmarklet', href: 'javascript:' + encodeURIComponent(`(${saveRollBookmark})()`),
    onclick: e => { e.preventDefault(); toast('Drag this button onto your bookmarks bar, then click it on a class photo roll page.', 6000); } },
  'Save picture roll');
}

function importRollPages() {
  const chooseFiles = async () => {
    dlg.close();
    const files = await pickFiles({ accept: '.html,.htm,text/html', multiple: true });
    if (files.length) await importRollFiles(files.map(f => ({ path: f.name, file: f })));
  };
  const dlg = modal('Import picture roll', h('div', null,
    h('p', null, h('b', null, 'Save each roll with this bookmark.'), ' Drag it onto your bookmarks bar once (Ctrl+Shift+B shows the bar):'),
    h('p', null, rollBookmarkLink()),
    h('ol', null,
      h('li', null, 'Open a section’s class photo roll and click the bookmark. It loads every photo and saves the roll as one file in your Downloads.'),
      h('li', null, 'Repeat for each section.'),
      h('li', null, 'Come back here, click ', h('b', null, 'Choose saved roll files'), ', and pick them all.')),
    h('p', { class: 'muted small' }, 'The bookmark runs only in your browser: the roll goes from the university’s page to your Downloads, and nowhere else. ',
      'Saved with Ctrl+S → “Webpage, Complete” instead? Use ', h('b', null, 'Choose a folder'), ' and pick the folder holding the page and its _files folder.')), {
    wide: true,
    actions: [
      h('button', { onclick: () => { dlg.close(); importRollFolder(); } }, 'Choose a folder'),
      h('button', { class: 'primary', onclick: chooseFiles }, 'Choose saved roll files'),
    ],
  });
}

async function importRollFolder() {
  const files = await pickFiles({ directory: true });
  if (!files.length) return;
  const entries = files.map(f => ({ path: f.webkitRelativePath || f.name, file: f }));
  const folder = entries[0].path.split('/')[0];
  // "Webpage, Complete" saves the page beside its _files folder, not inside it. Picking that folder is an easy mistake.
  if (entries.some(e => /\.html?$/i.test(e.path)) || !/_files$/i.test(folder)) { await importRollFiles(entries); return; }
  const page = folder.replace(/_files$/i, '');
  const dlg = modal('One more step', h('div', null,
    h('p', null, `“${folder}” holds the photos. The page itself is saved right beside that folder, as “${page}.html”.`),
    h('p', { class: 'muted small' }, 'For several sections at once, put each page and its folder into one folder and choose that instead.')), {
    actions: [
      h('button', { onclick: () => dlg.close() }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => {
        const pages = await pickFiles({ accept: '.html,.htm,text/html', multiple: true });
        dlg.close();
        if (pages.length) await importRollFiles([...pages.map(f => ({ path: f.name, file: f })), ...entries]);
      } }, 'Choose the page'),
    ],
  });
}

// entries: [{ path, file }] for every file in the chosen folder (pages and their _files folders).
async function importRollFiles(entries) {
  const byPath = new Map(entries.map(e => [normPath(e.path), e.file]));
  const byBase = new Map();
  for (const e of entries) {
    const base = e.path.split('/').pop().toLowerCase();
    if (!byBase.has(base)) byBase.set(base, e.file);
  }
  const pages = entries.filter(e => /\.html?$/i.test(e.path)).sort((a, b) => naturalSort(a.path, b.path));
  if (!pages.length) {
    toast('No saved web pages (.html) in that folder. Choose the folder that holds the saved page and its _files folder.', 8000);
    return;
  }
  const report = [];
  const newestBefore = terms()[0];
  let last = '';
  for (const page of pages) {
    const roll = readRollPage(await page.file.text());
    if (!roll.people.length) { report.push(`${page.path}: no student photos with names found, skipped.`); continue; }
    const dir = page.path.includes('/') ? page.path.slice(0, page.path.lastIndexOf('/') + 1) : '';
    const photoFor = async src => {
      if (/^data:/i.test(src)) return dataURLToBlob(src);
      if (!src || /^[a-z]+:/i.test(src)) return null;  // still on the website, not saved with the page
      let p = src.split(/[?#]/)[0];
      try { p = decodeURIComponent(p); } catch { /* keep as is */ }
      return byPath.get(normPath(dir + p)) || byBase.get(p.split('/').pop().toLowerCase()) || null;
    };

    const label = [roll.course, roll.term].filter(Boolean).join(', ');
    const termCode = Engine.parseTerm(roll.term);
    const section = await askSectionName(
      `${page.path.split('/').pop()}${label ? ` (${label})` : ''}: ${roll.people.length} students. Section name:`,
      [termCode, roll.section].filter(Boolean).join('-'));
    if (!section) { report.push(`${page.path}: skipped.`); continue; }

    const existing = new Map(sectionStudents(section).flatMap(s =>
      [s.name, ...(s.aliases || [])].map(n => [Engine.normName(n), s])));
    const term = termFor(section, roll.term);
    let added = 0, updated = 0;
    last = section;
    const pairs = roll.people.map(p => {
      const rn = Engine.rollName(p);
      let s = [rn.name, ...rn.aliases].map(n => existing.get(Engine.normName(n))).find(Boolean);
      if (s) updated++;
      else { s = { id: uid(), section, term, name: rn.name, group: '', row: null, seat: null, notes: '' }; added++; }
      Object.assign(s, { name: rn.name, aliases: rn.aliases, legalName: rn.legal });
      return { s, src: p.src };
    });
    await saveStudents(pairs.map(x => x.s));
    S.section = section;

    const status = h('p', { class: 'progress' }, 'Reading faces…');
    const dlg = modal(`Importing ${section}`, status);
    const noPhoto = [], noFace = [];
    let photos = 0;
    for (let i = 0; i < pairs.length; i++) {
      const { s, src } = pairs[i];
      status.textContent = `Reading faces… ${i + 1} of ${pairs.length}`;
      const file = await photoFor(src);
      if (!file) { noPhoto.push(s.name); continue; }
      try {
        const res = await Faces.processPortrait(file);
        if (!res || !res.desc) { noFace.push(s.name); continue; }
        const old = facesOf(s.id).filter(f => f.studentId === s.id && f.kind === 'reference' && f.source === 'roll').map(f => f.id);
        if (old.length) await deleteFaces(old);
        await saveFaces([{ id: uid(), studentId: s.id, status: 'confirmed', kind: 'reference', source: 'roll', photoId: null,
          section, desc: res.desc, thumb: res.thumb, date: today() }]);
        photos++;
      } catch { noFace.push(s.name); }
    }
    dlg.close();
    if (pairs.length && noPhoto.length === pairs.length && !entries.some(e => e.path.includes('/'))) {
      report.push(`${section}: ${added} added, ${updated} updated, but no photos: this page keeps its photos in a separate _files folder. ` +
        'Import it again with Choose a folder, or save the roll with the Save picture roll bookmark.');
      continue;
    }
    report.push(`${section}: ${added} added, ${updated} updated, ${photos} photos.` +
      (noPhoto.length ? ` Photo not found in the saved files for: ${noPhoto.join(', ')}.` : '') +
      (noFace.length ? ` No face detected for: ${noFace.join(', ')}.` : ''));
  }
  const links = await linkStudents();
  if (links) report.push(`Linked ${links} students to their records in other sections; they now share photos and study progress.`);
  const dupes = await removeDuplicatePhotos();
  if (dupes) report.push(`Removed ${dupes} duplicate photos (the same picture at a lower resolution).`);
  if (last) report.push(showImported(last, newestBefore));
  render();
  modal('Picture roll import', h('div', null, report.map(r => h('p', null, r))));
}

// Link by hand, e.g. after a name change: pick the same student's record in another section.
function linkPicker(s, close, getDlg) {
  const cands = linkCandidates(s.id);
  if (!cands.length) return null;
  const sel = h('select', { 'aria-label': 'Same student in another section' },
    h('option', { value: '' }, 'Same student in another section…'),
    cands.slice(0, 200).map(c => h('option', { value: c.s.id },
      `${c.s.name} · ${c.s.section}${c.d < 0.5 ? ' · looks similar' : ''}`)));
  const btn = h('button', { onclick: async () => {
    const other = S.students.get(sel.value);
    if (!other) return;
    const me = S.students.get(s.id);
    me.linkLocked = false; other.linkLocked = false;
    const group = await mergePeople(me, other);
    if (!group) { toast('They can’t be linked: that would put one person in a section twice.'); return; }
    await saveStudents(group); reindex();
    await removeDuplicatePhotos();
    close(getDlg()); render(); toast(`Linked ${me.name} with ${other.name} (${other.section}).`);
  } }, 'Link');
  return h('details', { class: 'small' }, h('summary', null, 'Link to this student’s record in another section'),
    h('p', { class: 'muted' }, 'For a name change or a nickname the app didn’t match. Photos and study progress are then shared.'),
    h('div', { class: 'toolbar' }, sel, btn));
}

// ---------- Seating-chart PDFs ----------

async function importSeatingPdfs(files) {
  const report = [];
  const newestBefore = terms()[0];
  let last = '';
  for (const file of files.sort((a, b) => naturalSort(a.name, b.name))) {
    const status = h('p', { class: 'progress' }, `Reading ${file.name}…`);
    let dlg = modal('Importing seating chart', status);
    let chart;
    try {
      chart = await SeatingPdf.read(file, msg => { status.textContent = msg; });
    } catch (e) {
      dlg.close();
      report.push(`${file.name}: couldn’t read it (${e.message}).`);
      continue;
    }
    dlg.close();
    if (!chart.people.length) { report.push(`${file.name}: no students with photos and names found, skipped.`); continue; }

    const suggested = [chart.termCode, chart.section].filter(Boolean).join('-');
    const label = [chart.term, chart.room].filter(Boolean).join(', ');
    const section = await askSectionName(
      `${file.name}${label ? ` (${label})` : ''}: ${chart.people.length} students. Section name:`, suggested);
    if (!section) { report.push(`${file.name}: skipped.`); continue; }

    const existing = new Map(sectionStudents(section).flatMap(s =>
      [s.name, ...(s.aliases || [])].map(n => [Engine.normName(n), s])));
    const term = termFor(section, chart.term);
    let added = 0, updated = 0;
    last = section;
    const pairs = chart.people.map(p => {
      const name = `${p.first} ${p.last}`;
      let s = existing.get(Engine.normName(name));
      if (s) updated++;
      else { s = { id: uid(), section, term, name, group: '', row: null, seat: null, notes: '' }; added++; }
      Object.assign(s, { group: p.group || s.group, seatLabel: p.seat || '', pos: p.pos });
      return { s, blob: p.blob };
    });
    await saveStudents(pairs.map(x => x.s));
    S.section = section;

    const prog = h('p', { class: 'progress' }, 'Reading faces…');
    dlg = modal(`Importing ${section}`, prog);
    const noFace = [];
    let photos = 0;
    for (let i = 0; i < pairs.length; i++) {
      const { s, blob } = pairs[i];
      prog.textContent = `Reading faces… ${i + 1} of ${pairs.length}`;
      try {
        const res = await Faces.processPortrait(blob);
        if (!res || !res.desc) { noFace.push(s.name); continue; }
        const old = facesOf(s.id).filter(f => f.studentId === s.id && f.kind === 'reference' && f.source === 'chart').map(f => f.id);
        if (old.length) await deleteFaces(old);
        await saveFaces([{ id: uid(), studentId: s.id, status: 'confirmed', kind: 'reference', source: 'chart', photoId: null,
          section, desc: res.desc, thumb: res.thumb, date: today() }]);
        photos++;
      } catch { noFace.push(s.name); }
    }
    dlg.close();
    const noSeat = pairs.filter(x => !x.s.seatLabel).map(x => x.s.name);
    report.push(`${section}: ${added} added, ${updated} updated, ${photos} photos.` +
      (noFace.length ? ` No face found for: ${noFace.join(', ')} (usually a “Picture not available” placeholder; add a photo from their student card).` : '') +
      (noSeat.length ? ` No seat number found for: ${noSeat.join(', ')}.` : ''));
  }
  const links = await linkStudents();
  if (links) report.push(`Linked ${links} students to their records in other sections; they now share photos and study progress.`);
  const dupes = await removeDuplicatePhotos();
  if (dupes) report.push(`Removed ${dupes} duplicate photos (the same picture at a lower resolution).`);
  if (last) report.push(showImported(last, newestBefore));
  render();
  modal('Seating chart import', h('div', null, report.map(r => h('p', null, r))));
}
