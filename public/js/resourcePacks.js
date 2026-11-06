// resourcePacks.js — the resource-pack manager: one kv state table the loaders consult BEFORE spending requests.
//
// resolve(url) is the single downstream question — "does this resource exist, and where do I get it?" — answered
// synchronously from learned state; it never rewrites the URL (the service worker and both Cache Storages key on
// URLs, so a rewritten path would break their contract). Sources, in the order resolve weighs them:
//   * imported — `/assets|fonts|media/~<16 hex>/…` bytes an asset-pack import stored under that exact URL
//     ([ASSUMED] same prefix set as public/sw.js IMPORTED_ASSET_PATH — keep the two regexes in sync);
//   * pack — a pack root's learned state: the first path segment under /assets/ (`/assets/spine`, `/assets/char`, …)
//     or `/fonts` itself. State starts 'unknown': loads run normally, but silently — fetch() reports no HTTP status
//     to the console (an <img> 404 does), so a bare local install without the packs fails without a console flood.
//     `markPackMissing` records a proven absence (one warning per root, page lifetime); loads of that root are
//     skipped with no request at all. A finished import (assetPack.js) flips its roots to 'ok': installed packs
//     serve immediately — no reload — and the listeners purge remembered failures so views redraw.
//     `markPackRemoved` is the other half of that loop: when the stored bytes are deleted (设置 → 素材存储 → 清理旧版本
//     素材, 清除已导入的素材) the root goes back to 'unknown' — the table no longer claims what it can no longer
//     serve — its one-warning is cleared so a later load can prove it absent again, and the listeners hear the flip
//     so their remembered failures are purged too.
//   * none — everything else (/media/ audio aliases, /p/ plugin files, /data/ manifests): each loader's own business.
//
// Deliberately out of scope here: the static manifests (assets.js), the cosmetic overlays (cosmetics.js +
// shared/plugins/visual.js — their /p/ URLs bypass this table by design), and CSS @font-face in public/fonts/fonts.css
// (CSS cannot consult a JS table; FontFace failures fall back silently — a permanent exemption, not an omission).
//
// Self-contained on purpose (no imports): materialFallback.js re-exports this module's surface, so a dependency back
// would be a cycle. Pure at import time — Node tests import it directly.

const packState = new Map();      // pack root → 'ok' | 'missing'
const packListeners = new Set();  // roots flipped to 'ok' (assets.js purges its failure caches for them)
const packWarned = new Set();     // roots with their one warning

/**
 * Import-cache URLs: `/assets|fonts|media/~<16 hex>/…` (same prefix set as public/sw.js IMPORTED_ASSET_PATH — keep
 * the two regexes in sync). Exported as the one table the skin registry checks against too (public/js/skinRegistry.js):
 * a registered skin's URLs must live in the plugin bypass space (/p/…) or an imported alias, and this regex is where
 * "an imported alias" is defined.
 */
export const IMPORTED_PREFIX = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

/** The pack root of a public material URL, or null for anything else (imported /media aliases, blobs…). */
export function packRootOf(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/fonts/')) return '/fonts';
  if (!url.startsWith('/assets/')) return null;
  const seg = url.slice(8).split('/', 1)[0];
  return seg ? `/assets/${seg}` : null;
}

/** 'ok' once the pack installed, 'missing' once proven absent, else 'unknown' (each load decides for itself). */
export function packStateOf(url) {
  const root = packRootOf(url);
  return (root && packState.get(root)) || 'unknown';
}

/**
 * The downstream question: does this resource exist, and where does it come from? Pure lookup — the URL goes back
 * untouched, and an 'unknown' state means "no objection, load it" (the loader's own fallbacks stay in charge).
 */
export function resolve(url, { kind } = {}) {
  void kind;
  if (typeof url !== 'string') return { url, state: 'unknown', source: 'none' };
  if (IMPORTED_PREFIX.test(url)) return { url, state: 'ok', source: 'imported' };
  const root = packRootOf(url);
  if (!root) return { url, state: 'unknown', source: 'none' };
  const state = packState.get(root);
  return { url, state: state || 'unknown', source: state === 'ok' ? 'pack' : 'none' };
}

/**
 * An import finished storing bytes: flip the touched pack roots to 'ok' and tell the listeners. Refs are the
 * stored/borrowed pathnames (or plain roots). Returns the roots that changed.
 */
export function markPackInstalled(refs) {
  const roots = new Set();
  for (const ref of Array.isArray(refs) ? refs : [refs]) {
    const root = packRootOf(ref) || (ref === '/assets' || ref === '/fonts' ? ref : null);
    if (root) roots.add(root);
  }
  const changed = [];
  for (const root of roots) {
    if (packState.get(root) === 'ok') continue;
    packState.set(root, 'ok');
    changed.push(root);
  }
  if (changed.length) {
    for (const listener of [...packListeners]) { try { listener(changed); } catch { /* a cache purge only */ } }
  }
  return changed;
}

/** A load proved its pack absent (the spine gate, a probed file): one warning per root, page lifetime. */
export function markPackMissing(url, detail) {
  const root = packRootOf(url);
  if (!root || packState.get(root) || packWarned.has(root)) return false;
  packWarned.add(root);
  packState.set(root, 'missing');
  console.warn(`[assets] ${root} pack is missing${detail ? ` (${detail})` : ''} — skipping its loads until a pack import installs it; the views keep their fallback art`);
  return true;
}

/**
 * The stored bytes of a pack root are gone (an import prune, 清除已导入的素材): drop what the table learned about it,
 * so the next load decides for itself again. The root returns to 'unknown' rather than 'missing' — nothing proved
 * its absence, the bytes were only withdrawn — and its one-warning goes with it, otherwise `markPackMissing` would
 * refuse to record this root a second time and the page would keep loading a pack that is no longer there. The
 * listeners hear the flip exactly as they hear an install: their remembered failures for these roots are purged, so
 * a view redraws with the art beneath and a later import can serve it without a reload. Refs are the pruned
 * pathnames (or plain roots). Returns the roots that changed.
 */
export function markPackRemoved(refs) {
  const roots = new Set();
  for (const ref of Array.isArray(refs) ? refs : [refs]) {
    const root = packRootOf(ref) || (ref === '/assets' || ref === '/fonts' ? ref : null);
    if (root) roots.add(root);
  }
  const changed = [];
  for (const root of roots) {
    if (!packState.has(root)) continue;
    packState.delete(root);
    packWarned.delete(root);
    changed.push(root);
  }
  if (changed.length) {
    for (const listener of [...packListeners]) { try { listener(changed); } catch { /* a cache purge only */ } }
  }
  return changed;
}

/** Subscribe to pack state flips (an install or a removal): `listener(changedRoots)`; returns the unsubscribe. */
export function onPackInstalled(listener) {
  packListeners.add(listener);
  return () => { packListeners.delete(listener); };
}

/** Clear learned state (tests, and a harness that swaps its asset packs between rounds). */
export function resetPackState() {
  packState.clear();
  packWarned.clear();
}
