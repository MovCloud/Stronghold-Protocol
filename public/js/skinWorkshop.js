// skinWorkshop.js — the local skin workshop (P6 §3.4): one built-in skin plugin, id `local`, whose entries the player
// assembles here in the browser — pick pictures (a portrait, an avatar …), name the skin, choose its operator — and
// that registers through the same gate as every other skin plugin (public/js/skinRegistry.js register; a rejection is
// returned whole, the UI says the reasons). Nothing uploads: the picked files' bytes stay in this browser, in the same
// verified object cache the folder import seeds (public/js/local-import.js OBJECT_CACHE), each file under its own URL
// path — the key both service workers answer (shared/assetCache.js pluginObjectKey; public/sw.js keeps a classic copy
// in sync) — and a skin's URLs live in the plugin bypass space under the built-in id — /p/local/<hash8>/<file>
// (docs/PLUGINS.md §9).
//
// The workshop's document — one record per registered skin: its charId, skinId, name, the slots' URLs and the files
// that back them — is kept like the personal cosmetic plugins' choice (public/js/content.js PERSONAL_PREF): a
// localStorage preference of the `sp.pref.*` path, a key of its own (sp.pref.localSkins). On the next page load
// content.js registers the document again (restoreLocalSkins) once the art manifest is there to check the charIds
// against; the layer's timing rides cosmetics.setSkins' pending handling (cosmetics.js), so it lands correctly whether
// shared/plugins/visual.js is loaded yet or not.
//
// Deleting a skin unregisters its one entry (skinRegistry.unregisterSkin — wearers fall back to the operator's own
// art), updates the document and drops the files' cache entries by their exact keys (a whole-install object cache can
// be too large for Cache.keys(), so the keys are rebuilt from the record's URLs, never listed).
//
// Pure at import time apart from the localStorage read the store seeds itself from (a test installs a storage first);
// no DOM here — the settings section is public/js/ui/skinWorkshop.js.

import { OBJECT_CACHE, digestOf, mimeOf } from './local-import.js';
import { pluginObjectKey } from '../../shared/assetCache.js';
import { createStore, loadPref, savePref } from './store.js';
import { globalSkinKey, register } from './skinRegistry.js';
import { t } from '../../shared/i18n.js';

/** The built-in local skin plugin's id: the /p/local/… folder, the global keys' prefix. */
export const LOCAL_PLUGIN_ID = 'local';
/** The localStorage preference of the workshop's document (sp.pref.localSkins), beside sp.pref.cosmetics. */
export const LOCAL_SKIN_PREF = 'localSkins';
/** The picture slots a static skin carries (public/js/skinRegistry.js SLOTS — keep in sync). */
export const SKIN_SLOTS = ['avatar', 'avatarE2', 'portrait', 'portraitE2', 'illust'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const IMG_EXT = /\.(png|jpe?g|webp)$/i;

/**
 * The atlas page image names of a Spine `.atlas` text (libgdx format: each page section opens with the image file
 * name on its own line — the first one may sit at the very top of the file, the rest follow a blank line). Deduped,
 * in file order; an unreadable text yields none (the pairing then falls back to the `<skel>.png` convention).
 * @param {unknown} text
 * @returns {string[]}
 */
export function atlasPageNames(text) {
  const out = [];
  let blank = true; // the file's top counts as after-a-blank: the first page may open the file
  for (const rawLine of String(text ?? '').split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) { blank = true; continue; }
    if (blank && IMG_EXT.test(line) && !out.includes(line)) out.push(line);
    blank = false;
  }
  return out;
}

/**
 * Pair the picked files into ONE Spine group — skeleton + atlas + the atlas's page images (the workshop keeps one
 * dynamic set per skin; the names are the safe file names the store will use). The atlas text names its pages, so
 * the pages are matched by name against the picked images; an atlas that names none falls back to the loader's own
 * `<skel>.png` convention (assets.js atlasPages). Anything short of a complete group refuses with the reason the
 * form can say.
 * @param {{ name: string, text?: string | null }[]} entries the picked files, by their safe names (an .atlas entry
 *   carries its text)
 * @returns {{ ok: true, skel: string, atlas: string, pages: string[] } | { ok: false, reason: string }}
 */
