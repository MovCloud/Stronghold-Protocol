// Explicit title-screen predownload. Reuse the game's HTTP cache and exact manifest URLs;
// never decode every model/image/audio file into RAM or persist an unverified "complete" flag.
// A URL already stored by a local import (assetPack.js) is marked done and not requested again.
import { mediaUrl } from './media.js';
import { dataUrl } from './dataUrls.js';
import { listImportedPaths } from './assetCache.js';
import { drainMaterialBody } from './materialFallback.js';
import { markPackInstalled } from './resourcePacks.js';

/**
 * Collect only same-origin art files, including all Spine pages and optional local scenes.
 * The served 0.3.0 views are walked as they are: hashed `/assets/~…` and `/fonts/~…` URLs, the extra dub banks
 * (`voiceEn` / `voiceKr` / `voiceNative`), statistics-page art, and local groups such as the 射击台 mesh. A cosmetic
 * plugin's own files are `/p/<id>/<hash8>/…` and are not in these manifests, so they are not queued here. The official
 * battle effects (DESIGN §33) come in their own manifest, /data/local-fx.json, read the same way when the host has them.
 */
export function collectAssetUrls(...manifests) {
  const urls = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (/^\/(?:assets|fonts)\/[^/]/.test(value) && !/[?#\\]/.test(value)) urls.add(mediaUrl(value));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  };
  manifests.forEach(visit);
  // Fetch models/images before audio, so an interrupted download still improves battle visuals.
  return [...urls].sort((a, b) => Number(a.startsWith('/media/')) - Number(b.startsWith('/media/')) || a.localeCompare(b));
}

/**
 * Fork (2026-10-16, the owner's request for players on weak networks; 设置 → 素材下载, ui/assetSection.js): what a
 * download takes. 'all' is the upstream list; 'match' leaves out the operator skins (/assets/skins/, about 1.6 GB, each
 * fetched when it is worn) and the dub banks of the voice languages this player does not hear — the Chinese lines stay,
 * the other dubs fall back to them (voiceLanguage.js), and the native lines only with 本土语言 on.
 * @param {string[]} urls collectAssetUrls() @param {{ tier?: string, voice?: string, native?: boolean }} [selection]
 */
export function selectAssetTier(urls, { tier = 'all', voice = 'cn', native = false } = {}) {
  if (tier !== 'match') return urls;
  const dubs = new Set(['cn', voice, native ? 'native' : null]);
  return urls.filter((url) => { // plain paths, or content-hashed ones (/assets/~<16 hex>/…) when the server indexes them
    if (/^\/assets\/(?:~[0-9a-f]{16}\/)?skins\//.test(url)) return false;
    const dub = /^\/media\/(?:~[0-9a-f]{16}\/)?voice\/([^/]+)\//.exec(url);
    return !dub || dubs.has(dub[1]);
  });
}

/** The material source base (设置 → 素材下载): SP_ASSET_ORIGIN, served at /data/asset-source.json. '' (the default,
 *  a missing/failed config, or an unusable value) keeps this page's own origin — the unchanged behaviour.
 *  `disabled: true` (the operator set SP_ASSET_ORIGIN to an empty value) means this installation offers no download
 *  channel: run() turns that into an error status instead of hammering this page's own origin. */
async function readAssetSource() {
  try {
    const response = await globalThis.fetch('/data/asset-source.json', { cache: 'no-cache' });
    if (!response.ok) { await drainMaterialBody(response); return ''; }
    const doc = await response.json();
    if (doc?.disabled === true) throw Object.assign(new Error('Asset download is disabled'), { status: 'disabled' });
    const origin = doc && typeof doc.origin === 'string' ? doc.origin.trim() : '';
    return /^(?:https?:\/\/|\/)/.test(origin) && !/[\\?#]/.test(origin) ? origin.replace(/\/+$/, '') : '';
  } catch (error) {
    if (error?.status === 'disabled') throw error;
    return '';
  }
}

// A live binding read at settings-render time (ui/assetSection.js): true hides the whole 素材下载 section.
export let ASSET_SOURCE_DISABLED = false;

/** @param {boolean} disabled */
export function setAssetSourceDisabled(disabled) { ASSET_SOURCE_DISABLED = disabled === true; }

/** Read the download-channel switch once at boot (call from main.js beside loadSiteConfig). */
export async function loadAssetSource() {
  try {
    const response = await globalThis.fetch('/data/asset-source.json', { cache: 'no-cache' });
    if (!response.ok) { await drainMaterialBody(response); return { disabled: false }; }
    const doc = await response.json();
    setAssetSourceDisabled(doc?.disabled === true);
    return { disabled: ASSET_SOURCE_DISABLED };
  } catch { return { disabled: false }; }
}

/** A bounded, pausable download queue. A file counts only after its entire body arrives. */
export function createAssetDownload({ fetch: doFetch = (...args) => globalThis.fetch(...args),
  concurrency = 4, timeoutMs = 60000, retries = 2, lookupImported = listImportedPaths } = {}) {
  let state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0 };
  // listed: every file of the manifests; urls: the selected tier of them (start({ tier, … }), selectAssetTier)
  // sourceOrigin: where art is fetched from (readAssetSource), '' for this page's own origin
  let listed = null, urls = null, selection = {}, running = null, controller = null, paused = false, lastNotice = 0, sourceOrigin = '';
  const complete = new Set(), failures = new Map(), listeners = new Set();
  const doneCount = () => (urls ? urls.reduce((n, url) => n + (complete.has(url) ? 1 : 0), 0) : complete.size);
  const emit = (force = false) => {
    if (!force && Date.now() - lastNotice < 100) return;
    lastNotice = Date.now();
    state = { ...state, done: doneCount(), failures: [...failures.values()] };
    for (const listener of listeners) listener(state);
  };

  async function request(url, json = false, optional = false) {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await doFetch(url, { signal: abort.signal, cache: json ? 'no-cache' : 'default' });
        if (optional && response.status === 404) { await drainMaterialBody(response); return null; }
        if (!response.ok || response.status === 206) {
          await drainMaterialBody(response);
          throw Object.assign(new Error('Asset request failed'), { status: response.status });
        }
        // Static hosts sometimes send their HTML fallback with status 200 for missing art.
        if (/text\/html/i.test(response.headers.get('content-type') || '')) {
          await drainMaterialBody(response);
          throw Object.assign(new Error('Unexpected HTML response'), { status: 'html' });
        }
        if (json) return await response.json();
        let size = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              state = { ...state, bytes: state.bytes + value.byteLength };
              emit();
            }
          } finally { reader.releaseLock(); }
        } else {
          size = (await response.arrayBuffer()).byteLength;
          state = { ...state, bytes: state.bytes + size };
        }
        if (!size) throw Object.assign(new Error('Empty asset response'), { status: 'empty' });
        return;
      } catch (error) {
        if (paused) throw error;
        const transient = !error.status || error.status >= 500 || [408, 429].includes(error.status);
        if (!transient || attempt >= retries) throw Object.assign(error, { url });
        // Keep retries bounded and avoid hammering a struggling server.
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        if (paused) throw error;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
      }
    }
  }

  async function run() {
    try {
      if (!listed) {
        state = { ...state, phase: 'preparing', error: null };
        emit(true);
        // Sequential manifest reads keep cancellation simple and never leave a rejected sibling promise.
        // (fork) the manifests of this page's server generation (gen.js)
        const assets = await request(dataUrl('assets.json'), true);
        const local = await request(dataUrl('local-assets.json'), true, true);
        // the official battle effects' files (DESIGN §33): optional, like the local manifest
        const fx = await request(dataUrl('local-fx.json'), true, true);
        if (!assets || typeof assets !== 'object' || Array.isArray(assets)
          || (local !== null && (!local || typeof local !== 'object' || !local.groups))
          || (fx !== null && (!fx || typeof fx !== 'object' || !fx.groups))) throw new Error('Invalid asset manifest');
        const list = collectAssetUrls(assets, local, fx);
        if (!list.length) throw new Error('Empty asset manifest');
        listed = list;
        state = { ...state, localMissing: local === null };
      }
      urls = selectAssetTier(listed, selection);
      state = { ...state, total: urls.length };
      if (paused) return;
      let imported = null;
      try { imported = await lookupImported(); } catch { imported = null; }
      if (paused) return;
      let cached = 0;
      if (imported && typeof imported.has === 'function') {
        for (const url of urls) {
          let path = url;
          try { path = new URL(url, 'http://localhost').pathname; } catch { /* keep the queue string */ }
          if (imported.has(url) || imported.has(path)) {
            cached++;
            complete.add(url);
          }
        }
      }
      state = { ...state, cached };
      if (paused) return;
      // Re-read each run (the settings' 重新检查): where art comes from, '' for this page's own origin.
      sourceOrigin = await readAssetSource();
      if (paused) return;
      state = { ...state, phase: 'downloading' };
      failures.clear();
      emit(true);
      const queue = urls.filter((url) => !complete.has(url));
      let next = 0;
      const worker = async () => {
        while (!paused && next < queue.length) {
          const url = queue[next++];
          try {
            // The queue and its keys stay the manifest (play) URLs; only the fetch target takes the configured source.
            await request(sourceOrigin ? sourceOrigin + url : url);
            complete.add(url);
            // A file that answered proves its pack root exists (resourcePacks.js): the gate that skipped it before
            // this download is cleared without a page reload. Only the first file of a root notifies, so a whole-pack
            // download costs one listener call per root, not per file; the /media/ audio aliases have no pack root
            // and are skipped by the table by design.
            markPackInstalled(url);
          } catch (error) {
            if (!paused) failures.set(url, { url, status: error.status || 'network' });
          }
          emit();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
      if (!paused) state = { ...state, phase: failures.size ? 'partial' : 'complete' };
    } catch (error) {
      if (!paused) state = { ...state, phase: 'error', error: { url: error.url, status: error.status || 'manifest' } };
    } finally {
      if (paused) state = { ...state, phase: 'paused' };
      emit(true);
    }
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** @param {{ tier?: string, voice?: string, native?: boolean }} [choice] what to take (selectAssetTier) */
    start(choice) {
      if (running) return running;
      paused = false;
      controller = new AbortController();
      if (choice) selection = { ...choice };
      // A new check after completion revalidates the manifest and all files through the HTTP cache.
      if (state.phase === 'complete') {
        listed = null; urls = null; complete.clear();
        state = { phase: 'idle', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0 };
      }
      running = run().finally(() => { running = null; });
      return running;
    },
    pause() { if (running) { paused = true; controller.abort(); } },
  };
}

export const assetDownload = createAssetDownload();
