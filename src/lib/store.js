// IndexedDB storage for the recording, so a suspended service worker doesn't lose it
// snapshots: one per distinct ESPN game state, keyed by capture time (local ms)
// plays: the play-by-play, keyed by ESPN play id

const DB_NAME = 'nba-spoiler-sync';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('snapshots', { keyPath: 'capturedAt' });
        db.createObjectStore('plays', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// run fn(objectStores) in one transaction, resolving with its result once committed
async function withStores(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    Promise.resolve(fn(...names.map((n) => tx.objectStore(n)))).then((r) => (result = r), reject);
  });
}

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function putSnapshot(snapshot) {
  return withStores(['snapshots'], 'readwrite', (s) => s.put(snapshot));
}

// newest snapshot captured at or before time t, or null
export function snapshotAtOrBefore(t) {
  return withStores(['snapshots'], 'readonly', async (s) => {
    const cursor = await request(s.openCursor(IDBKeyRange.upperBound(t), 'prev'));
    return cursor ? cursor.value : null;
  });
}

export function firstSnapshotTime() {
  return withStores(['snapshots'], 'readonly', async (s) => {
    const cursor = await request(s.openKeyCursor(null, 'next'));
    return cursor ? cursor.key : null;
  });
}

export function pruneSnapshots(before) {
  return withStores(['snapshots'], 'readwrite', (s) => s.delete(IDBKeyRange.upperBound(before, true)));
}

export function putPlays(plays) {
  return withStores(['plays'], 'readwrite', (s) => {
    for (const p of plays) s.put(p);
  });
}

export function loadPlays() {
  return withStores(['plays'], 'readonly', (s) => request(s.getAll()));
}

export function clearAll() {
  return withStores(['snapshots', 'plays'], 'readwrite', (snaps, plays) => {
    snaps.clear();
    plays.clear();
  });
}