export function pairSpineGroup(entries) {
  const items = (Array.isArray(entries) ? entries : []).filter((e) => isObj(e) && typeof e.name === 'string' && e.name);
  const skels = items.filter((e) => /\.skel$/i.test(e.name));
  if (skels.length !== 1) return { ok: false, reason: skels.length ? t('拾取了 {n} 个 .skel，一次只上传一套骨骼', { n: skels.length }) : t('缺少 .skel 骨骼文件') };
  const atlases = items.filter((e) => /\.atlas$/i.test(e.name));
  if (atlases.length !== 1) return { ok: false, reason: atlases.length ? t('拾取了 {n} 个 .atlas，一次只上传一套图集', { n: atlases.length }) : t('缺少 .atlas 图集文件') };
  const base = skels[0].name.replace(/\.skel$/i, '');
  if (atlases[0].name.replace(/\.atlas$/i, '') !== base) return { ok: false, reason: t('图集与骨骼不同名（应为 <骨骼名>.atlas）') };
  const byName = new Map(items.map((e) => [e.name, e]));
  const named = atlasPageNames(atlases[0].text);
  if (named.length) {
    // every page the atlas names must be among the picked files — a missing one would 404 the loader mid-parse
    const missing = named.filter((p) => !byName.has(p));
    if (missing.length) return { ok: false, reason: t('缺少图集页图：{0}', { 0: missing.join('、') }) };
    return { ok: true, skel: skels[0].name, atlas: atlases[0].name, pages: named };
  }
  const fallback = `${base}.png`;
  if (!byName.has(fallback)) return { ok: false, reason: t('图集未标出可用的页图，且缺少同名页图 {fallback}', { fallback }) };
  return { ok: true, skel: skels[0].name, atlas: atlases[0].name, pages: [fallback] };
}

/**
 * The persisted document as this page accepts it: one record per skin — its skinId, charId, name, the slots it fills
 * (each a string), an optional Spine group (`spine: { model, atlas, textures? }` — the register payload itself) and
 * the files that back it — anything else is dropped, so a truncated or hand-edited preference registers nothing
 * strange. `files` keeps what deleting needs (each file's exact cache key is rebuilt from its url).
 * @param {unknown} v
 * @returns {{ skinId: string, charId: string, displayName: string, slots: Record<string, string>,
 *   spine?: { model: string, atlas: string, textures?: string[] },
 *   files: { slot: string | null, url: string, name: string, sha256: string, bytes: number }[] }[]}
 */
export function sanitizeDocSkins(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    if (!isObj(raw) || typeof raw.skinId !== 'string' || !raw.skinId || typeof raw.charId !== 'string' || !raw.charId) continue;
    const slots = {};
    if (isObj(raw.slots)) for (const slot of SKIN_SLOTS) if (typeof raw.slots[slot] === 'string' && raw.slots[slot]) slots[slot] = raw.slots[slot];
    const files = Array.isArray(raw.files) ? raw.files.filter((f) => isObj(f) && typeof f.url === 'string' && typeof f.sha256 === 'string') : [];
    let spine;
    if (isObj(raw.spine) && typeof raw.spine.model === 'string' && /\.skel$/.test(raw.spine.model)
      && typeof raw.spine.atlas === 'string' && /\.atlas$/.test(raw.spine.atlas)) {
      spine = { model: raw.spine.model, atlas: raw.spine.atlas };
      const textures = Array.isArray(raw.spine.textures) ? raw.spine.textures.filter((u) => typeof u === 'string' && u) : [];
      if (textures.length) spine.textures = textures;
    }
    out.push({
      skinId: raw.skinId,
      charId: raw.charId,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : raw.skinId,
      slots,
      files,
      ...(spine ? { spine } : {}),
    });
  }
  return out;
}

/** The workshop's document as this page has it (the UI list reads it; content.js registers it on load). */
export const localSkins = createStore({ skins: sanitizeDocSkins(loadPref(LOCAL_SKIN_PREF, [])) });
localSkins.subscribe((s) => savePref(LOCAL_SKIN_PREF, s.skins));

/**
 * A file name as it may sit in the bypass URL's last segment: its own base name, nothing outside letters, digits,
 * `_.-`, at most 64 characters — never empty (an unusable name becomes `skin.png`; the URL's identity is the hash,
 * the name only carries the extension to the picture decoder).
 * @param {unknown} name
 * @returns {string}
 */
export function safeFileName(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/_{2,}/g, '_').slice(-64).replace(/^[_.]+/, '');
  return clean || 'skin.png';
}

/**
 * The slot a picked picture fills, guessed from its file name (the form's own select can override): the keyword
 * picks the base slot, an `e2` marks the elite-2 variant; a name that names nothing is an illustration — the slot a
 * skin is about.
 * @param {unknown} name
 * @returns {typeof SKIN_SLOTS[number]}
 */
export function inferSlot(name) {
  const s = String(name ?? '').toLowerCase();
  const base = s.includes('avatar') || s.includes('头像') ? 'avatar'
    : s.includes('portrait') || s.includes('半身') ? 'portrait'
      : s.includes('illust') || s.includes('立绘') || s.includes('full') ? 'illust' : 'illust';
  const e2 = /(^|[^a-z0-9])e2([^a-z0-9]|$)/.test(s) || s.includes('精二') || s.includes('精英二');
  if (e2 && base === 'avatar') return 'avatarE2';
  if (e2 && base === 'portrait') return 'portraitE2';
  return base;
}

