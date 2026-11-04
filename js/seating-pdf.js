/* Reads seating-chart PDFs: for each student a headshot, first name, last name, and a "group.seat" label.
   Positions on the chart double as a floor plan of the room for seat matching. Uses PDF.js, loaded on demand. */
const SeatingPdf = (() => {
  const PDFJS = 'js/lib/';
  const SEAT_RE = /^\d{1,2}\.\d{1,2}$/;
  const NAME_RE = /^\p{L}[\p{L}'’ .-]*$/u;
  let loading = null;

  function load() {
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS + 'pdf.min.js';
        s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(); };
        s.onerror = () => { loading = null; reject(new Error('Couldn’t load the PDF reader.')); };
        document.head.append(s);
      });
    }
    return loading;
  }

  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const dataURLBlob = url => {
    const [head, b64] = url.split(',');
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) });
  };
  const median = arr => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

  // Text items and image placements, in page coordinates (points, y down).
  async function pageItems(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const texts = tc.items.filter(i => i.str.trim()).map(i => {
      const [a, b, c, d, e, f] = i.transform;
      const [x, y] = vp.convertToViewportPoint(e, f);
      return { s: i.str.trim(), x, y, w: i.width, size: Math.hypot(c, d) };
    });
    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const imgs = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    ops.fnArray.forEach((fn, k) => {
      const a = ops.argsArray[k];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintJpegXObject) {
        const m = mul(vp.transform, ctm);
        const xs = [m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[3] + m[5]];
        imgs.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]), h: Math.abs(ys[1] - ys[0]) });
      }
    });
    return { texts, imgs };
  }

  // Pairs each first name with the last name under it, the photo above it, and the nearest seat label.
  function findPeople(texts, imgs) {
    const counts = {};
    for (const t of texts) if (!SEAT_RE.test(t.s)) counts[t.size.toFixed(1)] = (counts[t.size.toFixed(1)] || 0) + 1;
    const common = Object.entries(counts).filter(([, n]) => n > 20).map(([k]) => +k).sort((a, b) => a - b);
    if (!common.length) return [];
    const lastSize = common[0];  // last names: the smallest font that appears for most students
    const lasts = texts.filter(t => Math.abs(t.size - lastSize) < 0.2);
    const firsts = texts.filter(t => t.size > lastSize * 1.4 && t.s.length < 25 && !SEAT_RE.test(t.s) && NAME_RE.test(t.s));
    const photos = [];
    for (const i of imgs) {
      if (i.w < 120 && !photos.some(j => Math.abs(j.x - i.x) < 3 && Math.abs(j.y - i.y) < 3)) photos.push(i);
    }
    const people = [];
    for (const f of firsts) {
      const fc = f.x + f.w / 2;
      const last = lasts.filter(s => s.y > f.y && s.y - f.y < f.size * 1.5 && Math.abs(s.x + s.w / 2 - fc) < f.size * 3)
        .sort((a, b) => a.y - b.y)[0];
      if (!last) continue;
      let box = photos.filter(i => Math.abs(i.x + i.w / 2 - fc) < i.w * 0.6 &&
        f.y - (i.y + i.h) > -f.size * 0.5 && f.y - (i.y + i.h) < f.size * 2).sort((a, b) => b.y - a.y)[0];
      // Some charts flatten all photos into strips; then the photo is the square just above the name.
      if (!box) { const side = f.size * 3.4; box = { x: fc - side / 2, y: f.y - f.size * 0.9 - side, w: side, h: side }; }
      people.push({ first: f.s, last: last.s, box, cx: box.x + box.w / 2, cy: box.y + box.h / 2, seat: null });
    }
    // Each seat label goes to one student, choosing the pairing with the least total distance.
    const seats = texts.filter(t => SEAT_RE.test(t.s));
    if (people.length && seats.length) {
      const M = people.map(p => seats.map(s => Math.hypot(s.x - p.cx, s.y - p.cy) / p.box.w));
      Engine.assignWithUnknown(M, 1.8).forEach((j, i) => { if (j >= 0) people[i].seat = seats[j].s; });
    }
    return people;
  }

  function header(texts, fileName) {
    const all = texts.map(t => t.s).join(' ');
    let section = (String(fileName).match(/section\s*0*(\d+)/i) || [])[1] || '';
    if (!section) {
      const label = texts.find(t => /^section$/i.test(t.s));
      const num = label && texts.find(t => /^\d{1,3}$/.test(t.s) && Math.abs(t.y - label.y) < 4 && t.x > label.x);
      if (num) section = String(+num.s);
    }
    const term = all.match(/\b(fall|winter|spring|summer)\s+(\d{4})\b/i);
    const room = (all.match(/\b\d{3,4}\s+[A-Z]{2,5}\b/) || [])[0] || '';
    return {
      section,
      term: term ? `${term[1][0].toUpperCase()}${term[1].slice(1).toLowerCase()} ${term[2]}` : '',
      termCode: term ? `${term[1][0].toUpperCase()}${term[2].slice(2)}` : '',
      room,
    };
  }

  async function read(file, onProgress) {
    await load();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const { texts, imgs } = await pageItems(page);
    const people = findPeople(texts, imgs);
    const info = header(texts, file.name);
    if (!people.length) return { ...info, people };

    // Seat units: the typical distance between neighboring photos counts as one seat.
    const nn = people.map(p => Math.min(...people.filter(q => q !== p).map(q => Math.hypot(q.cx - p.cx, q.cy - p.cy))));
    const unit = median(nn) || median(people.map(p => p.box.w));

    onProgress && onProgress('Cutting out photos…');
    const w = median(people.map(p => p.box.w));
    const scale = Math.max(2, 190 / w);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    // 'print' renders in one go; the default waits on animation frames, which pause in background tabs.
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
    for (const p of people) {
      const m = p.box.w * 0.12, side = (p.box.w + 2 * m) * scale;
      const out = document.createElement('canvas');
      out.width = out.height = Math.round(side);
      out.getContext('2d').drawImage(canvas, (p.box.x - m) * scale, (p.box.y - m) * scale, side, side, 0, 0, out.width, out.height);
      p.blob = dataURLBlob(out.toDataURL('image/jpeg', 0.92));  // sync; toBlob is throttled in background tabs
      p.pos = { x: Math.round((p.cx / unit) * 100) / 100, y: Math.round((p.cy / unit) * 100) / 100 };
      p.group = p.seat ? p.seat.split('.')[0] : '';
    }
    return { ...info, people };
  }

  return { read, findPeople, header };
})();
