/* IndexedDB storage. Everything stays in this browser on this computer. */
// The automated check (tests/smoke.html) sets its own name, so it can never touch real data.
const DB_NAME = window.FN_DB || 'face-names';
const DB = (() => {
  const STORES = ['students', 'faces', 'photos', 'srs', 'meta'];
  let dbp = null;

  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    STORES,
    getAll: store => tx(store, 'readonly', s => s.getAll()),
    get: (store, id) => tx(store, 'readonly', s => s.get(id)),
    put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); }),
    putMany: (store, objs) => tx(store, 'readwrite', s => { for (const o of objs) s.put(o); }),
    del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
    delMany: (store, ids) => tx(store, 'readwrite', s => { for (const id of ids) s.delete(id); }),
    clear: store => tx(store, 'readwrite', s => { s.clear(); }),
  };
})();