/** A skin file's URL in the plugin bypass space under the built-in local id: /p/local/<first 8 hex of its sha-256>/<name>. */
export const localSkinUrl = (sha256, name) => `/p/${LOCAL_PLUGIN_ID}/${String(sha256).slice(0, 8)}/${name}`;

/**
 * Read the picked files, hash their bytes and write each one into the verified object cache — the same cache and the
 * same Response form public/js/local-import.js importResources uses, under the file's own /p/local/ URL path, the key
 * both service workers answer (shared/assetCache.js pluginObjectKey). One stored entry per file, in the order given.
 *
 * With a Spine `group` ({ skel, atlas, pages } — the pairSpineGroup names), those files are stored as one dynamic
 * set: the pages go under the ATLAS's hash8 folder — the vendored pixi-spine resolves each page next to the atlas
 * URL (`dirname(atlas) + <page name>`), so a page's own hash must not name its URL — and the skeleton/atlas/pages
 * carry no picture slot (slot null), only their spine part.
 * @param {{ arrayBuffer?: Function, name?: string }[]} files the picked File objects
 * @param {{ slots?: (string | null)[], spine?: { skel: string, atlas: string, pages: string[] } | null,
 *   cache?: { put: Function }, digest?: (bytes: ArrayBuffer) => Promise<string>, origin?: string,
 *   open?: (name: string) => Promise<any> }} [opts] `slots[i]` names `files[i]`'s slot (default inferSlot; null =
 *   no slot); `cache`/`open`/`digest`/`origin` stand in for the browser's own (tests)
 * @returns {Promise<{ slot: string | null, url: string, name: string, sha256: string, bytes: number }[]>}
 */
export async function storeSkinFiles(files, { slots = [], spine = null, cache = null, digest = digestOf, origin = globalThis.location?.origin || '', open = null } = {}) {
  if (!Array.isArray(files) || !files.length) return [];
  const objects = cache || await (open ? open(OBJECT_CACHE) : caches.open(OBJECT_CACHE));
  const hashed = [];
  for (const [n, file] of files.entries()) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('a picked skin file could not be read');
    const bytes = await file.arrayBuffer();
    const name = safeFileName(file.name);
    const slot = slots[n] === null ? null : (SKIN_SLOTS.includes(slots[n]) ? slots[n] : inferSlot(name));
    hashed.push({ bytes, name, sha256: await digest(bytes), slot });
  }
  // the atlas's own hash8 names the folder the pages live in (the loader resolves pages beside the atlas URL)
  const group = spine && isObj(spine) ? spine : null;
  const atlasHash8 = group && typeof group.atlas === 'string'
    ? hashed.find((h) => h.name === group.atlas)?.sha256.slice(0, 8) : null;
  const pages = group && Array.isArray(group.pages) ? new Set(group.pages) : null;
  const stored = [];
  for (const h of hashed) {
    const page = pages && pages.has(h.name);
    const url = atlasHash8 && page ? `/p/${LOCAL_PLUGIN_ID}/${atlasHash8}/${h.name}` : localSkinUrl(h.sha256, h.name);
    const slot = group && (h.name === group.skel || h.name === group.atlas || page) ? null : h.slot;
    // the exact key the service workers answer (shared/assetCache.js pluginObjectKey — the URL's own path)
    await objects.put(pluginObjectKey(url, origin), new Response(h.bytes, { status: 200, headers: { 'content-type': mimeOf(url) } }));
    stored.push({ slot, url, name: h.name, sha256: h.sha256, bytes: h.bytes.byteLength });
  }
  return stored;
}

/**
 * The register payload's spine part from a pairing and the stored entries (matched by their safe file names): the
 * skeleton and atlas URLs plus the page URLs the loader resolves beside the atlas. Null when a part is missing
 * (the form refuses the submission instead).
 * @param {{ skel: string, atlas: string, pages: string[] }} group
 * @param {{ url: string, name: string }[]} stored
 * @returns {{ model: string, atlas: string, textures: string[] } | null}
 */
export function spinePayloadOf(group, stored) {
  const byName = new Map((Array.isArray(stored) ? stored : []).map((s) => [s.name, s.url]));
  const model = byName.get(group?.skel);
  const atlas = byName.get(group?.atlas);
  if (!model || !atlas) return null;
  const textures = (Array.isArray(group.pages) ? group.pages : []).map((n) => byName.get(n)).filter((u) => typeof u === 'string');
  return { model, atlas, textures };
}

