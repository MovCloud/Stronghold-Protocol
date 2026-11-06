// Application-level imported art reads. Works on HTTP without intercepting global browser APIs.
// Only content-hashed same-origin art is eligible; code, manifests, plugins and sockets stay on the network.
import { importedAssetStorage } from './assetImportDb.js';
import { IMPORTED_ASSET_CACHE, shouldServeImportedAsset } from './assetCache.js';

export function createImportedAssetLoader({ storage = importedAssetStorage,
  origin = () => globalThis.location?.origin, fetch: fetcher = (...args) => globalThis.fetch(...args),
  urls = globalThis.URL } = {}) {
  const blobs = new Map();
  const pageOrigin = () => typeof origin === 'function' ? origin() : origin;
  const eligible = (input) => shouldServeImportedAsset(input, pageOrigin());
  const abort = (signal) => { if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError'); };
  async function match(input) {
    if (!eligible(input)) return null;
    try {
      const cache = await storage.open(IMPORTED_ASSET_CACHE);
      return await cache.match(typeof input === 'string' ? input : input.url);
    } catch { return null; } // quota/privacy restrictions must not prevent playing from the server
  }
  async function assetFetch(input, init, fallback = fetcher) {
    const signal = init?.signal ?? input?.signal;
    abort(signal);
    const request = { url: typeof input === 'string' || input instanceof URL ? String(input) : input?.url,
      method: init?.method ?? input?.method ?? 'GET', headers: new Headers(init?.headers ?? input?.headers) };
    const hit = await match(request);
    abort(signal);
    return hit || fallback(input, init);
  }
  async function acquireImportedUrl(input) {
    const original = { url: input, release() {} };
    if (!eligible(input) || !urls?.createObjectURL) return original;
    const key = new URL(input, pageOrigin()).href;
    let entry = blobs.get(key);
    if (!entry) {
      entry = { refs: 0, url: null, promise: null };
      entry.promise = match(key).then(async hit => {
        if (!hit) return null;
        entry.url = urls.createObjectURL(await hit.blob());
        return entry.url;
      }).catch(() => null);
      blobs.set(key, entry);
    }
    entry.refs++;
    const url = await entry.promise;
    if (!url) {
      if (blobs.get(key) === entry) blobs.delete(key);
      return original;
    }
    let released = false;
    return { url, release() {
      if (released) return;
      released = true;
      if (--entry.refs === 0) {
        urls.revokeObjectURL(url);
        if (blobs.get(key) === entry) blobs.delete(key);
      }
    } };
  }
  return { assetFetch, acquireImportedUrl, isImportedAssetUrl: eligible };
}

const loader = createImportedAssetLoader();
export const assetFetch = loader.assetFetch;
export const acquireImportedUrl = loader.acquireImportedUrl;
export const isImportedAssetUrl = loader.isImportedAssetUrl;

/** Load just the requested image, release its encoded blob after the browser has decoded it. */
export async function loadAssetImage(url, { timeoutMs = 20000 } = {}) {
  if (!url || typeof Image === 'undefined') return null;
  const handle = await acquireImportedUrl(url);
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async'; img.crossOrigin = 'anonymous';
    let timer;
    const finish = (value) => {
      clearTimeout(timer); img.onload = null; img.onerror = null;
      handle.release(); resolve(value);
    };
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    timer = setTimeout(() => { img.removeAttribute('src'); finish(null); }, timeoutMs);
    img.src = handle.url;
  });
}
