// Operator appearances are display-only: never replace charId, skill/module data or combat hit timings.
// IDs below are stable manifest keys, not official skin IDs or arbitrary resource URLs.
import { SKIN_CATALOGUE } from './skin-catalogue.js';
export const OPERATOR_SKINS = SKIN_CATALOGUE;
export const SKIN_LIMITS = Object.freeze({ choices: 256 });
const byId = new Map(OPERATOR_SKINS.map(s => [s.id, s]));
const plain = v => !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Resolve an admitted appearance for its actual operator (not a DIY slot or the replaced operator). */
export function skinFor(charId, skinId) {
  const skin = typeof skinId === 'string' ? byId.get(skinId) : null;
  return skin && skin.charId === charId ? skin : null;
}
export const skinsFor = charId => OPERATOR_SKINS.filter(s => s.charId === charId);
export function skinIdFor(choices, charId) {
  return plain(choices) && Object.hasOwn(choices, charId) ? skinFor(charId, choices[charId])?.id ?? null : null;
}

const PLUGIN_SKIN_LIMITS = Object.freeze({ entries: 160, idLen: 64 });
/** A plugin id (public/js/skinRegistry.js `PLUGIN_ID` — keep in sync): the left half of the registry's global key. */
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** A skin key (shared/plugins/visual.js `SKIN_KEY` — keep in sync): it admits no `/`, so a global key keeps exactly one. */
const SKIN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_@#+.\-]{0,63}$/;

/**
 * A skin key of the whitelist, or the skin registry's global key `<pluginId>/<skinId>` (public/js/skinRegistry.js
 * `globalSkinKey`): that one cannot be checked against the catalogue — it names an entry a plugin registered at
 * runtime — so it is accepted on its shape alone, exactly as shared/protocol.js `isSkinId` accepts it. A stored
 * registry choice is kept while the plugin is off and resolves again when it returns, the same semantics as a
 * cosmetic file failing.
 */
const isRegistrySkinKey = (v) => typeof v === 'string' && v.length <= PLUGIN_SKIN_LIMITS.idLen
  && PLUGIN_ID.test(v.split('/')[0]) && SKIN_KEY.test(v.split('/')[1]);

/** Exact whitelist: own charId keys and bound skin IDs only. An empty map restores default appearances. */
export function isSkinChoices(value) {
  return plain(value) && Object.keys(value).length <= SKIN_LIMITS.choices
    && Object.entries(value).every(([charId, skinId]) => !!skinFor(charId, skinId) || isRegistrySkinKey(skinId));
}
export function cleanSkinChoices(value) {
  if (!plain(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([charId, skinId]) => !!skinFor(charId, skinId) || isRegistrySkinKey(skinId)).slice(0, SKIN_LIMITS.choices));
}

// ---- plugin-studio / Forge helpers (docs/SKINS.md: upstream's, kept for import) -------------------------------
// These serve the cosmetic-plugin path (`room.skins { skins }`), which this fork does wire: the skin registry
// (public/js/skinRegistry.js) hangs its entries onto the composed manifest as one synthetic layer, and the keys a
// wearing record stores there are the registry's global keys. They are keyed by base CHESS id, not charId, and are
// retained so the studio and Forge import keep working.

/**
 * A skinId key: carries `@` `#` `+` `.`; kept independent of the catalogue's own skin ids. It also accepts the skin
 * registry's global key — at most one `/`, the whole value inside `idLen` — because that is the value the wire
 * carries (shared/protocol.js `isSkinId`): a key accepted there must survive this gate too, or a teammate's plugin
 * skin would be refused by the viewer's `visibleSkin` and draw the operator's default model.
 */
export const isSkinId = (v) => typeof v === 'string' && v.length > 0
  && v.length <= PLUGIN_SKIN_LIMITS.idLen && (SKIN_KEY.test(v) || isRegistrySkinKey(v));

const isChessId = (v) => typeof v === 'string' && /^[A-Za-z0-9_\-.:]{1,64}$/.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);

/** Bound and clean browser preferences / older checkpoints without trusting their shape (base chess ids). */
export function cleanSkins(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, skin] of Object.entries(raw)) {
    if (!isChessId(id) || !isSkinId(skin)) continue;
    out[id] = skin;
    if (Object.keys(out).length === PLUGIN_SKIN_LIMITS.entries) break;
  }
  return out;
}

/** Choices use base chess ids here; unknown or mismatched ids are dropped and the default model is drawn. */
export function freezeSkins(raw, getChess) {
  const out = {};
  for (const [id, skin] of Object.entries(cleanSkins(raw))) {
    const rec = getChess(id);
    if (!rec || rec.isGolden || rec.visible === false || rec.isHidden || rec.isDiy
        || (rec.baseId && rec.baseId !== id)) continue;
    out[id] = skin;
  }
  return Object.freeze(out);
}

/** A viewer opt-in, not the owner's preference: applies to every player's skin, including spectators. */
export function visibleSkin(skin, settings) {
  return settings?.skinsEnabled === true && isSkinId(skin) ? skin : null;
}