/**
 * The register payload of one skin from its stored files: the first file of each slot fills it (two files mapped to
 * one slot keep the first), the record carries exactly the field names a manifest skin record has (public/js/
 * skinRegistry.js keeps the whitelist; anything else is dropped there). A `spine` part (spinePayloadOf) makes it a
 * dynamic skin: kind spine, the payload's own spine block.
 * @param {{ charId: string, skinId: string, displayName?: string, spine?: { model: string, atlas: string,
 *   textures?: string[] } | null }} spec
 * @param {{ slot: string | null, url: string }[]} stored
 */
export function buildSkinEntry({ charId, skinId, displayName, spine }, stored) {
  const entry = { charId, skinId, kind: spine ? 'spine' : 'static' };
  if (typeof displayName === 'string' && displayName) entry.displayName = displayName;
  for (const { slot, url } of stored) if (SKIN_SLOTS.includes(slot) && !entry[slot]) entry[slot] = url;
  if (spine) entry.spine = spine;
  return entry;
}

/** The document record of a registered skin: the payload's identity plus its files, for the list and the delete. */
export function docEntryOf({ charId, skinId, displayName, spine }, stored) {
  return {
    skinId,
    charId,
    displayName: typeof displayName === 'string' && displayName ? displayName : skinId,
    slots: stored.reduce((acc, { slot, url }) => (SKIN_SLOTS.includes(slot) && !acc[slot] ? { ...acc, [slot]: url } : acc), {}),
    files: stored.map(({ slot, url, name, sha256, bytes }) => ({ slot, url, name, sha256, bytes })),
    ...(spine ? { spine } : {}),
  };
}

/** The register payload of a whole document (restoreLocalSkins): static skins fill their slots, dynamic ones carry
 * their spine block (kind spine — the registry's gate then checks the model/atlas URLs). */
export const docToPayload = (skins) => (Array.isArray(skins) ? skins : [])
  .map(({ charId, skinId, displayName, slots, spine }) => ({
    charId, skinId, kind: spine ? 'spine' : 'static',
    ...(typeof displayName === 'string' && displayName ? { displayName } : {}),
    ...(isObj(slots) ? slots : {}),
    ...(isObj(spine) ? { spine } : {}),
  }));

/** The document with one skin added (or replaced — a re-registered skinId wins, like the registry's own). Pure. */
export const addDocSkin = (skins, rec) => [...(Array.isArray(skins) ? skins : []).filter((s) => s?.skinId !== rec.skinId), rec];

/** The document without one skin (pure). */
export const removeDocSkin = (skins, skinId) => (Array.isArray(skins) ? skins : []).filter((s) => s?.skinId !== skinId);

/**
 * Delete a record's files from the object cache — by their exact keys, rebuilt from the record's URLs
 * (shared/assetCache.js pluginObjectKey; Cache.keys() can refuse on a whole-install cache). Resolves to how many
 * entries went; storage trouble is swallowed: a leftover byte blob harms nothing, the skin that named it is already
 * gone.
 * @param {{ files?: { url?: string }[] }} rec
 * @param {{ cachesApi?: any, origin?: string, open?: (name: string) => Promise<any> }} [opts]
 * @returns {Promise<number>}
 */
export async function deleteSkinFiles(rec, { cachesApi = globalThis.caches, origin = globalThis.location?.origin || '', open = null } = {}) {
  const files = (Array.isArray(rec?.files) ? rec.files : []).filter((f) => isObj(f) && typeof f.url === 'string');
  if (!files.length) return 0;
  let deleted = 0;
  try {
    const cache = open ? await open(OBJECT_CACHE) : await cachesApi.open(OBJECT_CACHE);
    for (const { url } of files) if (await cache.delete(pluginObjectKey(url, origin))) deleted++;
  } catch { /* no Cache Storage (or quota trouble): the skin is unregistered either way */ }
  return deleted;
}

/**
 * Register the persisted document as the local plugin's skins (content.js calls this once the page's manifest is in;
 * the settings section re-registers the same way after each change). An empty document registers nothing and touches
 * no layer — a page without workshop skins runs exactly the main-line path.
 * @param {{ manifest?: unknown }} [opts] the page's own manifest view (data.get('assets')) to check the charIds against
 * @returns {{ ok: true } | { ok: false, reasons: string[] } | null} null when there was nothing to register
 */
export function restoreLocalSkins({ manifest } = {}) {
  const skins = localSkins.get().skins;
  if (!skins.length) return null;
  return register(LOCAL_PLUGIN_ID, docToPayload(skins), { manifest });
}

/** A skin's global key as a wearing record stores it (`local/<skinId>`). */
export const localSkinKey = (skinId) => globalSkinKey(LOCAL_PLUGIN_ID, skinId);
