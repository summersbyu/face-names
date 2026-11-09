/* Backup view: full backups, student files for colleagues, storage info. */

const blobToDataURL = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const dataURLToBlob = url => fetch(url).then(r => r.blob());

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const downloadJSON = (data, name) => downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
async function photoData(include, ids = null) {
  const photos = [];
  if (include) for (const p of S.photos.values()) {
    if (ids && !ids.has(p.id)) continue;
    const { blob, ...rest } = p;
    photos.push({ ...rest, data: await blobToDataURL(blob) });
  }
  return photos;
}
async function backupBlob(includePhotos) {
  S.meta.lastBackup = Date.now();
  await saveMeta();
  return new Blob([JSON.stringify({ app: 'face-names', version: 1, kind: 'full', exported: new Date().toISOString(),
    students: [...S.students.values()], faces: [...S.faces.values()], srs: [...S.srs.values()], meta: S.meta,
    photos: await photoData(includePhotos) })], { type: 'application/json' });
}
// Into the backup folder when there is one, else a download. Returns where it went.
async function saveBackup(includePhotos = Folder.photos) {
  if (Folder.handle) {
    try {
      await Folder.setPhotos(includePhotos);
      if (await Folder.save(true)) return 'folder';
    } catch { toast('Couldn’t save to your backup folder, so it was downloaded instead.', 6000); }
  }
  downloadBlob(await backupBlob(includePhotos), `face-names-my-backup-${today()}.json`);
  return 'download';
}

// ---------- Backup folder (Chrome and Edge on a computer) ----------
// The folder is remembered in a small database of its own, apart from the student data: it can't go into a backup.
const Local = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('face-names-local', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => { const q = fn(db.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  };
  return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k)) };
})();

const BACKUP_FILE = 'face-names-backup.json';
const Folder = {
  supported: typeof window.showDirectoryPicker === 'function',
  handle: null, state: 'none', photos: true, saving: false, dirty: false, lastSaved: 0,
  async load() {
    if (!this.supported) return;
    try {
      const saved = await Local.get('backupFolder');
      if (!saved) return;
      Object.assign(this, { handle: saved.handle, photos: saved.photos !== false });
      await this.allowed(false);
    } catch { Object.assign(this, { handle: null, state: 'none' }); }
  },
  async choose() {
    const handle = await window.showDirectoryPicker({ id: 'face-names-backups', mode: 'readwrite' });
    Object.assign(this, { handle, state: 'granted' });
    await Local.set('backupFolder', { handle, photos: this.photos });
  },
  async forget() { Object.assign(this, { handle: null, state: 'none' }); await Local.del('backupFolder'); },
  async setPhotos(v) { this.photos = v; if (this.handle) await Local.set('backupFolder', { handle: this.handle, photos: v }); },
  // Chrome asks again on each visit, and only a click can ask; automatic saves just check.
  async allowed(ask) {
    if (!this.handle) return false;
    let p = await this.handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && ask) p = await this.handle.requestPermission({ mode: 'readwrite' });
    this.state = p === 'granted' ? 'granted' : 'prompt';
    return p === 'granted';
  },
  async write(name, blob) {
    const w = await (await this.handle.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
  },
  // The latest backup plus a copy for each of the last 7 days, so a mistake that got saved can still be undone.
  async save(ask = false) {
    if (this.saving || !S.students.size || !(await this.allowed(ask))) return false;
    this.saving = true;
    try {
      const blob = await backupBlob(this.photos);
      this.dirty = false;
      await this.write(BACKUP_FILE, blob);
      await this.write(`face-names-backup-${today()}.json`, blob);
      const days = [];
      for await (const name of this.handle.keys()) if (/^face-names-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)) days.push(name);
      for (const name of days.sort().reverse().slice(7)) await this.handle.removeEntry(name);
      this.lastSaved = Date.now();
      return true;
    } finally { this.saving = false; }
  },
};

// Any change to the data marks the backup out of date. Saved when the app is put away, and every 10 minutes.
for (const k of ['put', 'putMany', 'del', 'delMany', 'clear']) {
  const write = DB[k];
  DB[k] = (...args) => { Folder.dirty = true; return write(...args); };
}
const autoBackup = () => { if (Folder.dirty && Folder.state === 'granted') Folder.save().catch(() => {}); };
setInterval(() => { if (Date.now() - Folder.lastSaved > 10 * 60e3) autoBackup(); }, 60e3);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoBackup(); });

// Shown on the Study page when automatic backups are waiting for permission.
function folderPausedTip() {
  if (!Folder.handle || Folder.state === 'granted') return null;
  return h('div', { class: 'tip toolbar' },
    h('span', { class: 'spacer' }, `Automatic backups to “${Folder.handle.name}” are paused: the browser asks for permission again on each visit.`),
    h('button', { onclick: async () => {
      const ok = await Folder.save(true).catch(() => false);
      render();
      toast(ok ? 'Backup saved to your folder. Automatic backups are on.' : 'Backups are still paused.');
    } }, 'Allow and save'));
}
const lastBackupText = () => (S.meta.lastBackup ? `Last backup: ${new Date(S.meta.lastBackup).toLocaleDateString()}.` : 'No backup saved yet.');

