// server/pluginPolicy.js — the admin's runtime enable/disable policy for packs and plugins.
// Files stay on disk and in the image: only delivery is controlled, so a paid content pack can be kept
// installed and switched off at runtime instead of being removed at packaging time (the fork must not hand
// paid content to players — NOTICE.md: the project stays non-commercial).
//
// Semantics (aligned with the arcade drain switch, server/lobby.js): the switch takes effect on the next
// catalogue pull (no-store) and the next file request; bytes already loaded in an open page are not recalled.
//
//   - an entry is delivered only when enabled: the three delivery paths (GET /plugins/index.json,
//     GET /packs/index.json, /p/… via registry pluginFile/servable) see policy.view() — a disabled entry is a
//     shallow copy { status: 'disabled', disabled: { code: 'admin' }, supported: false } (the scan cache is
//     never polluted, so a toggle works without a rescan; shared/plugins/manifest.js pluginIndexEntry already
//     carries `disabled`, the script/trusted owner gate at server/plugins/trusted.js is the precedent);
//   - a paid entry that is disabled is filtered out of the delivered catalogues entirely — the client never
//     learns it exists; the admin panel reads the raw entries plus this policy, so it can still see and
//     re-enable them;
//   - paid entries default to disabled (deleting state.json falls back safely), every other entry defaults
//     to enabled; an explicit switch wins over the default.
//
// `paid`: the manifest field `paid: true` (a future upstream field, not part of the current format — reading
// it is forward-compatible) plus a server-side list; together they decide what is treated as paid content.

import { isPluginId } from '../shared/plugins/manifest.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @param {{ paid?: string[], state?: Record<string, boolean>, log?: object }} [opts]
 *   paid: plugin ids treated as paid content (the server-side list); state: the persisted explicit switches
 *   (the admin state.json `packs`) — only explicit values, the default comes from the paid flag.
 */
export function createPackPolicy({ paid = [], state = {}, log = noopLog } = {}) {
  const paidIds = new Set(Array.isArray(paid) ? paid.filter(isPluginId) : []);
  /** @type {Map<string, boolean>} explicit switches only (no key = the default) */
  const switches = new Map();
  for (const [id, v] of Object.entries(state && typeof state === 'object' && !Array.isArray(state) ? state : {})) {
    if (isPluginId(id) && typeof v === 'boolean') switches.set(id, v);
  }

  /** Is this entry paid content? manifest `paid` (forward-compatible) or the server-side list. */
  const isPaid = (entry) => !!entry && (entry.manifest?.paid === true || paidIds.has(entry.id));

  /** Is the entry delivered? An explicit switch wins; else paid → disabled, everything else → enabled. */
  const isEnabled = (entry) => {
    if (!entry) return false;
    const v = switches.get(entry.id);
    return v !== undefined ? v : !isPaid(entry);
  };

  /**
   * The entry as the delivery paths see it: the raw entry when enabled; a shallow copy marked disabled when
   * not (never the scan cache); null for a disabled paid entry (filtered out of the catalogues entirely).
   */
  const view = (entry) => {
    if (!entry || isEnabled(entry)) return entry;
    if (isPaid(entry)) return null;
    return { ...entry, status: 'disabled', disabled: { code: 'admin' }, supported: false };
  };

  /** The admin row: the raw entry plus the policy's view of it (the panel must see a disabled paid pack). */
  const row = (entry) => entry ? {
    id: entry.id, class: entry.class, source: entry.source,
    name: entry.manifest?.name || entry.manifest?.englishName || entry.id,
    paid: isPaid(entry), enabled: isEnabled(entry),
  } : null;

  /** Explicit switches only, sorted — the shape persisted in the admin state.json (`packs`). */
  const snapshot = () => Object.fromEntries([...switches.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  const set = (id, on) => {
    if (!isPluginId(id) || typeof on !== 'boolean') throw new Error('资源包开关参数无效');
    switches.set(id, on);
  };

  return { isPaid, isEnabled, view, row, set, snapshot };
}
