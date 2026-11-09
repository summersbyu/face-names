/* Class Photos view: add class photos, review suggested names, confirm. */

const photoUrls = new Map();
function photoUrl(id) {
  if (!photoUrls.has(id)) photoUrls.set(id, URL.createObjectURL(S.photos.get(id).blob));
  return photoUrls.get(id);
}
const photoFaces = pid => [...S.faces.values()].filter(f => f.photoId === pid);

const TIER_LABEL = { confident: 'confident', probable: 'likely', unsure: 'unsure', unknown: 'no match' };
const faceClass = f => (f.status === 'confirmed' ? 'confirmed' : f.status === 'rejected' ? 'rejected' : (f.suggestion?.tier || 'unknown'));

function matchWords(dist, seatDist) {
  const parts = [];
  if (dist != null) parts.push(dist < 0.4 ? 'strong match' : dist < 0.5 ? 'good match' : dist < 0.6 ? 'weak match' : 'poor match');
  if (seatDist != null) {
    const n = Math.round(seatDist);
    parts.push(n === 0 ? 'in their seat' : `${n} seat${n === 1 ? '' : 's'} away`);
  }
  return parts.join(' · ');
}

// Re-run matching for every face in the photo that isn't confirmed or rejected.
async function suggest(pid) {
  const photo = S.photos.get(pid);
  const faces = photoFaces(pid).filter(f => f.status !== 'rejected');
  const aspect = photo.height / photo.width;
  const students = sectionStudents(photo.section).map(s => ({
    id: s.id, group: s.group,
    seat: s.pos ? { x: s.pos.x, y: s.pos.y } : s.row != null && s.seat != null ? { x: +s.seat, y: +s.row } : null,
    refs: facesOf(s.id).filter(f => f.photoId !== pid && f.desc).slice(0, 12).map(f => f.desc),
  }));
  const out = Engine.matchPhoto(faces.map(f => ({
    id: f.id, desc: f.desc, x: f.box.x + f.box.w / 2, y: (f.box.y + f.box.h / 2) * aspect,
    fixed: f.status === 'confirmed' ? f.studentId : null,
  })), students);
  await saveFaces(out.results.map(r => ({
    ...S.faces.get(r.faceId), studentId: r.studentId, status: r.studentId ? 'suggested' : 'unknown',
    suggestion: { tier: r.tier, dist: r.dist, seatDist: r.seatDist,
      alts: r.alts.map(a => ({ studentId: a.studentId, dist: a.dist, seatDist: a.seatDist })) },
  })));
  photo.geo = out.geo;
  await DB.put('photos', photo);
}

// The roster that fits a photo's faces, if clearly better than the section it was added to.
function betterSection(photo) {
  const descs = photoFaces(photo.id).map(f => f.desc).filter(Boolean);
  const fit = sec => Engine.rosterFit(descs, sectionStudents(sec).map(s => facesOf(s.id).filter(f => f.photoId !== photo.id && f.desc).map(f => f.desc)).filter(r => r.length));
  const here = fit(photo.section);
  let best = null, bestFit = Math.max(3, here + 2);
  for (const sec of sections()) {
    if (sec === photo.section) continue;
    const n = fit(sec);
    if (n > bestFit) { best = sec; bestFit = n; }
  }
  return best && { section: best, fit: bestFit, here, total: descs.length };
}

// Moves a photo to another section. Confirmed labels follow the student if they're linked to a record there.
async function movePhoto(photo, section) {
  photo.section = section;
  await DB.put('photos', photo);
  await saveFaces(photoFaces(photo.id).map(f => {
    const moved = { ...f, section };
    if (f.status !== 'confirmed') return { ...moved, studentId: null, status: f.status === 'rejected' ? 'rejected' : 'unknown' };
    const there = [S.students.get(f.studentId), ...linkedOf(f.studentId)].find(s => s && s.section === section);
    return there ? { ...moved, studentId: there.id } : { ...moved, studentId: null, status: 'unknown' };
  }));
  await suggest(photo.id);
}

VIEWS.label = () => (S.reviewPhoto && S.photos.has(S.reviewPhoto) ? reviewView(S.photos.get(S.reviewPhoto)) : photoListView());

