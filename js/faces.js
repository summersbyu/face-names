/* Face detection and face signatures, using face-api (runs entirely in the browser). */
const Faces = (() => {
  const LIB = 'js/lib/';
  const MAX_SIDE = 4000;      // keep back-row faces large enough to detect
  const DISPLAY_SIDE = 2400;  // stored copy of each class photo
  let ready = null;

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn’t load ${src}.`));
    document.head.append(s);
  });
  function loadNet(net, { data, weights }) {
    const bin = atob(data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    net.loadFromWeightMap(faceapi.tf.io.decodeWeights(bytes.buffer, weights));
  }

  // Loaded on first use: studying doesn't need them, and they're slow to start on a phone.
  function load() {
    if (!ready) {
      ready = (async () => {
        await loadScript(LIB + 'face-api.js');
        await loadScript(LIB + 'face-models.js');
        try { await faceapi.tf.setBackend('webgl'); } catch { /* falls back to CPU */ }
        await faceapi.tf.ready();
        loadNet(faceapi.nets.ssdMobilenetv1, FaceModels.ssd_mobilenetv1_model);
        loadNet(faceapi.nets.faceLandmark68Net, FaceModels.face_landmark_68_model);
        loadNet(faceapi.nets.faceRecognitionNet, FaceModels.face_recognition_model);
        delete window.FaceModels;
      })();
      ready.catch(() => { ready = null; });
    }
    return ready;
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  async function fileToCanvas(file, maxSide = MAX_SIDE) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error(`Can't read ${file.name}. Use JPEG or PNG (iPhone HEIC photos need converting).`);
    }
    const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = canvas(bmp.width * sc, bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return c;
  }

  function crop(src, x, y, w, h, outW, outH) {
    const c = canvas(outW, outH);
    const g = c.getContext('2d');
    g.fillStyle = '#888';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  function overlap(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return { iou: inter / (a.w * a.h + b.w * b.h - inter), contain: inter / Math.min(a.w * a.h, b.w * b.h) };
  }

  // Finds faces in the whole photo and in overlapping tiles, so small faces in the back rows are found too.
  async function detectBoxes(src, onProgress) {
    const W = src.width, H = src.height;
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 300 });
    const regions = [[0, 0, W, H]];
    if (Math.max(W, H) > 1100) {
      const T = 900, step = 650;
      const starts = (len) => {
        const out = [];
        for (let p = 0; ; p += step) { out.push(Math.min(p, Math.max(0, len - T))); if (p + T >= len) break; }
        return [...new Set(out)];
      };
      for (const y of starts(H)) for (const x of starts(W)) regions.push([x, y, Math.min(T, W), Math.min(T, H)]);
    }
    const found = [];
    for (let i = 0; i < regions.length; i++) {
      const [x, y, w, h] = regions[i];
      const input = i === 0 ? src : crop(src, x, y, w, h, w, h);
      const dets = await faceapi.detectAllFaces(input, opts);
      for (const d of dets) found.push({ x: d.box.x + x, y: d.box.y + y, w: d.box.width, h: d.box.height, score: d.score });
      onProgress && onProgress(`Finding faces… ${Math.round(((i + 1) / regions.length) * 100)}%`);
    }
    found.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const b of found) {
      if (b.w < 12 || b.h < 12) continue;
      if (kept.every(k => { const o = overlap(k, b); return o.iou < 0.3 && o.contain < 0.6; })) kept.push(b);
    }
    return kept;
  }

  // Stored at the detail the source has, from 200 to 400 pixels, so a small face doesn't take up space for nothing.
  function thumb(src, b) {
    const side = Math.max(b.w, b.h) * 1.7;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const out = Math.round(Math.min(400, Math.max(200, side)));
    return crop(src, cx - side / 2, cy - side / 2, side, side, out, out).toDataURL('image/jpeg', 0.85);
  }

  const round = d => Array.from(d, v => Math.round(v * 1e5) / 1e5);

  // Face signature (128 numbers) from a close crop around one detected face.
  async function describe(src, b) {
    const side = Math.max(b.w, b.h) * 2.2;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const sx = cx - side / 2, sy = cy - side / 2, k = 300 / side;
    const c = crop(src, sx, sy, side, side, 300, 300);
    const r = await faceapi.detectSingleFace(c, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks().withFaceDescriptor();
    if (r) return round(r.descriptor);
    // Blurry or cut-off faces may not be found a second time: align on the original box instead.
    try {
      const box = new faceapi.Rect((b.x - sx) * k, (b.y - sy) * k, b.w * k, b.h * k);
      const [faceImg] = await faceapi.extractFaces(c, [box]);
      const lm = (await faceapi.detectFaceLandmarks(faceImg)).shiftBy(box.x, box.y);
      const [aligned] = await faceapi.extractFaces(c, [lm.align()]);
      return round(await faceapi.computeFaceDescriptor(aligned));
    } catch {
      return null;
    }
  }

  async function processPhoto(file, onProgress) {
    await load();
    onProgress && onProgress('Reading photo…');
    const src = await fileToCanvas(file);
    const boxes = await detectBoxes(src, onProgress);
    const faces = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      faces.push({
        box: { x: b.x / src.width, y: b.y / src.height, w: b.w / src.width, h: b.h / src.height },
        desc: await describe(src, b),
        thumb: thumb(src, b),
      });
      onProgress && onProgress(`Reading faces… ${i + 1} of ${boxes.length}`);
    }
    const sc = Math.min(1, DISPLAY_SIDE / Math.max(src.width, src.height));
    const disp = crop(src, 0, 0, src.width, src.height, src.width * sc, src.height * sc);
    const blob = await new Promise(res => disp.toBlob(res, 'image/jpeg', 0.85));
    return { faces, blob, width: disp.width, height: disp.height };
  }

  // A photo of one person (roster photo, headshot): uses the largest face in it.
  async function processPortrait(file) {
    await load();
    const src = await fileToCanvas(file, 1600);
    const dets = await faceapi.detectAllFaces(src, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }));
    if (!dets.length) return null;
    const d = dets.sort((a, b) => b.box.area - a.box.area)[0];
    const b = { x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height };
    return { desc: await describe(src, b), thumb: thumb(src, b) };
  }

  // ---------- Duplicate photos ----------
  // Two thumbnails count as one picture if one lines up with the other after a small shift and stretch
  // (seating charts squeeze and blur their copies). Tuned on chart/roll pairs: copies score above 0.92.
  const SAME_PICTURE = 0.92;
  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Couldn’t read a photo.'));
    img.src = src;
  });
  function grayOf(img, size, sx = 1, sy = 1) {
    const c = canvas(size, size), ctx = c.getContext('2d', { willReadFrequently: true });
    const w = img.width / sx, h = img.height / sy;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data, g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i++) g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
    return g;
  }
  function correlation(a, b, N, m, dx, dy) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = m; y < N - m; y++) for (let x = m; x < N - m; x++) {
      const p = a[y * N + x], q = b[(y + dy) * N + x + dx];
      sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; n++;
    }
    return (sab - sa * sb / n) / (Math.sqrt((saa - sa * sa / n) * (sbb - sb * sb / n)) || 1);
  }
  async function samePicture(thumbA, thumbB) {
    const N = 32, m = 3, STRETCH = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15];
    const [imgA, imgB] = await Promise.all([loadImage(thumbA), loadImage(thumbB)]);
    const a = grayOf(imgA, N);
    for (const sx of STRETCH) for (const sy of STRETCH) {
      const b = grayOf(imgB, N, sx, sy);
      for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) {
        if (correlation(a, b, N, m, dx, dy) >= SAME_PICTURE) return true;
      }
    }
    return false;
  }
  async function quality(thumbSrc) {
    const img = await loadImage(thumbSrc);
    const N = 200, g = grayOf(img, N);
    let s = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const v = 4 * g[y * N + x] - g[y * N + x - 1] - g[y * N + x + 1] - g[(y - 1) * N + x] - g[(y + 1) * N + x];
      s += v * v;
    }
    return { size: img.width, sharpness: s };
  }

  return { load, processPhoto, processPortrait, samePicture, quality };
})();
