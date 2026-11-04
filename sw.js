/* Lets the app open without a connection. Always tries the newest files first, and never sees student data,
   which stays in the browser's database rather than in network requests. */
const CACHE = 'face-names-1';
const APP = ['./', 'index.html', 'css/style.css', 'js/engine.js', 'js/db.js', 'js/faces.js', 'js/seating-pdf.js',
  'js/app.js', 'js/ui-roster.js', 'js/ui-label.js', 'js/ui-study.js', 'js/ui-backup.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP)));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(async res => {
    if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
