// CacheStorage-shaped persistence for imported assets on HTTP origins, where the
// service worker and sometimes CacheStorage cannot be used. Each asset is stored
// as one Blob in IndexedDB; opening or listing a cache never loads all asset bodies.

const DB_NAME = 'sp-imported-assets';
const DB_VERSION = 1;
const ENTRY_STORE = 'entries';
const CACHE_STORE = 'caches';

function safeGlobal(name) {
  try { return globalThis[name]; } catch { return undefined; }
}

function defaultOrigin() {
  try { return globalThis.location?.origin; } catch { return undefined; }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

function normalizeUrl(input, origin) {
  const raw = typeof input === 'string' ? input : input?.url;
  if (!raw || !origin) throw new TypeError('A URL and page origin are required');
  const url = new URL(raw, origin);
  if (url.origin !== origin) throw new TypeError('Imported assets must use this origin');
  return url.href;
}

/**
 * Create the imported-asset storage adapter. The injectable arguments make the
 * IndexedDB path testable on a secure test origin. Browser callers use the
 * exported singleton below.
 */
export function createImportedAssetStorage({
  indexedDB = safeGlobal('indexedDB'),
  caches = safeGlobal('caches'),
  secure = safeGlobal('isSecureContext'),
  origin = defaultOrigin(),
} = {}) {
  try { if (secure && caches?.open && caches?.delete && caches?.keys) return caches; } catch { /* use IndexedDB */ }
  try { if (!indexedDB?.open) return null; } catch { return null; }

  let dbPromise;
  const opened = new Map();
  function database() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(ENTRY_STORE)) {
            const entries = db.createObjectStore(ENTRY_STORE, { keyPath: ['cacheName', 'url'] });
            entries.createIndex('cacheName', 'cacheName');
          }
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); dbPromise = undefined; opened.clear(); };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
        request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
      }).catch((error) => { dbPromise = undefined; throw error; });
    }
    return dbPromise;
  }

  async function createCache(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('Cache name must be a nonempty string');
    const db = await database();
    const creation = db.transaction(CACHE_STORE, 'readwrite');
    const created = transactionDone(creation);
    creation.objectStore(CACHE_STORE).put(true, name);
    await created;

    return {
      async put(input, response) {
        const url = normalizeUrl(input, origin);
        if (!(response instanceof Response) || !response.ok || response.bodyUsed) {
          throw new TypeError('Imported asset must be an unused, successful Response');
        }
        // Finish reading the one response before opening a transaction: IndexedDB
        // commits an idle transaction across an await.
        const body = await response.blob();
        const headers = [...response.headers];
        const transaction = db.transaction([ENTRY_STORE, CACHE_STORE], 'readwrite');
        const done = transactionDone(transaction);
        transaction.objectStore(CACHE_STORE).put(true, name);
        transaction.objectStore(ENTRY_STORE).put({
          cacheName: name, url, body, status: response.status,
          statusText: response.statusText, headers,
        });
        await done; // request success alone does not mean the write committed
      },

      async match(input) {
        const url = normalizeUrl(input, origin);
        const transaction = db.transaction(ENTRY_STORE, 'readonly');
        const done = transactionDone(transaction);
        const record = await requestResult(transaction.objectStore(ENTRY_STORE).get([name, url]));
        await done;
        if (!record) return undefined;
        if (!(record.body instanceof Blob) || !Array.isArray(record.headers)
          || !Number.isInteger(record.status) || record.status < 200 || record.status > 299) return undefined;
        try {
          return new Response(record.body, {
            status: record.status, statusText: record.statusText, headers: record.headers,
          });
        } catch { return undefined; }
      },

      async keys() {
        const transaction = db.transaction(ENTRY_STORE, 'readonly');
        const done = transactionDone(transaction);
        const urls = [];
        const range = IDBKeyRange.only(name);
        await new Promise((resolve, reject) => {
          const request = transaction.objectStore(ENTRY_STORE).index('cacheName').openKeyCursor(range);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(); return; }
            urls.push(cursor.primaryKey[1]);
            cursor.continue();
          };
          request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
        });
        await done;
        return urls.map((url) => ({ url }));
      },
    };
  }

  function open(name) {
    if (!opened.has(name)) {
      const pending = createCache(name);
      opened.set(name, pending);
      pending.catch(() => { if (opened.get(name) === pending) opened.delete(name); });
    }
    return opened.get(name);
  }

  async function names() {
    const db = await database();
    const transaction = db.transaction(CACHE_STORE, 'readonly');
    const done = transactionDone(transaction);
    const result = await requestResult(transaction.objectStore(CACHE_STORE).getAllKeys());
    await done;
    return result;
  }

  async function remove(name) {
    opened.delete(name);
    const db = await database();
    const transaction = db.transaction([ENTRY_STORE, CACHE_STORE], 'readwrite');
    const done = transactionDone(transaction);
    const cacheStore = transaction.objectStore(CACHE_STORE);
    const existed = await requestResult(cacheStore.getKey(name));
    if (existed !== undefined) {
      cacheStore.delete(name);
      await new Promise((resolve, reject) => {
        const request = transaction.objectStore(ENTRY_STORE).index('cacheName').openCursor(IDBKeyRange.only(name));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(); return; }
          cursor.delete();
          cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
      });
    }
    await done;
    return existed !== undefined;
  }

  return { open, keys: names, delete: remove };
}

export const importedAssetStorage = createImportedAssetStorage();