VIEWS.backup = () => {
  const wrap = h('div', { class: 'view' });
  const usage = h('p', { class: 'muted' });
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(e => { usage.textContent = `This browser is using about ${Math.round((e.usage || 0) / 1e6)} MB for this app.`; });
  }
  const fullPhotos = h('input', { type: 'checkbox', checked: Folder.photos, onchange: e => Folder.setPhotos(e.target.checked) });
  const sharePhotos = h('input', { type: 'checkbox', checked: true });
  const shareNotes = h('input', { type: 'checkbox' });
  const status = h('p', { class: 'progress', role: 'status' });

  const lastSaved = h('p', { class: 'muted' }, lastBackupText());
  const exportAll = async () => {
    status.textContent = 'Preparing backup…';
    const where = await saveBackup(fullPhotos.checked);
    status.textContent = '';
    lastSaved.textContent = lastBackupText();
    if (where === 'folder') toast(`Saved to “${Folder.handle.name}”.`);
  };

  // Only the sections chosen: a colleague needs the students they teach, not everyone you do. Starts with the
  // sections shown now (the current semester). Study progress and mix-ups stay out: they're in srs and meta.
  const shareSections = new Set(sections());
  const shareCount = h('p', { class: 'muted small' });
  const countShare = () => {
    const n = onePerPerson([...S.students.values()].filter(s => shareSections.has(s.section))).length;
    shareCount.textContent = `${n} student${n === 1 ? '' : 's'} in ${shareSections.size} section${shareSections.size === 1 ? '' : 's'}.`;
  };
  countShare();
  const byTerm = [...terms(), ''].map(t => [t, allSections().filter(x => termOf(x) === t)]).filter(([, list]) => list.length);
  const sectionPicker = h('div', { class: 'share-sections' }, byTerm.map(([t, list]) => h('div', null,
    byTerm.length > 1 ? h('span', { class: 'muted small' }, `${t ? Engine.termLabel(t) : 'No semester'}: `) : null,
    list.map(x => h('label', { class: 'inline chip' },
      h('input', { type: 'checkbox', checked: shareSections.has(x), onchange: e => { if (e.target.checked) shareSections.add(x); else shareSections.delete(x); countShare(); } }),
      ` ${x}`)))));
  const exportStudents = async () => {
    const keep = [...shareSections].sort(naturalSort);
    if (!keep.length) { toast('Tick at least one section to share.'); return; }
    status.textContent = 'Preparing student file…';
    const picked = Engine.pickShare({ students: [...S.students.values()], faces: [...S.faces.values()], photos: [...S.photos.values()] }, keep, personOf);
    const students = picked.students.map(s => (shareNotes.checked ? s : { ...s, notes: '', fileNotes: '' }));
    const label = (keep.length <= 3 ? keep.join('_') : `${keep.length}-sections`).replace(/[^\w.-]+/g, '-');
    downloadJSON({ app: 'face-names', version: 1, kind: 'students', exported: new Date().toISOString(), sections: keep,
      students, faces: picked.faces, photos: await photoData(sharePhotos.checked, new Set(picked.photoIds)) }, `face-names-students-${label}-${today()}.json`);
    status.textContent = '';
  };

  const pickFolder = async () => {
    try {
      await Folder.choose();
      const ok = await Folder.save(true);
      toast(ok ? `Backup saved to “${Folder.handle.name}”. From now on it’s saved there automatically.` : `Backups will be saved to “${Folder.handle.name}”.`, 6000);
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Couldn’t use that folder (${e.message}).`, 6000);
    }
    render();
  };
  const folderCard = !Folder.supported ? null : h('div', { class: 'card' },
    h('h2', null, 'Back up automatically'),
    h('p', null, 'Choose a folder once, ideally one that Box, OneDrive, or Google Drive keeps in sync. Your backup is then saved there ',
      'whenever you’ve made changes, with a copy from each of the last 7 days, and ', h('b', null, 'Save my backup'), ' saves there too.'),
    h('p', null, 'To bring your progress to your phone, open ', h('code', null, BACKUP_FILE), ' from that folder on the phone (in Box, OneDrive, or Drive) and choose ', h('b', null, 'Merge'), '.'),
    Folder.handle ? h('p', null, h('b', null, `Saving to “${Folder.handle.name}”.`), Folder.state === 'granted' ? '' : ' Paused until you allow it again.') : null,
    h('div', { class: 'toolbar' },
      Folder.handle && Folder.state !== 'granted' ? h('button', { class: 'primary', onclick: async () => { const ok = await Folder.save(true).catch(() => false); render(); toast(ok ? 'Backup saved. Automatic backups are on.' : 'Backups are still paused.'); } }, 'Allow and save') : null,
      h('button', { class: Folder.handle ? '' : 'primary', onclick: pickFolder }, Folder.handle ? 'Change folder' : 'Choose a folder'),
      Folder.handle ? h('button', { onclick: async () => { await Folder.forget(); render(); toast('Automatic backups are off. The files already in the folder stay there.'); } }, 'Stop') : null),
    h('p', { class: 'muted small' }, 'The backup holds your students’ names and photos, so choose a folder only you can open.'));

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
      h('div', { class: 'toolbar' }, h('button', { class: 'primary', onclick: exportAll }, Folder.handle ? 'Save my backup now' : 'Save my backup')),
      h('p', { class: 'muted small' }, 'Keep this one to yourself: it includes your study progress.')),
    folderCard,
    h('div', { class: 'card' },
      h('h2', null, 'Share students with a colleague'),
      h('p', null, 'For someone teaching the same students. The file holds names, seats, photos, and your photo labels. It leaves out who you know, your mix-ups, and your study history.'),
      h('p', null, 'Share only the sections they teach:'),
      sectionPicker,
      shareCount,
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
