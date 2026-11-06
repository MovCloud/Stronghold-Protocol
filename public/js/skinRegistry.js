// skinRegistry.js — the skin plugin registry (P6): cosmetic plugins ATTACH skins — a self-upload, a community pack,
// an official extension — to the composed asset manifest's `chars[charId].skins`, where every skin lookup already
// reads (assets.js avatarUrl / portraitUrl / illustUrl / spineEntry, ui/skinAssets.js appearanceEntry, the outfit
// picker ui/skinPicker.js). Unlike a room/personal plugin's overlay (a checked document, shared/plugins/visual.js),
// a skin plugin registers ENTRIES here; this module hangs them onto the cosmetic layers as one synthetic layer
// (cosmetics.setSkins) — composed by the same machinery, broadcast by the same onChange('manifest') — so the picker
// and every art lookup see them without a second composition path.
//
// A registered skin's key is `<pluginId>/<skinId>` (the global key a wearing record, opts.skin, stores). The shape
// cannot collide with an official or overlay-written skin: those keys admit no '/' (shared/plugins/visual.js
// isSkinKey), so one namespace never reaches the other, and the whole key must fit the wire's skin-id cap
// (WIRE_KEY_MAX): it is what `room.skins` carries, and a key the wire refuses is seen by nobody but its own player.
// unregister removes the plugin's entries; a skin being worn
// then resolves to nothing and every lookup falls back to the operator's own art — the same semantics as a cosmetic
// file failing (cosmetics.fail): the stored choice is kept, the look is the default one until the skin returns.
//
// A plugin is accepted WHOLE or not at all (one bad entry rejects every entry of it): what reaches the manifest is
// exactly what was validated, never a half plugin, and a rejected re-register leaves the previous entries standing.
// Every URL must live in the plugin's own bypass space (/p/<id>/<hash8>/…, docs/PLUGINS.md §9) or an imported alias
// (/assets|fonts|media/~<16 hex>/…, resourcePacks.js IMPORTED_PREFIX) — a registry entry can never point at another
// server path. A `kind: 'spine'` entry (the product's dynamic art is Spine skeletal animation — an earlier draft's
// "l2d" label was a misnomer, P6 §3.3) carries `spine: { model, atlas, … }`, both URLs gated like every other one,
// and lands in the manifest as `spine: { front: <manifest spine entry> }` — the same record shape the operator
// detail's dynamic player consumes via assets.js spineEntry / skinHasModel (ui/dynamicIllustration.js), so a
// registered dynamic skin rides the very chain the official ones use; a render failure there degrades to the skin's
// own static slots, then the operator's own art.
//
// Zero main-line change: with nothing registered the synthetic layer is empty and cosmetics.apply returns the base
// manifest itself, as before.
//
// Pure at import time (Node tests import it): the checks take the manifest they validate against, and the page
// singleton only feeds them and syncs the layer.

import { cosmetics } from './cosmetics.js';
import { IMPORTED_PREFIX } from './resourcePacks.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** A plugin id (shared/plugins/manifest.js isPluginId — keep in sync): the /p/<id>/… folder, the key's prefix. */
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
/**
 * A registry skinId: the character class of a skin key (shared/plugins/visual.js SKIN_KEY — keep in sync), which
 * already admits no '/', so `<pluginId>/<skinId>` keeps exactly one separator. Its usable length is the wire cap
 * below minus the plugin id and the separator.
 */
