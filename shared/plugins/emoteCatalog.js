// shared/plugins/emoteCatalog.js — the `emotes` part of manifest 2 (PLUGIN API v2, docs/PLUGINS.md §10c): one page of
// the emote wheel that a plugin contributes. Pure data: this module only reads and checks the file, it never runs
// plugin code and never touches the match. The wheel itself stays in the core (public/js/ui/emotes.js) — a plugin has
// no interface slot for it (shared/plugins/manifest.js UI_SLOT_IDS), so a plugin can only contribute a page of data.
//
// One file = one page, which is how the core wheel is built: a 表情包组 occupies exactly one page (shared/constants.js
// EMOTE_THEMES), so a plugin declares one page file of 1–6 emotes (the 3×2 cells of a wheel page). EMOTE_PAGE_LIMIT is
// the number of files a visual set may list, i.e. how many plugin pages a room can show at once.
//
//   { "version": 1, "name": "表情套组：Ciallo", "sortId": 100003,
//     "emotes": [{ "id": "emote_ciallo_murasame", "sortId": 20001, "picId": "pic_ciallo_murasame_battle",
//                  "label": "丛雨 Ciallo" }] }
//
// Ids are namespaced with the plugin id (shared/plugins/dataUtils.js recordId), so a plugin page can never shadow an
// official emote, and the protocol whitelist stays the official 36 plus the `emote_<pluginId>_<slug>` shape. The
// pictures come from the plugin's `assets` part under `ui['emoticon/<pluginId>/<picId>']` — the same container the
// core emotes use — so no art resolution is added here. The client learns which files a plugin has from the visual
// set's file table (shared/plugins/visual.js VisualOverlay.files) and fetches them hash-pinned; when a page's art is
// not there, the wheel shows the page's title instead of a picture.
import { namespace, recordId } from './dataUtils.js';

/** The manifest field of this part (shared/plugins/manifest.js PARTS). */
export const EMOTE_PART = 'emotes';
/** The file name a page must have: the client finds it in the visual set's file table. A test locks this to PARTS.emotes.name. */
export const EMOTE_PAGE_FILE = 'emotes.json';

/** The `version` a page file must have. */
export const EMOTE_PAGE_VERSION = 1;
/** Pages one plugin may declare. Must equal VISUAL_LIMITS.listFiles (shared/plugins/visual.js); a test locks the two. */
export const EMOTE_PAGE_LIMIT = 16;
/** Cells of one wheel page (3×2, public/js/ui/emotes.js EmoteWheel). */
export const EMOTE_PAGE_MAX_EMOTES = 6;
export const EMOTE_PAGE_NAME_MAX = 64;
export const EMOTE_LABEL_MAX = 64;
export const EMOTE_PIC_MAX = 64;
/** Sort keys stay in the same range as the official theme/emote tables. */
export const EMOTE_SORT_MAX = 1000000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** A plugin emote id: `emote_<namespace(pluginId)>_<slug>` (shared/plugins/dataUtils.js recordId). */
export const isPluginEmoteId = (id) => recordId(id, null, 'emote');

/** Art group of a plugin page: the `ui` container key its assets write under (`emoticon/<pluginId>`). */
export const emotePageDir = (pluginId) => `emoticon/${namespace(pluginId)}`;

/** Page id of a plugin page, derived from the plugin id so two plugins can never name the same page. */
export const emotePageId = (pluginId) => `emoticon_x_${namespace(pluginId)}`;

/**
 * Check one page file. `list` is an issue list (shared/plugins/errors.js issueList) or anything with a
 * `problem(code, text, extra)` method — this module never imports errors.js, so the client can call it too.
 * @param {unknown} value the parsed page file
 * @param {string} pluginId
 * @param {{ problem: (code: string, text: string, extra?: Record<string, unknown>) => void }} list
 * @returns {{ pluginId: string, themeId: string, name: string, sortId: number, dir: string,
 *   emotes: { id: string, sortId: number, picId: string, label: string }[] } | null}
 */