function photoListView() {
  const wrap = h('div', { class: 'view' });
  if (!S.students.size) {
    wrap.append(h('div', { class: 'card' }, h('p', null, 'Import your roster first, so the app knows who to look for.'),
      h('button', { class: 'primary', onclick: () => goTo('roster') }, 'Go to Students')));
    return wrap;
  }
  const date = h('input', { type: 'date', value: today(), 'aria-label': 'Date taken' });
  const progress = h('p', { class: 'progress', role: 'status' });
  const add = h('button', { class: 'primary', onclick: () => addClassPhotos(S.section, date.value || today(), progress, add) }, 'Add class photos');
  const snap = h('button', { class: 'needs-touch', onclick: () => addClassPhotos(S.section, date.value || today(), progress, snap, true) }, 'Take a photo');
  wrap.append(h('div', { class: 'toolbar' },
    sectionSelect(S.section, v => { S.section = v; render(); }),
    h('label', { class: 'inline' }, 'Taken on ', date), snap, add), progress);

  wrap.append(h('details', { class: 'help' }, h('summary', null, 'Tips for class photos'),
    h('ul', null,
      h('li', null, 'Ask everyone to look up at you for a moment. Faces looking down at laptops are the main cause of misses.'),
      h('li', null, 'For a big room, take 2–3 overlapping photos (left, middle, right) from the front. Add them all; each is matched separately.'),
      h('li', null, 'Use your phone’s full resolution and avoid zoom. Back-row faces need to be at least ~40 pixels wide.'),
      h('li', { class: 'needs-touch' }, 'Take a photo opens the camera and adds the picture to this section. Labeling is easier on a computer: bring the photos over with a backup.'),
      h('li', null, 'iPhone: set Camera → Formats → “Most Compatible” so photos are JPEG, not HEIC.'),
      h('li', null, 'Once a few faces are confirmed, the seat map kicks in and suggestions for blurry or turned faces improve.'))));

  const photos = [...S.photos.values()].filter(p => p.section === S.section)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || naturalSort(a.name, b.name));
  if (!photos.length) {
    wrap.append(h('p', { class: 'muted' }, `No class photos for section ${S.section} yet.`));
    return wrap;
  }
  wrap.append(h('div', { class: 'photo-list' }, photos.map(p => {
    const fs = photoFaces(p.id).filter(f => f.status !== 'rejected');
    const done = fs.filter(f => f.status === 'confirmed').length;
    return h('div', { class: 'card photo-card' },
      h('img', { src: photoUrl(p.id), alt: '', onclick: () => { S.reviewPhoto = p.id; render(); } }),
      h('div', null,
        h('b', null, p.date), h('div', { class: 'muted' }, p.name),
        h('div', null, `${done} of ${fs.length} faces labeled`),
        h('progress', { max: fs.length || 1, value: done })),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: () => { S.reviewPhoto = p.id; render(); } }, done < fs.length ? 'Review' : 'Open'),
        h('button', { class: 'link danger', onclick: async () => {
          if (!(await confirmBox('Delete this photo and every face labeled in it? Roster photos are not affected.', 'Delete', true))) return;
          await deleteFaces(photoFaces(p.id).map(f => f.id));
          S.photos.delete(p.id); await DB.del('photos', p.id); await markDeleted([p.id]);
          if (photoUrls.has(p.id)) { URL.revokeObjectURL(photoUrls.get(p.id)); photoUrls.delete(p.id); }
          render();
        } }, 'Delete')));
  })));
  return wrap;
}

async function addClassPhotos(section, date, progress, button, camera = false) {
  const files = await pickFiles(camera ? { accept: 'image/*', capture: 'environment' } : { accept: 'image/*', multiple: true });
  if (!files.length) return;
  button.disabled = true;
  let first = null;
  const errors = [];
  for (let i = 0; i < files.length; i++) {
    const tag = files.length > 1 ? `Photo ${i + 1} of ${files.length}: ` : '';
    try {
      const res = await Faces.processPhoto(files[i], msg => { progress.textContent = tag + msg; });
      const photo = { id: uid(), section, date, name: files[i].name, width: res.width, height: res.height, blob: res.blob };
      S.photos.set(photo.id, photo);
      await DB.put('photos', photo);
      await saveFaces(res.faces.map(f => ({ id: uid(), photoId: photo.id, section, studentId: null, status: 'unknown',
        kind: 'class', box: f.box, desc: f.desc, thumb: f.thumb, date })));
      progress.textContent = tag + 'Matching names…';
      await suggest(photo.id);
      first = first || photo.id;
    } catch (e) {
      errors.push(`${files[i].name}: ${e.message}`);
    }
  }
  button.disabled = false;
  progress.textContent = '';
  if (errors.length) toast(errors.join(' · '), 9000);
  if (first) { S.reviewPhoto = first; render(); }
}