const SKIN_ID = /^[A-Za-z0-9_][A-Za-z0-9_@#+.-]{0,63}$/;
/**
 * The wire's own skin-id cap (shared/protocol.js SKIN_LIMITS.idLen): the global key is what travels in `room.skins`,
 * so pluginId + '/' + skinId must fit inside it. A longer skinId would register here and then be refused on the
 * wire, leaving its player the only one who could ever see the skin.
 */
const WIRE_KEY_MAX = 64;
/** The picture slots of a skin record (docs/SKINS.md) — the names the lookups read, never a new field name. */
const SLOTS = ['avatar', 'avatarE2', 'portrait', 'portraitE2', 'illust'];
/** At most this many skins one plugin registers (the wire's own skin-selection cap, shared/protocol.js SKIN_LIMITS). */
const REGISTRY_LIMIT = 256;
/** A skin's name length (shared/plugins/visual.js TEXT_MAX — keep in sync). */
const TEXT_MAX = 64;
/** A spine entry's optional extras, capped like every bounded list of the manifest (shared/plugins/manifest.js). */
const SPINE_TEXTURES_MAX = 16;
const SPINE_ANIMS_MAX = 64;

/** Where a registered skin's URL may live: the plugin bypass space or an imported alias — never another path. */
const okUrl = (u) => typeof u === 'string' && (u.startsWith('/p/') || IMPORTED_PREFIX.test(u));

/** The key a wearing record stores: `<pluginId>/<skinId>`. */
export const globalSkinKey = (pluginId, skinId) => `${pluginId}/${skinId}`;

/**
 * Validate one plugin's skins against the page's manifest — `register`'s gate: every entry must pass, else the whole
 * plugin is refused with every reason collected (a rejection is diagnosed once, in full). Pure.
 * @param {unknown} manifest the page's own manifest view (data.get('assets')): a charId must be one of its chars
 * @param {string} pluginId
 * @param {unknown} skins one payload entry per skin: `{ charId, skinId, kind, displayName?, <slot>?…, spine? }`
 * @returns {{ ok: true, entries: { charId: string, key: string, record: any }[] } | { ok: false, reasons: string[] }}
 */
export function validateSkins(manifest, pluginId, skins) {
  const reasons = [];
  const fail = (why) => { reasons.push(why); };
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) fail(`pluginId ${JSON.stringify(pluginId)} is not a plugin id`);
  if (!Array.isArray(skins)) fail('skins is not a list');
  else if (skins.length > REGISTRY_LIMIT) fail(`more than ${REGISTRY_LIMIT} skins in one plugin`);
  const chars = isObj(manifest) && isObj(manifest.chars) ? manifest.chars : null;
  if (!chars) fail('the page has no art manifest to validate the charIds against');
  if (reasons.length) return { ok: false, reasons };

  const entries = [];
  const seen = new Set();
  for (const [n, raw] of skins.entries()) {
    const at = `skins[${n}]`;
    if (!isObj(raw)) { fail(`${at} is not an object`); continue; }
    const { charId, skinId, kind, displayName, name, spine } = raw;
    if (typeof charId !== 'string' || !has(chars, charId) || !isObj(chars[charId])) {
      fail(`${at}: charId ${JSON.stringify(charId)} is not an operator of this installation's manifest`);
      continue;
    }
    if (typeof skinId !== 'string' || !SKIN_ID.test(skinId) || FORBIDDEN.has(skinId)) {
      fail(`${at}: skinId ${JSON.stringify(skinId)} is not a skin key`);
      continue;
    }
    const key = globalSkinKey(pluginId, skinId);
    if (key.length > WIRE_KEY_MAX) {
      fail(`${at}: skinId ${skinId} makes the global key ${key.length} characters, over the wire's ${WIRE_KEY_MAX} cap`);
      continue;
    }
    if (seen.has(key)) { fail(`${at}: skinId ${skinId} is registered twice`); continue; }
    if (kind !== 'static' && kind !== 'spine') {
      fail(`${at}: kind ${JSON.stringify(kind)} is neither "static" nor "spine"`);
      continue;
    }
    if (kind === 'spine' && !isObj(spine)) {
      fail(`${at}: a spine skin needs a spine payload ({ model, atlas })`);
      continue;
    }
    if (kind === 'spine' && (!okUrl(spine.model) || !/\.skel$/.test(spine.model))) {
      fail(`${at}: a spine skin needs a skeleton URL of the plugin space (/p/…) or an imported alias, ending in .skel`);
      continue;
    }
    if (kind === 'spine' && (!okUrl(spine.atlas) || !/\.atlas$/.test(spine.atlas))) {
      fail(`${at}: a spine skin needs an atlas URL of the plugin space (/p/…) or an imported alias, ending in .atlas`);
      continue;
    }
    // the name: the payload's displayName, or the manifest's own `name`, or the skinId — never outside the record's
    // text cap
    const text = typeof displayName === 'string' ? displayName : (typeof name === 'string' ? name : skinId);
    if ([...text].length < 1 || [...text].length > TEXT_MAX) {
      fail(`${at}: the name is not a text of 1–${TEXT_MAX} characters`);
      continue;
    }
    // the picture slots: each one present must live where a plugin's files live; the record keeps the manifest's own
    // field names and nothing else — a field outside the whitelist never reaches the manifest
    const record = { name: text };
    let bad = false;
    for (const slot of SLOTS) {
      if (!has(raw, slot) || raw[slot] === undefined) continue;
      if (!okUrl(raw[slot])) {
        fail(`${at}.${slot}: ${JSON.stringify(raw[slot])} is not a plugin URL (/p/…) or an imported alias`);
        bad = true;
        continue;
      }
      record[slot] = raw[slot];
    }
    if (bad) continue;
    if (kind === 'spine') {
      // the manifest spine entry the dynamic chain consumes (assets.js validSpine: skel/atlas/anims; the atlas pages
      // come from `textures` or the <skel>.png convention; `bounds` is the player's stage rect, missing → the
      // player's own fallback to the static slots). The extras are optional, validated, capped; nothing else passes.
      const front = { skel: spine.model, atlas: spine.atlas, anims: {} };
      const textures = spine.textures;
      if (textures !== undefined) {
        if (!Array.isArray(textures) || textures.length > SPINE_TEXTURES_MAX || !textures.every(okUrl)) {
          fail(`${at}.spine.textures: not a list of at most ${SPINE_TEXTURES_MAX} plugin URLs (/p/…) or imported aliases`);
          continue;
        }
        if (textures.length) front.textures = textures.slice();
      }
      if (spine.pma !== undefined) {
        if (typeof spine.pma !== 'boolean') { fail(`${at}.spine.pma: not a boolean`); continue; }
        front.pma = spine.pma;
      }
      if (spine.anims !== undefined) {
        const a = spine.anims;
        if (!isObj(a) || Object.keys(a).length > SPINE_ANIMS_MAX || !Object.values(a).every((v) => typeof v === 'string')) {
          fail(`${at}.spine.anims: not an object of at most ${SPINE_ANIMS_MAX} names`);
          continue;
        }
        front.anims = { ...a };
      }
      if (spine.bounds !== undefined) {
        const b = spine.bounds;
        if (!isObj(b) || ![b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(b.width > 0 && b.height > 0)) {
          fail(`${at}.spine.bounds: not a stage rect { x, y, width, height } of finite numbers (width/height > 0)`);
          continue;
        }
        front.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      }
      record.spine = { front };
    }
    seen.add(key);
    entries.push({ charId, key, record });
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, entries };
}

/**
 * The registry, pluginId → its validated entries in the order they were given. Module state, reset by `reset()` —
 * the same pattern as resourcePacks.js. @type {Map<string, { charId: string, key: string, record: any }[]>}
 */
const registry = new Map();

const opOf = (e) => ({
  at: ['chars', e.charId, 'skins', e.key],
  value: e.record,
  // the layer's URLs for fail() to find — cosmetics.fail only ever sees documents' URL tables today, so these are
  // never in its failed set; carried anyway so a later per-URL fallback needs no new plumbing
  urls: [
    ...SLOTS.filter((s) => typeof e.record[s] === 'string').map((s) => e.record[s]),
    ...(isObj(e.record.spine) && isObj(e.record.spine.front)
      ? [e.record.spine.front.skel, e.record.spine.front.atlas, ...(Array.isArray(e.record.spine.front.textures) ? e.record.spine.front.textures : [])]
      : []),
  ],
});

/** Rebuild the synthetic layer from the whole registry and hang it onto the cosmetic layers (one broadcast). */
function sync() {
  const ops = [];
  for (const entries of registry.values()) for (const e of entries) ops.push(opOf(e));
  cosmetics.setSkins(ops);
}

/**
 * Register a plugin's skins, whole or not at all. On acceptance the entries replace the plugin's previous ones
 * (an idempotent re-register — the last registration of a pluginId wins) and one change is broadcast; on rejection
 * nothing is written, the previous entries stand and the refusal is reported the same way a cosmetic failure is.
 * @param {string} pluginId
 * @param {unknown} skins
 * @param {{ manifest?: unknown }} [opts] the page's own manifest view (data.get('assets')) to validate against —
 *   without it every charId check fails, so nothing registers by accident
 * @returns {{ ok: true, entries: { charId: string, key: string, record: any }[] } | { ok: false, reasons: string[] }}
 */
export function register(pluginId, skins, opts = {}) {
  const r = validateSkins(opts.manifest, pluginId, skins);
  if (!r.ok) {
    console.warn(`[skinRegistry] ${pluginId} rejected (${r.reasons.length}): ${r.reasons.join('; ')}`);
    return r;
  }
  registry.set(pluginId, r.entries);
  sync();
  return r;
}

/**
 * Unregister a plugin's entries. The global keys removed, in order — a wearing record holding one resolves to
 * nothing and every lookup falls back to the operator's own art (the cosmetic-fail semantics); the record itself is
 * kept, and the skin comes back if the plugin registers it again. An unknown pluginId is a silent no-op.
 * @param {string} pluginId
 * @returns {string[]} the removed global keys
 */
export function unregister(pluginId) {
  const gone = registry.get(pluginId);
  if (!gone) return [];
  registry.delete(pluginId);
  sync();
  return gone.map((e) => e.key);
}

/**
 * Unregister ONE skin of a plugin (the workshop's delete, P6 §3.4): its global key leaves the plugin's entries — a
 * wearing record holding it resolves to nothing and every lookup falls back to the operator's own art (the same
 * semantics as `unregister`, the cosmetic-fail one) — while the plugin's other entries stand; when the last one goes
 * the plugin itself is gone, so a later `unregister(pluginId)` is a no-op. An unknown plugin or skinId is a silent
 * no-op.
 * @param {string} pluginId
 * @param {string} skinId
 * @returns {string | null} the removed global key, or null (nothing was registered under it)
 */
export function unregisterSkin(pluginId, skinId) {
  const entries = registry.get(pluginId);
  if (!entries) return null;
  const key = typeof skinId === 'string' ? globalSkinKey(pluginId, skinId) : null;
  const at = key ? entries.findIndex((e) => e.key === key) : -1;
  if (at < 0) return null;
  const next = entries.slice(0, at).concat(entries.slice(at + 1));
  if (next.length) registry.set(pluginId, next); else registry.delete(pluginId);
  sync();
  return key;
}

/** Drop the whole registry and the synthetic layer (tests). Quiet when nothing was registered. */
export function reset() {
  registry.clear();
  sync();
}
