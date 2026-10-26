/**
 * Audius Studio — browser storage for audio and the autosaved session.
 *
 * Everything stays on this device (IndexedDB); nothing is uploaded. Two stores:
 *   audio   — the original bytes of each imported or recorded sound, by asset id
 *   session — small records by key, e.g. "autosave" (the last working session)
 *
 * Every call degrades to a no-op (null / false) when IndexedDB is unavailable,
 * as in some private-browsing modes, so the studio still runs without it.
 *
 * Kept compatible with old browsers (Galaxy Note 3 / Chrome 95, Safari 14):
 * plain IDB requests wrapped in promises, no structuredClone, no top-level await.
 */

const DB_NAME = "audius-studio";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = window.indexedDB && window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (_) {
      req = null;
    }
    if (!req) return resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Runs one request in a transaction; resolves with its result, or `fallback` on any failure. */
async function run(storeName, mode, makeRequest, fallback = null) {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, mode);
      const req = makeRequest(tx.objectStore(storeName));
      let result = fallback;
      req.onsuccess = () => {
        result = req.result === undefined ? fallback : req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(fallback);
      tx.onabort = () => resolve(fallback);
    } catch (_) {
      resolve(fallback);
    }
  });
}

/** True when this browser can keep audio between visits. */
export async function storageAvailable() {
  return !!(await openDb());
}

/**
 * Keeps a sound's original file bytes.
 * @param {{ id: string, name: string, color?: string, type?: string, bytes: ArrayBuffer }} rec
 */
export async function putAudio(rec) {
  const ok = await run("audio", "readwrite", (s) => s.put({
    id: rec.id,
    name: rec.name,
    color: rec.color || "",
    type: rec.type || "",
    bytes: rec.bytes,
    savedAt: Date.now(),
  }), false);
  return ok !== false;
}

/** One stored sound, or null. */
export function getAudio(id) {
  return run("audio", "readonly", (s) => s.get(id), null);
}

/** Ids of every stored sound. */
export function listAudioIds() {
  return run("audio", "readonly", (s) => s.getAllKeys(), []);
}

export function deleteAudio(id) {
  return run("audio", "readwrite", (s) => s.delete(id), null);
}

export function putSession(key, value) {
  return run("session", "readwrite", (s) => s.put(value, key), null);
}

export function getSession(key) {
  return run("session", "readonly", (s) => s.get(key), null);
}

export function deleteSession(key) {
  return run("session", "readwrite", (s) => s.delete(key), null);
}

/** Asks the browser not to clear this site's storage under pressure (granted silently or not at all). */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) {}
  return false;
}

/** { usage, quota } in bytes, or null where the browser does not say. */
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (_) {}
  return null;
}
