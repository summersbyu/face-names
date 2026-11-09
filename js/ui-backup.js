/* Backup view: full backups, student files for colleagues, storage info. */

const blobToDataURL = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const dataURLToBlob = url => fetch(url).then(r => r.blob());

function downloadJSON(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function photoData(include) {
  const photos = [];
  if (include) for (const p of S.photos.values()) { const { blob, ...rest } = p; photos.push({ ...rest, data: await blobToDataURL(blob) }); }
  return photos;
}
async function saveBackup(includePhotos = true) {
  S.meta.lastBackup = Date.now();
  await saveMeta();
  downloadJSON({ app: 'face-names', version: 1, kind: 'full', exported: new Date().toISOString(),
    students: [...S.students.values()], faces: [...S.faces.values()], srs: [...S.srs.values()], meta: S.meta,
    photos: await photoData(includePhotos) }, `face-names-my-backup-${today()}.json`);
}
const lastBackupText = () => (S.meta.lastBackup ? `Last backup: ${new Date(S.meta.lastBackup).toLocaleDateString()}.` : 'No backup saved yet.');

VIEWS.backup = () => {
  const wrap = h('div', { class: 'view' });
  const usage = h('p', { class: 'muted' });
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(e => { usage.textContent = `This browser is using about ${Math.round((e.usage || 0) / 1e6)} MB for this app.`; });
  }
  const fullPhotos = h('input', { type: 'checkbox', checked: true });
  const sharePhotos = h('input', { type: 'checkbox', checked: true });
  const shareNotes = h('input', { type: 'checkbox' });
  const status = h('p', { class: 'progress', role: 'status' });

  const lastSaved = h('p', { class: 'muted' }, lastBackupText());
  const exportAll = async () => {
    status.textContent = 'Preparing backup…';
    await saveBackup(fullPhotos.checked);
    status.textContent = '';
    lastSaved.textContent = lastBackupText();
  };

  // Students, photos, and labels for a colleague. Study progress and mix-ups stay out: they're in srs and meta.
  const exportStudents = async () => {
    status.textContent = 'Preparing student file…';
    const students = [...S.students.values()].map(s => (shareNotes.checked ? s : { ...s, notes: '', fileNotes: '' }));
    downloadJSON({ app: 'face-names', version: 1, kind: 'students', exported: new Date().toISOString(),
      students, faces: [...S.faces.values()], photos: await photoData(sharePhotos.checked) }, `face-names-students-${today()}.json`);
    status.textContent = '';
  };

  const unpackPhotos = async list => {
    const photos = [];
    for (const p of list || []) { const { data: d, ...rest } = p; photos.push({ ...rest, blob: await dataURLToBlob(d) }); }
    return photos;
  };

  const addStudentFile = async data => {
    const when = String(data.exported).slice(0, 10);
    if (!(await confirmBox(`Add the student file from ${when} (${data.students.length} records)? Students you already have are updated. Your study progress isn’t changed.`, 'Add students'))) return;
    status.textContent = 'Adding students…';
    const photos = await unpackPhotos(data.photos);
    const merged = Engine.mergeStudentFile({ students: [...S.students.values()], faces: [...S.faces.values()], photoIds: [...S.photos.keys()] },
      { students: data.students, faces: data.faces, photoIds: photos.map(p => p.id) });
    await DB.putMany('students', merged.students);
    await DB.putMany('faces', merged.faces);
    await DB.putMany('photos', photos);
    location.reload();
  };

  // Merge is the safe default: moving progress between a phone and a computer shouldn't lose either side's work.
  const openBackup = data => {
    const when = String(data.exported).slice(0, 10);
    if (!S.students.size) { restoreFull(data); return; }
    const dlg = modal('Open this backup', h('div', null,
      h('p', null, `This backup is from ${when}, with ${data.students.length} records.`),
      h('p', null, h('b', null, 'Merge'), ' keeps the newer version of each student and the newer review of each, so progress from both devices is kept.'),
      h('p', null, h('b', null, 'Replace'), ' makes this browser an exact copy of the backup. Anything newer here is lost.')), {
      actions: [backupFirstButton(),
        h('button', { onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: 'danger', onclick: () => { dlg.close(); restoreFull(data); } }, 'Replace'),
        h('button', { class: 'primary', onclick: () => { dlg.close(); mergeFull(data); } }, 'Merge')],
    });
  };

  const mergeFull = async data => {
    status.textContent = 'Merging…';
    const photos = await unpackPhotos(data.photos);
    const m = Engine.mergeBackup({ students: [...S.students.values()], faces: [...S.faces.values()], photos: [...S.photos.values()], srs: [...S.srs.values()], meta: S.meta },
      { students: data.students, faces: data.faces, photos, srs: data.srs, meta: data.meta });
    const missing = (store, have) => [...have.keys()].filter(id => !m[store].some(x => x.id === id));
    for (const [store, have] of [['students', S.students], ['faces', S.faces], ['photos', S.photos], ['srs', S.srs]]) {
      await DB.delMany(store, missing(store, have));
      await DB.putMany(store, m[store]);
    }
    await DB.put('meta', m.meta);
    try {
      sessionStorage.setItem('fn-merged', `Merged. New student records: ${m.counts.newStudents}. Newer reviews: ${m.counts.newerReviews}. Removed because they were deleted on the other device: ${m.counts.removed}.`);
    } catch {}
    location.reload();
  };

  const restoreFull = async data => {
    if (!(await confirmBox(`Replace everything in this browser, including your study progress, with the backup from ${String(data.exported).slice(0, 10)} (${data.students.length} records)?`, 'Replace', true))) return;
    status.textContent = 'Restoring…';
    for (const s of DB.STORES) await DB.clear(s);
    const photos = await unpackPhotos(data.photos);
    // Keep class faces only for photos that came with the backup.
    const have = new Set(photos.map(p => p.id));
    const faces = data.faces.filter(f => !f.photoId || have.has(f.photoId) || f.status === 'confirmed');
    await DB.putMany('students', data.students);
    await DB.putMany('faces', faces);
    await DB.putMany('srs', data.srs);
    await DB.putMany('photos', photos);
    await DB.put('meta', { ...data.meta, id: 'meta' });
    location.reload();
  };

  const openFile = async () => {
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t from this app.'); return; }
    if (data.app !== 'face-names') { toast('That file isn’t from this app.'); return; }
    await (data.kind === 'students' ? addStudentFile(data) : openBackup(data));
  };

  const wipe = async () => {
    if (!(await confirmBox('Delete all students, photos, and study history from this browser? Make a backup first if you might want them.', 'Delete everything', true, { offerBackup: true }))) return;
    for (const s of DB.STORES) await DB.clear(s);
    location.reload();
  };

  wrap.append(
    h('div', { class: 'card' },
      h('h2', null, 'Save a copy for yourself'),
      h('p', null, 'Everything lives only in this browser on this device. Clearing browsing data or switching browsers loses it. A backup holds everything, including who you know, so you can keep it safe or move to another device.'),
      lastSaved,
      usage,
      h('label', { class: 'inline' }, fullPhotos, ' Include full class photos (larger file; faces and labels are always included)'),
      h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: exportAll }, 'Save my backup')),
      h('p', { class: 'muted small' }, 'Keep this one to yourself: it includes your study progress.')),
    h('div', { class: 'card' },
      h('h2', null, 'Share students with a colleague'),
      h('p', null, 'For someone teaching the same students. The file holds names, seats, photos, and your photo labels. It leaves out who you know, your mix-ups, and your study history.'),
      h('label', { class: 'inline' }, sharePhotos, ' Include full class photos (larger file; faces and labels are always included)'),
      h('label', { class: 'inline' }, shareNotes, ' Include notes and facts about students'),
      h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: exportStudents }, 'Save student file')),
      h('p', { class: 'muted small' }, 'Colleagues load it below. Sending an updated file later adds to what they have and keeps their progress.')),
    h('div', { class: 'card' },
      h('h2', null, 'Open a file'),
      h('p', null, 'A student file adds students and keeps your progress. A backup can be merged with what’s here, or replace it. The app asks before changing anything.'),
      h('div', { class: 'toolbar' }, h('button', { onclick: openFile }, 'Open a file')),
      status,
      h('p', { class: 'muted small' }, 'These files contain student photos and names. Store and send them as you would other student records.')),
    h('div', { class: 'card' },
      h('h3', null, 'Start over'),
      h('button', { class: 'danger', onclick: wipe }, 'Delete everything')),
    h('p', { class: 'muted small' }, `Version ${APP_VERSION}`));
  // From the welcome screen: go straight to choosing the file (still inside that click, so the browser allows it).
  if (S.openFileNow) { S.openFileNow = false; openFile(); }
  return wrap;
};