export function readEmotePage(value, pluginId, list) {
  if (!isObj(value)) { list.problem('PLUGIN_PART_SHAPE', 'emotes: the page file is not an object', { at: ['emotes'] }); return null; }
  if (value.version !== EMOTE_PAGE_VERSION) { list.problem('PLUGIN_DATA_TYPE', `emotes: version must be ${EMOTE_PAGE_VERSION}`, { at: ['emotes', 'version'] }); return null; }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) { list.problem('PLUGIN_EMPTY', 'emotes: name is empty', { at: ['emotes', 'name'] }); return null; }
  if (name.length > EMOTE_PAGE_NAME_MAX) { list.problem('PLUGIN_DATA_LIMIT', `emotes: name is longer than ${EMOTE_PAGE_NAME_MAX} characters`, { at: ['emotes', 'name'] }); return null; }
  if (!int(value.sortId, 1, EMOTE_SORT_MAX)) { list.problem('PLUGIN_DATA_NUMBER', 'emotes: sortId must be a positive integer', { at: ['emotes', 'sortId'] }); return null; }
  if (!Array.isArray(value.emotes) || !value.emotes.length || value.emotes.length > EMOTE_PAGE_MAX_EMOTES) {
    list.problem('PLUGIN_DATA_LIMIT', `emotes: emotes must be a list of 1–${EMOTE_PAGE_MAX_EMOTES} emotes`, { at: ['emotes', 'emotes'] }); return null;
  }
  const emotes = [];
  const seen = new Set();
  value.emotes.forEach((raw, i) => {
    const at = ['emotes', 'emotes', String(i)];
    if (!isObj(raw)) { list.problem('PLUGIN_DATA_TYPE', `emotes: emotes[${i}] is not an object`, { at }); return; }
    if (!recordId(raw.id, pluginId, 'emote')) {
      list.problem('PLUGIN_RECORD_ID', `emotes: emotes[${i}].id is not emote_${namespace(pluginId)}_<slug>`, { at: [...at, 'id'] }); return;
    }
    if (seen.has(raw.id)) { list.problem('PLUGIN_RECORD_ID', `emotes: emotes[${i}].id is a duplicate`, { at: [...at, 'id'] }); return; }
    if (typeof raw.picId !== 'string' || !raw.picId || raw.picId.length > EMOTE_PIC_MAX || !/^[A-Za-z0-9_]+$/.test(raw.picId)) {
      list.problem('PLUGIN_DATA_PATH', `emotes: emotes[${i}].picId is not a picture name`, { at: [...at, 'picId'] }); return;
    }
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!label || label.length > EMOTE_LABEL_MAX) { list.problem('PLUGIN_DATA_TYPE', `emotes: emotes[${i}].label is empty or too long`, { at: [...at, 'label'] }); return; }
    if (!int(raw.sortId, 1, EMOTE_SORT_MAX)) { list.problem('PLUGIN_DATA_NUMBER', `emotes: emotes[${i}].sortId must be a positive integer`, { at: [...at, 'sortId'] }); return; }
    seen.add(raw.id);
    emotes.push({ id: raw.id, sortId: raw.sortId, picId: raw.picId, label });
  });
  if (!emotes.length) return null;
  return { pluginId, themeId: emotePageId(pluginId), name, sortId: value.sortId, dir: emotePageDir(pluginId), emotes: emotes.sort((a, b) => a.sortId - b.sortId) };
}

/**
 * A wheel page: the core themes (shared/constants.js EMOTE_THEMES) first, then the plugin pages in the order the
 * cosmetic layers apply. `pages` is what every wheel helper reads, so a room without plugins gets the core pages and
 * nothing else.
 * @param {any[]} corePages @param {any[]} pluginPages
 * @returns {any[]}
 */
export function wheelPages(corePages, pluginPages) {
  return [...corePages, ...(Array.isArray(pluginPages) ? pluginPages : [])];
}

/** The page an emote id belongs to, or null (safe for any input, including '__proto__'). */
export function pageOf(pages, id) {
  if (!Array.isArray(pages) || typeof id !== 'string') return null;
  for (const p of pages) {
    if (!p || !Array.isArray(p.emotes)) continue;
    if (p.emotes.some((e) => e && e.id === id)) return p;
  }
  return null;
}