function reviewView(photo) {
  const wrap = h('div', { class: 'view review' });
  let selected = null, zoom = 1;
  const header = h('div', { class: 'review-head' });
  const boxes = h('div', { class: 'boxes' });
  const stage = h('div', { class: 'stage' }, h('img', { src: photoUrl(photo.id), alt: 'Class photo' }), boxes);
  const scroller = h('div', { class: 'stage-scroll' }, stage);
  const panel = h('aside', { class: 'face-panel' });
  const strip = h('div', { class: 'strip' });
  const missing = h('div', { class: 'missing' });
  const better = betterSection(photo);
  const notice = !better ? null : h('div', { class: 'tip' },
    h('p', null, h('b', null, `These faces look like section ${better.section}, not section ${photo.section}. `),
      `${better.fit} of ${better.total} faces clearly match that roster, ${better.here} match this one. Suggestions only use the section the photo is in, so the wrong section gives poor names and no seat map.`),
    h('button', { class: 'primary', onclick: async () => {
      // Other photos added to the same wrong section usually belong in the same place.
      const others = [...S.photos.values()].filter(p => p.section === photo.section && p.id !== photo.id && betterSection(p)?.section === better.section);
      for (const p of [photo, ...others]) await movePhoto(p, better.section);
      S.section = better.section;
      toast(`Moved ${others.length + 1} photo${others.length ? 's' : ''} to section ${better.section}.`);
      render();
    } }, `Move to ${better.section}`));
  wrap.append(...[header, notice, h('div', { class: 'review-main' }, scroller, panel), missing, strip].filter(Boolean));

  const RANK = { unknown: 0, unsure: 1, probable: 2, confident: 3, confirmed: 10, rejected: 20 };
  const all = () => photoFaces(photo.id);
  const ordered = () => all().sort((a, b) => RANK[faceClass(a)] - RANK[faceClass(b)] || a.box.y - b.box.y || a.box.x - b.box.x);
  const unresolved = f => f.status !== 'confirmed' && f.status !== 'rejected';
  const studentName = id => S.students.get(id)?.name || 'Unknown student';

  function select(id, scroll = true) {
    selected = id;
    draw();
    if (scroll && zoom > 1) boxes.querySelector('.box.sel')?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  function selectNext() {
    const next = ordered().find(unresolved);
    select(next ? next.id : null);
  }
  function step(dir) {
    const list = ordered().filter(f => f.status !== 'rejected');
    if (!list.length) return;
    const i = list.findIndex(f => f.id === selected);
    select(list[(i + dir + list.length) % list.length].id);
  }

  async function confirm(f, sid) {
    const dupes = all().filter(o => o.id !== f.id && o.status === 'confirmed' && o.studentId === sid);
    await saveFaces([...dupes.map(o => ({ ...o, status: 'unknown', studentId: null })), { ...f, status: 'confirmed', studentId: sid }]);
    await suggest(photo.id);
    selectNext();
  }
  async function reject(f) {
    await saveFaces([{ ...f, status: 'rejected', studentId: null }]);
    await suggest(photo.id);
    selectNext();
  }
  async function undo(f) {
    await saveFaces([{ ...f, status: 'unknown', studentId: null }]);
    await suggest(photo.id);
    select(f.id);
  }
  async function accept(tiers) {
    const list = all().filter(f => f.status === 'suggested' && tiers.includes(f.suggestion?.tier));
    await saveFaces(list.map(f => ({ ...f, status: 'confirmed' })));
    await suggest(photo.id);
    toast(`Confirmed ${list.length} faces.`);
    selectNext();
  }

  function drawHeader() {
    const fs = all().filter(f => f.status !== 'rejected');
    const count = t => fs.filter(f => f.status === 'suggested' && f.suggestion?.tier === t).length;
    const conf = count('confident'), prob = count('probable');
    const hasSeats = sectionStudents(photo.section).some(s => s.pos || (s.row != null && s.seat != null));
    const g = photo.geo;
    const setZoom = z => { zoom = Math.min(4, Math.max(1, z)); stage.style.width = `${zoom * 100}%`; };
    header.replaceChildren(
      h('div', { class: 'toolbar' },
        h('button', { onclick: () => { S.reviewPhoto = null; render(); } }, '← All photos'),
        h('b', null, `${photo.section} · ${photo.date}`),
        h('span', { class: 'muted' }, `${fs.filter(f => f.status === 'confirmed').length} of ${fs.length} labeled`),
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => setZoom(zoom / 1.5), 'aria-label': 'Zoom out' }, '−'),
        h('button', { onclick: () => setZoom(zoom * 1.5), 'aria-label': 'Zoom in' }, '+')),
      h('div', { class: 'toolbar' },
        h('button', { class: 'primary', disabled: !conf, onclick: () => accept(['confident']) }, `Accept confident (${conf})`),
        h('button', { disabled: !(conf + prob), onclick: () => accept(['confident', 'probable']) }, `Accept confident + likely (${conf + prob})`),
        h('button', { onclick: async () => { await suggest(photo.id); draw(); toast('Suggestions updated.'); } }, 'Re-run suggestions'),
        h('span', { class: 'muted small' }, !hasSeats
          ? `${photo.section} has no seating chart, so only faces are being used.`
          : g && g.inliers ? `Seat map fitted from ${g.inliers} faces.`
          : 'Seat map not fitted yet (groups are still used): confirm a few faces spread across the room.')),
      h('div', { class: 'legend small' }, ['confident', 'probable', 'unsure', 'unknown', 'confirmed'].map(t =>
        h('span', { class: `chip ${t}` }, t === 'confirmed' ? 'confirmed' : TIER_LABEL[t]))));
    setZoom(zoom);
  }

  function drawBoxes() {
    boxes.replaceChildren(...all().filter(f => f.status !== 'rejected').map(f => {
      const s = S.students.get(f.studentId);
      return h('button', {
        class: `box ${faceClass(f)}${f.id === selected ? ' sel' : ''}`,
        style: { left: `${f.box.x * 100}%`, top: `${f.box.y * 100}%`, width: `${f.box.w * 100}%`, height: `${f.box.h * 100}%` },
        title: s ? s.name : 'No match', 'aria-label': s ? s.name : 'Unlabeled face',
        onclick: () => select(f.id, false),
      }, s ? h('span', null, firstName(s)) : null);
    }));
  }

  function studentRow(sid, key, extra, onPick) {
    const s = S.students.get(sid);
    return h('button', { class: 'pick', onclick: onPick },
      key ? h('kbd', null, key) : null, avatarEl(sid, 44),
      h('span', { class: 'pick-text' }, h('b', null, s?.name || '?'),
        h('small', null, [s && s.section !== photo.section ? s.section : '', s?.group ? `group ${s.group}` : '', extra].filter(Boolean).join(' · '))));
  }

  function drawPanel() {
    const f = selected && S.faces.get(selected);
    if (!f) {
      const left = all().filter(unresolved).length;
      panel.replaceChildren(h('div', { class: 'panel-empty' },
        h('p', null, left ? `${left} faces still need a name. Click a box, or press N for the next one.` : 'Every face in this photo is labeled or skipped.'),
        h('p', { class: 'muted small' }, 'Keys: Enter confirm · 1–6 pick · / search · X not a student · U undo · N / ← → move')));
      return;
    }
    const sug = f.suggestion || {};
    const sid = f.studentId;
    const compare = sid ? facesOf(sid).slice(0, 4) : [];
    const results = h('div', { class: 'results' });
    const search = h('input', { type: 'search', placeholder: 'Type a name… ( / )', 'aria-label': 'Search students' });
    const findMatches = q => {
      const n = Engine.normName(q);
      if (!n) return [];
      const tok = n.split(' ');
      const hit = s => { const t = Engine.normName(s.name).split(' '); return tok.every(x => t.some(y => y.startsWith(x))); };
      const here = sectionStudents(photo.section).filter(hit);
      return (here.length ? here : sectionStudents('').filter(hit)).slice(0, 8);
    };
    search.addEventListener('input', () => results.replaceChildren(...findMatches(search.value).map(s => studentRow(s.id, null, '', () => confirm(f, s.id)))));
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const m = findMatches(search.value)[0]; if (m) confirm(f, m.id); }
      if (e.key === 'Escape') search.blur();
    });
    panel.replaceChildren(...[
      h('div', { class: 'compare' },
        h('figure', null, h('img', { src: f.thumb, alt: 'Selected face', width: 150, height: 150 }), h('figcaption', null, 'This face')),
        sid ? h('figure', null, avatarEl(sid, 150), h('figcaption', null, compare.length ? 'Their photo' : 'No photo yet')) : null),
      compare.length > 1 ? h('div', { class: 'thumbs' }, compare.slice(1).map(c => h('img', { src: c.thumb, alt: '', width: 48, height: 48 }))) : null,
      f.status === 'confirmed'
        ? h('div', { class: 'status confirmed' }, `✓ ${studentName(sid)}`, h('button', { class: 'link', onclick: () => undo(f) }, 'Undo (U)'))
        : sid
          ? h('div', null,
              h('div', { class: `status ${faceClass(f)}` }, `${studentName(sid)} — ${TIER_LABEL[sug.tier] || ''}`,
                h('small', null, matchWords(sug.dist, sug.seatDist))),
              h('button', { class: 'primary wide', onclick: () => confirm(f, sid) }, `✓ Yes, ${firstName(S.students.get(sid))} (Enter)`))
          : h('div', { class: 'status unknown' }, 'No good match. Pick someone below or search.'),
      h('h4', null, 'Other possibilities'),
      h('div', { class: 'alts' }, (sug.alts || []).filter(a => a.studentId !== sid || f.status === 'confirmed').slice(0, 6)
        .map((a, i) => studentRow(a.studentId, String(i + 1), matchWords(a.dist, a.seatDist), () => confirm(f, a.studentId)))),
      search, results,
      h('button', { class: 'link danger', onclick: () => reject(f) }, 'Not a student / not a face (X)')].filter(Boolean));
    panel._alts = (sug.alts || []).filter(a => a.studentId !== sid || f.status === 'confirmed').slice(0, 6);
    panel._search = search;
  }

  function drawStrip() {
    const groups = [
      ['Needs a look', f => ['unknown', 'unsure'].includes(faceClass(f))],
      ['Likely', f => faceClass(f) === 'probable'],
      ['Confident', f => faceClass(f) === 'confident'],
      ['Confirmed', f => f.status === 'confirmed'],
      ['Skipped (not students)', f => f.status === 'rejected'],
    ];
    const list = ordered();
    strip.replaceChildren(...groups.map(([title, test]) => {
      const fs = list.filter(test);
      if (!fs.length) return null;
      return h('section', null, h('h4', null, `${title} (${fs.length})`), h('div', { class: 'thumb-row' }, fs.map(f =>
        h('button', { class: `thumb ${faceClass(f)}${f.id === selected ? ' sel' : ''}`, onclick: () => select(f.id) },
          h('img', { src: f.thumb, alt: '', width: 72, height: 72 }),
          h('span', null, f.studentId ? firstName(S.students.get(f.studentId)) : '—')))));
    }).filter(Boolean));
  }

  function drawMissing() {
    const taken = new Set(all().filter(f => f.studentId && f.status !== 'rejected').map(f => f.studentId));
    const absent = sectionStudents(photo.section).filter(s => !taken.has(s.id));
    missing.replaceChildren(absent.length ? h('div', null,
      h('h4', null, `Not matched to any face (${absent.length}) — absent, outside the photo, or not found yet`),
      h('p', { class: 'muted small' }, 'Select a face, then click a name here to assign it.'),
      h('div', { class: 'chips' }, absent.map(s => h('button', { class: 'chip person', onclick: () => {
        const f = selected && S.faces.get(selected);
        if (f) confirm(f, s.id); else toast('Select a face first.');
      } }, avatarEl(s.id, 24), s.name)))) : '');
  }

  function draw() { drawHeader(); drawBoxes(); drawPanel(); drawStrip(); drawMissing(); }

  S.onKey = (e, typing) => {
    if (typing) return;
    const f = selected && S.faces.get(selected);
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); panel._search?.focus(); }
    else if (k === 'n' || e.key === 'ArrowRight') { e.preventDefault(); k === 'n' ? selectNext() : step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') select(null);
    else if (!f) return;
    else if (e.key === 'Enter' && f.studentId && f.status !== 'confirmed') { e.preventDefault(); confirm(f, f.studentId); }
    else if (/^[1-6]$/.test(k) && panel._alts?.[+k - 1]) confirm(f, panel._alts[+k - 1].studentId);
    else if (k === 'x') reject(f);
    else if (k === 'u' && f.status === 'confirmed') undo(f);
  };

  selected = ordered().find(unresolved)?.id || null;
  draw();
  return wrap;
}
