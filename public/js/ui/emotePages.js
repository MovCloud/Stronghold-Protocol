// emotePages.js — the emote wheel pages a plugin contributes (PLUGIN API v2, docs/PLUGINS.md §10c): the `emotes` part
// is one file = one page (shared/plugins/emoteCatalog.js), and the wheel itself stays in the core
// (public/js/ui/emotes.js) because a plugin has no interface slot for it (shared/plugins/manifest.js UI_SLOT_IDS). All
// this module does is find the page files the cosmetic layers list and read them.
//
// A page is not art, so it is not in the art manifest: the client learns it is there from the visual set's file table
// (shared/plugins/visual.js VisualOverlay.files, path → SHA-256) and fetches it hash-pinned at
// /p/<pluginId>/<hash8>/emotes.json, the same URL form every plugin file gets. A page without plugins lists nothing
// and asks for nothing (test/ui/plugins.e2e.test.js).
//
// shared/plugins/visual.js is deliberately not imported here — the title page carries this at next to no cost
// (cosmetics.js loadVisual). The hash length and the /p/ prefix are locked to visual.js's FILE_URL_DIGITS and
// PLUGIN_FILES_URL by a test, and the file name to PARTS.emotes.name.
//
//   listedPages()        the pages the layers list, in the order the layers apply: [{ pluginId, hash }]
//   emotePages()         the pages already read, in the same order
//   resolveEmotePages    read the listed pages that are not read yet — one request per URL, never asked again
//   subscribeEmotePages  fn() after a page is read (the wheel re-renders)
//   useEmotePages()      the hook the wheel renders with: the pages, refreshed when a layer changes
// A page whose file cannot be read keeps its title: the wheel shows the 表情包组 name where a picture would be
// (public/js/ui/emotes.js EmoteBubble), so a plugin page still says which set it is.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { cosmetics } from '../cosmetics.js';
import { genUrl } from '../gen.js';
import { EMOTE_PAGE_FILE, readEmotePage } from '../../../shared/plugins/emoteCatalog.js';

/** Hash digits of a plugin-file URL. Must equal FILE_URL_DIGITS (shared/plugins/visual.js); a test locks the two. */
const URL_HASH_DIGITS = 8;
/** Must equal PLUGIN_FILES_URL (shared/plugins/visual.js); a test locks the two. */
const PLUGIN_FILES_URL = '/p/';
const HEX64 = /^[0-9a-f]{64}$/;

/** `pluginId/hash` → { hash, page } for a page that has been read; `failed` holds the ones that never came back. */
const read = new Map();
const failed = new Set();
const listeners = new Set();

/**
 * The URL a listed page is served at: /p/<pluginId>/<hash8>/emotes.json (shared/plugins/visual.js pluginFileUrl), in
 * this page's server generation (gen.js). Null for a hash that is not a SHA-256 — an unlisted page is never asked for.
 * @param {string} pluginId @param {string} hash @param {string} [rel]
 */
export function emotePageUrl(pluginId, hash, rel = EMOTE_PAGE_FILE) {
  const h = String(hash || '');
  if (typeof pluginId !== 'string' || !pluginId || !HEX64.test(h)) return null;
  const path = String(rel).split('/').map(encodeURIComponent).join('/');
  return genUrl(`${PLUGIN_FILES_URL}${encodeURIComponent(pluginId)}/${h.slice(0, URL_HASH_DIGITS)}/${path}`);
}

/** The pages the current cosmetic layers list, in the order the layers apply: `[{ pluginId, hash }]`. */
export function listedPages() {
  const layers = [cosmetics.room, ...cosmetics.personal.map((p) => p.doc)];
  const out = [];
  for (const doc of layers) {
    const overlays = doc?.visual?.overlays;
    if (!Array.isArray(overlays)) continue;
    for (const o of overlays) {
      const hash = o?.files?.[EMOTE_PAGE_FILE];
      if (typeof o?.id !== 'string' || !o.id || !HEX64.test(String(hash || ''))) continue;
      out.push({ pluginId: o.id, hash });
    }
  }
  return out;
}

/** The pages that have been read, in the order the layers list them (empty until resolveEmotePages has run). */
export function emotePages() {
  return listedPages().map((l) => read.get(`${l.pluginId}/${l.hash}`)?.page).filter(Boolean);
}

/** An issue list for readEmotePage — shared/plugins/errors.js is not for the client. */
function issueList() {
  const problems = [];
  return { problems, problem: (code, text) => problems.push(`${code}: ${text}`) };
}

/**
 * Read the listed pages that are not read yet: one request per URL, and a URL that failed is never asked again (the
 * page keeps its title, and its pictures fall back to the art beneath them). Resolves with the pages that are there.
 * @param {typeof globalThis.fetch} [fetchImpl]
 */
export async function resolveEmotePages(fetchImpl = globalThis.fetch) {
  const key = (l) => `${l.pluginId}/${l.hash}`;
  const todo = listedPages().filter((l) => !read.has(key(l)) && !failed.has(key(l)));
  let changed = false;
  for (const l of todo) {
    const url = emotePageUrl(l.pluginId, l.hash);
    try {
      const res = await fetchImpl(url);
      if (!res?.ok) { failed.add(key(l)); console.warn(`[emotes] ${url} did not load`); continue; }
      const list = issueList();
      const page = readEmotePage(await res.json(), l.pluginId, list);
      if (!page) { failed.add(key(l)); console.warn(`[emotes] ${url}: ${list.problems.join('; ') || 'not a page'}`); continue; }
      read.set(key(l), { hash: l.hash, page });
      changed = true;
    } catch (err) {
      failed.add(key(l));
      console.warn(`[emotes] ${url} could not be read`, err);
    }
  }
  if (changed) for (const fn of [...listeners]) { try { fn(); } catch (err) { console.warn('[emotes] page listener failed', err); } }
  return emotePages();
}

/** `fn()` after a page is read; returns the unsubscribe. */
export function subscribeEmotePages(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The pages the wheel renders with, refreshed when a layer changes or a page arrives. */
export function useEmotePages() {
  const [pages, setPages] = useState(() => emotePages());
  useEffect(() => {
    const off = [cosmetics.subscribe(() => setPages(emotePages())), subscribeEmotePages(() => setPages(emotePages()))];
    resolveEmotePages();
    return () => off.forEach((f) => f());
  }, []);
  return pages;
}
