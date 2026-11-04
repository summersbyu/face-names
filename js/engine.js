/* Pure logic, no DOM: face/seat matching, geometry, CSV parsing, name lookup, scheduling.
   Loaded in the browser as a plain script (window.Engine) and in Node for tests. */
(function (root) {
  'use strict';

  // Tuning. Face distances are face-api descriptor (Euclidean) distances:
  // same person is usually < 0.5, different people usually > 0.6.
  const P = {
    NOREF: 0.55,        // appearance cost for a student with no reference photo yet
    UNKNOWN: 0.72,      // cost of leaving a face unlabeled (visitor, TA, missed match)
    SEAT_WEIGHT: 0.05,  // cost per seat of distance from where the student belongs
    SEAT_NEAR: 1.5,     // closer than this many seats lowers the cost; farther raises it
    SEAT_CAP: 6,        // distance beyond this many seats is not penalized further
    NO_SEAT: 0.08,      // penalty for a student with no seat when the seat map is known
    GROUP_ONE: 0.03,    // cost lowered for a student whose group has one clear match in this photo
    GROUP_MANY: 0.08,   // ...or two or more: a photo shows whole table groups
    ANCHOR_DIST: 0.55,  // a face this close to a student, with a clear margin, anchors the seat map
    ANCHOR_MARGIN: 0.1,
    MIN_ANCHORS: 5,
  };

  // ---------- Min-cost assignment (Hungarian), rows <= cols ----------
  function hungarian(cost) {
    const n = cost.length;
    if (!n) return [];
    const m = cost[0].length;
    const INF = 1e18;
    const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
    const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Float64Array(m + 1).fill(INF);
      const used = new Uint8Array(m + 1);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
    return ans;
  }

  // Assign each row to a column or to "unknown" (returns -1) at cost `unknownCost`.
  function assignWithUnknown(M, unknownCost) {
    const n = M.length;
    if (!n) return [];
    const m = M[0].length;
    const full = M.map(row => row.concat(new Array(n).fill(unknownCost)));
    return hungarian(full).map(j => (j < m ? j : -1));
  }

  // ---------- Homography (image point -> seat coordinates) ----------
  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => Array.from(row).concat(b[i]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-10) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  function normalizer(pts) {
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let d = 0;
    for (const [x, y] of pts) d += Math.hypot(x - mx, y - my);
    d /= pts.length;
    const s = d > 1e-12 ? Math.SQRT2 / d : 1;
    return { s, mx, my, T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1] };
  }

  function mul3(A, B) {
    const C = new Array(9).fill(0);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
    return C;
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  function fitHomography(src, dst) {
    if (src.length < 4) return null;
    const ns = normalizer(src), nd = normalizer(dst);
    const AtA = Array.from({ length: 8 }, () => new Float64Array(8));
    const Atb = new Float64Array(8);
    const add = (r, bv) => {
      for (let i = 0; i < 8; i++) {
        Atb[i] += r[i] * bv;
        for (let j = 0; j < 8; j++) AtA[i][j] += r[i] * r[j];
      }
    };
    for (let k = 0; k < src.length; k++) {
      const x = ns.s * (src[k][0] - ns.mx), y = ns.s * (src[k][1] - ns.my);
      const X = nd.s * (dst[k][0] - nd.mx), Y = nd.s * (dst[k][1] - nd.my);
      add([x, y, 1, 0, 0, 0, -x * X, -y * X], X);
      add([0, 0, 0, x, y, 1, -x * Y, -y * Y], Y);
    }
    const h = solveLinear(AtA, Atb);
    if (!h) return null;
    const TdInv = [1 / nd.s, 0, nd.mx, 0, 1 / nd.s, nd.my, 0, 0, 1];
    const H = mul3(TdInv, mul3(h.concat(1), ns.T));
    return H.every(Number.isFinite) ? H : null;
  }

  // Deterministic PRNG so the same photo always gets the same suggestions.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Robust fit: tolerates some wrong anchors (a confident match that was actually wrong).
  function ransacHomography(src, dst, { iters = 500, thresh = 1.25, minInliers = P.MIN_ANCHORS } = {}) {
    const n = src.length;
    if (n < minInliers) return null;
    const rand = rng(n * 7919 + 17);
    const inliersOf = H => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const [x, y] = applyH(H, src[i][0], src[i][1]);
        if (Math.hypot(x - dst[i][0], y - dst[i][1]) < thresh) out.push(i);
      }
      return out;
    };
    let best = [];
    for (let it = 0; it < iters; it++) {
      const pick = new Set();
      while (pick.size < 4) pick.add(Math.floor(rand() * n));
      const idx = [...pick];
      const H = fitHomography(idx.map(i => src[i]), idx.map(i => dst[i]));
      if (!H) continue;
      const inl = inliersOf(H);
      if (inl.length > best.length) best = inl;
    }
    if (best.length < minInliers || best.length < 0.5 * n) return null;
    let H = fitHomography(best.map(i => src[i]), best.map(i => dst[i]));
    if (!H) return null;
    const refined = inliersOf(H);
    if (refined.length >= best.length) {
      const H2 = fitHomography(refined.map(i => src[i]), refined.map(i => dst[i]));
      if (H2) { H = H2; best = refined; }
    }
    // Anchors all in one row (or one column) can't pin down the rest of the room.
    const rows = new Set(best.map(i => Math.round(dst[i][1])));
    const cols = new Set(best.map(i => Math.round(dst[i][0])));
    if (rows.size < 2 || cols.size < 2) return null;
    return { H, inliers: best };
  }

  // ---------- Face matching ----------
  function descDist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  function appearance(face, student) {
    if (!face.desc || !student.refs.length) return P.NOREF;
    let best = Infinity;
    for (const r of student.refs) { const d = descDist(face.desc, r); if (d < best) best = d; }
    return best;
  }

  /**
   * faces:    [{ id, desc: number[]|null, x, y, fixed: studentId|null }]  x,y = face center in image units
   * students: [{ id, group, seat: {x, y}|null, refs: number[][] }]       seat x = seat number, y = row
   * Returns { results: [{ faceId, studentId, dist, seatDist, cost, tier, alts }], missing, geo }
   */
  function matchPhoto(faces, students) {
    const fixedIds = new Set(faces.filter(f => f.fixed).map(f => f.fixed));
    const pool = students.filter(s => !fixedIds.has(s.id));
    const free = faces.filter(f => !f.fixed);
    const byId = new Map(students.map(s => [s.id, s]));

    const D = free.map(f => pool.map(s => appearance(f, s)));

    // Pass 1: appearance only. Clear matches become anchors for the seat map.
    const first = pool.length ? assignWithUnknown(D, P.UNKNOWN) : free.map(() => -1);

    // Groups sit together, so groups with clear matches pull in their other members. Needs no seat map.
    const votes = new Map();
    const vote = s => { if (s && s.group) votes.set(s.group, (votes.get(s.group) || 0) + 1); };
    for (const f of faces) if (f.fixed) vote(byId.get(f.fixed));
    free.forEach((f, i) => {
      const j = first[i];
      if (j >= 0 && f.desc && pool[j].refs.length && D[i][j] < P.ANCHOR_DIST) vote(pool[j]);
    });
    const groupBonus = s => { const n = votes.get(s.group) || 0; return n >= 2 ? P.GROUP_MANY : n === 1 ? P.GROUP_ONE : 0; };

    const src = [], dst = [];
    for (const f of faces) {
      const s = f.fixed && byId.get(f.fixed);
      if (s && s.seat) { src.push([f.x, f.y]); dst.push([s.seat.x, s.seat.y]); }
    }
    free.forEach((f, i) => {
      const j = first[i];
      if (j < 0) return;
      const s = pool[j];
      if (!s.seat || !s.refs.length || !f.desc) return;
      const d = D[i][j];
      let second = Infinity;
      D[i].forEach((v, k) => { if (k !== j && v < second) second = v; });
      const margin = (votes.get(s.group) || 0) >= 2 ? P.ANCHOR_MARGIN / 2 : P.ANCHOR_MARGIN;
      if (d < P.ANCHOR_DIST && second - d > margin) {
        src.push([f.x, f.y]);
        dst.push([s.seat.x, s.seat.y]);
      }
    });
    const fit = ransacHomography(src, dst);

    // Seat prior: how far is this face from the student's seat (or from their group's seats)?
    const groupSeats = new Map();
    for (const s of students) {
      if (!s.group || !s.seat) continue;
      if (!groupSeats.has(s.group)) groupSeats.set(s.group, []);
      groupSeats.get(s.group).push(s.seat);
    }
    const seatDist = (pt, s) => {
      if (!s.seat) return null;
      let d = Math.hypot(pt[0] - s.seat.x, pt[1] - s.seat.y);
      for (const g of groupSeats.get(s.group) || []) d = Math.min(d, Math.hypot(pt[0] - g.x, pt[1] - g.y) + 0.5);
      return d;
    };
    const pts = free.map(f => (fit ? applyH(fit.H, f.x, f.y) : null));
    const SD = free.map((f, i) => pool.map(s => (pts[i] ? seatDist(pts[i], s) : null)));
    const C = free.map((f, i) => pool.map((s, j) => {
      const base = D[i][j] - groupBonus(s);
      if (!fit) return base;
      const sd = SD[i][j];
      return base + (sd == null ? P.NO_SEAT : P.SEAT_WEIGHT * (Math.min(sd, P.SEAT_CAP) - P.SEAT_NEAR));
    }));

    // Pass 2: appearance + seat.
    const final = pool.length ? assignWithUnknown(C, P.UNKNOWN) : free.map(() => -1);
    const assigned = new Set();
    const results = free.map((f, i) => {
      const order = pool.map((s, j) => j).sort((a, b) => C[i][a] - C[i][b]);
      const alts = order.slice(0, 6).map(j => ({ studentId: pool[j].id, dist: D[i][j], seatDist: SD[i][j], cost: C[i][j] }));
      const j = final[i];
      if (j < 0) return { faceId: f.id, studentId: null, dist: null, seatDist: null, cost: null, tier: 'unknown', alts };
      assigned.add(pool[j].id);
      const cost = C[i][j], dist = D[i][j], sd = SD[i][j];
      let alt = Infinity;
      for (let k = 0; k < pool.length; k++) if (k !== j && C[i][k] < alt) alt = C[i][k];
      const margin = alt - cost;
      const hasRefs = !!f.desc && pool[j].refs.length > 0;
      let tier = 'unsure';
      const inGroup = (votes.get(pool[j].group) || 0) >= 2;
      if (hasRefs && dist < 0.45 && margin > 0.06 && (sd == null || sd <= 3)) tier = 'confident';
      else if ((hasRefs && dist < 0.55 && margin > 0.03) || ((inGroup || (sd != null && sd <= 1.5)) && dist < 0.6 && margin > 0.03)) tier = 'probable';
      return { faceId: f.id, studentId: pool[j].id, dist, seatDist: sd, cost, tier, alts };
    });
    const missing = pool.filter(s => !assigned.has(s.id)).map(s => s.id);
    return { results, missing, geo: fit ? { anchors: src.length, inliers: fit.inliers.length } : { anchors: src.length, inliers: 0 } };
  }

  // How many of these face descriptors clearly match someone on a roster, each student used once.
  function rosterFit(descs, refLists) {
    if (!descs.length || !refLists.length) return 0;
    const M = descs.map(d => refLists.map(refs => {
      let best = Infinity;
      for (const r of refs) { const v = descDist(d, r); if (v < best) best = v; }
      return best;
    }));
    return assignWithUnknown(M, P.ANCHOR_DIST).filter(j => j >= 0).length;
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
  }

  const ALIASES = {
    section: ['section', 'sec', 'class', 'period', 'course section', 'class section'],
    name: ['name', 'student', 'student name', 'full name', 'preferred name'],
    first: ['first', 'first name', 'firstname', 'given name', 'preferred first name'],
    last: ['last', 'last name', 'lastname', 'surname', 'family name'],
    group: ['group', 'team', 'table', 'pod'],
    row: ['row'],
    seat: ['seat', 'col', 'column', 'position', 'seat number'],
    photo: ['photo', 'file', 'filename', 'image', 'picture'],
    notes: ['notes', 'note', 'info', 'facts'],
  };

  function rosterFromCSV(rows) {
    if (!rows.length) return { records: [], columns: {} };
    const header = rows[0].map(h => h.toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ').trim());
    const col = {};
    header.forEach((h, i) => {
      for (const [key, names] of Object.entries(ALIASES)) if (names.includes(h) && !(key in col)) col[key] = i;
    });
    const known = new Set(Object.values(col));
    const records = [];
    for (const r of rows.slice(1)) {
      const get = k => (k in col ? (r[col[k]] || '').trim() : '');
      let name = get('name');
      if (!name) name = [get('first'), get('last')].filter(Boolean).join(' ');
      else if (name.includes(',') && !('first' in col)) {
        const [last, first] = name.split(',').map(s => s.trim());
        name = `${first} ${last}`.trim();
      }
      if (!name) continue;
      const facts = [];
      rows[0].forEach((h, i) => { if (!known.has(i) && r[i]) facts.push(`${h}: ${r[i]}`); });
      const num = v => (v === '' || isNaN(+v) ? null : +v);
      records.push({
        section: get('section'), name, group: get('group'),
        row: num(get('row')), seat: num(get('seat')),
        photo: get('photo'), notes: [get('notes'), ...facts].filter(Boolean).join('\n'),
        has: { group: 'group' in col, row: 'row' in col, seat: 'seat' in col, notes: 'notes' in col || facts.length > 0 },
      });
    }
    return { records, columns: col };
  }

  // ---------- Names ----------
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const namesOf = s => [s.name, ...(s.aliases || [])].map(normName);

  // Whether every word typed starts a word of the student's name or alias, in any order ("gar ma" finds Maria Garcia).
  function nameMatches(query, s) {
    const qt = normName(query).split(' ').filter(Boolean);
    return qt.length > 0 && namesOf(s).some(name => { const nt = name.split(' '); return qt.every(t => nt.some(n => n.startsWith(t))); });
  }

  // Finds the one student a short or partial name refers to ("maria g", "Garcia", "Maria Garcia").
  // Also checks aliases, e.g. the legal name of a student listed by their preferred name.
  // Tries the strictest test first, so "Smith, Ann" finds Ann Smith even with an Anna Smith on the roster.
  // Records linked as one person count once: a student with a record in two sections isn't ambiguous.
  function findStudent(query, students) {
    const q = normName(query);
    if (!q) return null;
    const qt = q.split(' ');
    const sorted = t => [...t].sort().join(' ');
    const tests = [
      nt => nt.join(' ') === q,
      nt => sorted(nt) === sorted(qt),
      nt => qt.every(t => nt.includes(t)),
      nt => qt.every(t => nt.some(n => n.startsWith(t))),
    ];
    for (const test of tests) {
      const hits = students.filter(s => namesOf(s).some(name => test(name.split(' '))));
      if (hits.length && new Set(hits.map(s => s.personId || s)).size === 1) return hits[0];
    }
    return null;
  }

  // ---------- Student files from a colleague ----------
  // What to save when adding a student file. Someone who already has a student keeps that record's person key
  // (their study progress hangs on it), notes, and any face they labeled themselves. A record with a different
  // id but the same section and name is the same student imported separately: their photos join that record.
  function mergeStudentFile(mine, file) {
    const byId = new Map(mine.students.map(s => [s.id, s]));
    const key = s => `${s.section}|${normName(s.name)}`;
    const byName = new Map(mine.students.map(s => [key(s), s]));
    const faceById = new Map(mine.faces.map(f => [f.id, f]));
    const remap = new Map(), students = [];
    for (const s of file.students) {
      const same = byId.get(s.id);
      if (same) students.push({ ...s, personId: same.personId, notes: same.notes || s.notes });
      else if (byName.has(key(s))) remap.set(s.id, byName.get(key(s)).id);
      else students.push(s);
    }
    const photos = new Set([...mine.photoIds, ...file.photoIds]);
    const faces = file.faces
      .filter(f => !f.photoId || photos.has(f.photoId) || f.status === 'confirmed')
      .filter(f => faceById.get(f.id)?.status !== 'confirmed')
      .map(f => (remap.has(f.studentId) ? { ...f, studentId: remap.get(f.studentId) } : f));
    return { students, faces };
  }

  // ---------- Class photo roll pages ----------
  // Caption under a roll photo: "Rivera, James Allen (Allen)" -> { last, first, preferred }.
  function parseRollCaption(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 120) return null;
    const m = t.match(/^([^,()]+),\s*([^()]+?)\s*(?:\(([^)]+)\))?$/);
    if (!m) return null;
    return { last: m[1].trim(), first: m[2].trim(), preferred: (m[3] || '').trim() };
  }

  // Course, section, and term from the page header ("Course: ACC 407 Section: 001 ... Winter 2027").
  function parseRollHeader(text) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const course = t.match(/Course:\s*([A-Z]{1,5})\s+(\d{3}[A-Z]?)(?![a-z])/);
    return {
      course: course ? `${course[1]} ${course[2]}` : '',
      section: (t.match(/Section:\s*0*(\d+)/) || [])[1] || '',
      term: (t.match(/(?:Winter|Spring|Summer|Fall)\s+\d{4}/) || [])[0] || '',
    };
  }

  // Display name "Preferred Last"; the legal name is kept as an alias so seating charts can use either.
  function rollName({ last, first, preferred }) {
    const given = (preferred || first.split(' ')[0] || '').trim();
    const name = `${given} ${last}`.trim();
    const legal = `${first} ${last}`.trim();
    return { name, aliases: normName(legal) === normName(name) ? [] : [legal], legal: `${last}, ${first}` };
  }

  function nameFromFilename(fn) {
    return String(fn).replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\d+/g, ' ').trim();
  }

  // ---------- Spaced repetition (SM-2 style) ----------
  const DAY = 864e5;
  function schedule(rec, grade, now) {
    const r = Object.assign({ ease: 2.5, ivl: 0, reps: 0, lapses: 0 }, rec || {});
    if (grade === 1) {
      if (r.reps > 0) r.lapses++;
      r.ivl = 0;
      r.ease = Math.max(1.3, r.ease - 0.2);
      r.due = now + 10 * 60e3;
    } else {
      if (r.ivl === 0) r.ivl = grade === 2 ? 0.5 : grade === 3 ? 1 : 3;
      else r.ivl = grade === 2 ? r.ivl * 1.2 : grade === 3 ? r.ivl * r.ease : r.ivl * r.ease * 1.3;
      if (grade === 2) r.ease = Math.max(1.3, r.ease - 0.15);
      if (grade === 4) r.ease += 0.15;
      r.reps++;
      r.due = now + r.ivl * DAY;
    }
    r.last = now;
    return r;
  }

  // Hints from weakest to strongest: the student's notes, initials, last name, then the start of the first name.
  function nameHints(name, notes) {
    const words = String(name).trim().split(/\s+/);
    const mask = (w, keep = 1) => { let n = 0; return w.replace(/\p{L}/gu, c => (n++ < keep ? c : '•')); };
    const out = [];
    if (String(notes || '').trim()) out.push({ kind: 'note', text: String(notes).trim() });
    out.push({ kind: 'name', text: words.map(w => mask(w)).join(' ') });
    if (words.length > 1) out.push({ kind: 'name', text: [...words.slice(0, -1).map(w => mask(w)), words[words.length - 1]].join(' ') });
    if ([...words[0]].length > 3) out.push({ kind: 'name', text: [mask(words[0], 2), ...words.slice(1).map((w, i) => (i === words.length - 2 ? w : mask(w)))].join(' ') });
    return out;
  }

  function formatInterval(ms) {
    const m = ms / 60e3;
    if (m < 60) return `${Math.round(m)}m`;
    if (m < 60 * 24) return `${Math.round(m / 60)}h`;
    const d = m / (60 * 24);
    return d < 30 ? `${Math.round(d)}d` : `${Math.round(d / 30)}mo`;
  }

  const Engine = {
    P, hungarian, assignWithUnknown, fitHomography, ransacHomography, applyH,
    descDist, matchPhoto, rosterFit, parseCSV, rosterFromCSV, normName, nameMatches, findStudent, mergeStudentFile, nameFromFilename, parseRollCaption, parseRollHeader, rollName,
    schedule, nameHints, formatInterval, DAY,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
