// server/skinGate.js — 皮肤管理 (docs/CONTENT-ADMIN.md §9): which skins this server offers.
//
// runtime/skins.json holds the skin ids the admin has stopped offering; everything not in it stays enabled, so no
// file is the same as an empty map. The gate is read once at boot — the panel says a change takes effect after a
// restart — and installed into shared/skins.js, where one judgement covers the four surfaces a stored choice is read
// on: the operator's appearance, the card's portrait, the card's background and the operator picker. The client gets
// the same map at GET /api/skins/gate and applies it to its own localStorage, which is the true source of a player's
// choice (public/js/ui/skins.js); the server's copy is only what teammates see.
//
// A player left with a stopped skin falls back to that operator's default appearance with everything else unchanged.
// The boot pass cleans the persisted sessions — the restart is the moment the gate takes effect, so this is the one
// place the cleanup can run without racing a live client. The player is told at the next login by the client, which
// applies the same gate to its own stored choice (public/js/ui/skins.js): the browser is the true source, so the
// server's copy is only what teammates see until that player's next page load.

import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_DIR, SKINS_FILE, defaultSkins, validateSkins } from './contentConfig.js';
import { getData } from './data.js';
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';
import { setSkinGate, skinDenied, isSkinId } from '../shared/skins.js';
import { t } from '../shared/i18n.js';

/** The panel's row order (§9): the default appearance first (never deniable), then the official table, then the packs. */
export const SKIN_SOURCES = Object.freeze(['default', 'official', 'pack']);
/**
 * The gate's key space is the catalogue's manifest id — the value a stored choice carries and the value
 * shared/skins.js `skinDenied` checks — while `data/skins.json` publishes the official skin id. The panel's tile has to
 * send the former, otherwise a saved row never matches what the client stores and the gate does nothing.
 */
const GATE_ID = new Map(SKIN_CATALOGUE.map((s) => [s.officialId, s.id]));
/**
 * 精一 and 精二 are two tiles of their own, the way the 干员调配 picker draws them, so the two stages read separately.
 * Neither is a skin entry: they carry no id, so the gate can never deny them and the panel cannot take them away (§9).
 */
export const DEFAULT_ROWS = Object.freeze([
  { id: null, name: t('默认外观（精一）'), fixed: true, artKey: 'portrait' },
  { id: null, name: t('默认外观（精二）'), fixed: true, artKey: 'portraitE2' },
]);

/** Read runtime/skins.json. A missing, unreadable or invalid file is the default: everything offered. */
export function readSkinDoc(dir = RUNTIME_DIR) {
  try {
    const raw = fs.readFileSync(path.join(dir, SKINS_FILE), 'utf8');
    const doc = JSON.parse(raw);
    const errors = validateSkins(doc);
    if (errors.length) return { doc: defaultSkins(), raw: undefined, errors };
    return { doc, raw };
  } catch {
    return { doc: defaultSkins(), raw: undefined };
  }
}

/**
 * The pack skins: the entries a loaded cosmetic plugin writes into `chars[charId].skins[skinKey]` (docs/PLUGINS.md §11).
 * The registry's global key `<pluginId>/<skinKey>` is what a stored choice carries for them, so the panel lists that
 * key, not the plugin's own short id. A name or series line of the overlay is read from the same path, and so is the
 * tile art (`portrait`), since a pack skin has no entry in the committed manifest.
 * @param {Iterable<any>} entries the registry's entries (server/plugins/registry.js scanPacks)
 */
export function packSkins(entries = []) {
  const found = new Map();
  for (const p of entries) {
    const ops = p?.visual?.ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      const at = Array.isArray(op?.at) ? op.at.map(String) : [];
      const charId = at[0] === 'chars' ? at[1] : at[1] === 'chars' ? at[2] : '';
      const key = at.includes('skins') ? at[at.indexOf('skins') + 1] : '';
      if (!charId || !key) continue;
      const id = `${p.id}/${key}`;
      if (!found.has(id)) found.set(id, { id, charId, name: '', group: p.manifest?.name ?? p.id });
      const field = at[at.length - 1];
      if (field === 'name') found.get(id).name = String(op.value ?? '');
      else if (field === 'portrait') found.get(id).art = String(op.value ?? '');
    }
  }
  return [...found.values()];
}

/** The operator name the panel shows: the catalogue's, else the chess record's, else the charId itself. */
function charName(charId, data) {
  const known = SKIN_CATALOGUE.find((s) => s.charId === charId)?.charName;
  if (known) return known;
  for (const rec of Object.values(data?.chess ?? {})) {
    if (rec?.charId === charId && rec.name) return rec.name;
  }
  return charId;
}

/**
 * The tile art the panel draws (§9): the manifest's portrait for a skin id, the operator's own art when the row has
 * no id (默认外观) or when the committed manifest has no entry for it — a pack overlay writes into the merged
 * manifest, so its own `art` is the only source for a pack skin.
 */
function skinArt(assets, charId, id, overlay) {
  return (id && assets?.skins?.[id]?.portrait) || overlay || assets?.chars?.[charId]?.portrait || '';
}

/**
 * The panel's 皮肤管理 card (§9): one group per operator, 精一 and 精二 first, then the official skins, then the packs.
 * `fixed` marks the tiles the gate can never deny; `enabled` is what the tile shows highlighted.
 * @param {object} doc the gate document
 * @param {{ data?: any, pack?: any[], catalog?: any[] }} o
 */
export function skinGroups(doc, { data = getData(), pack = [], catalog = SKIN_CATALOGUE } = {}) {
  const disabled = doc?.disabled ?? {};
  const official = data?.skins?.chars ?? {};
  const assets = data?.assets ?? {};
  const byChar = new Map();
  const row = (charId, skin) => {
    const id = skin.source === 'official' ? GATE_ID.get(skin.id) ?? skin.id : skin.id;
    return {
      ...skin,
      id,
      charId,
      source: skin.source ?? 'official',
      art: skinArt(assets, charId, id, skin.art),
      enabled: !(disabled[charId] ?? []).includes(id),
    };
  };
  const defaults = (charId) => DEFAULT_ROWS.map((r) => ({
    ...r, source: 'default', charId, enabled: true,
    art: assets?.chars?.[charId]?.[r.artKey] || assets?.chars?.[charId]?.portrait || '',
  }));
  for (const [charId, skins] of Object.entries(official)) {
    if (!byChar.has(charId)) byChar.set(charId, []);
    for (const s of skins) byChar.get(charId).push(row(charId, { ...s, source: 'official' }));
  }
  for (const s of pack) {
    if (!byChar.has(s.charId)) byChar.set(s.charId, []);
    byChar.get(s.charId).push(row(s.charId, { ...s, source: 'pack' }));
  }
  const groups = [...byChar.entries()]
    .map(([charId, skins]) => ({
      charId,
      charName: charName(charId, data),
      skins: [...defaults(charId), ...skins],
    }))
    .sort((a, b) => a.charName.localeCompare(b.charName, 'zh-Hans'));
  const stats = { chars: groups.length, skins: 0, disabled: 0 };
  for (const g of groups) {
    stats.skins += g.skins.filter((s) => s.source !== 'default').length;
    stats.disabled += g.skins.filter((s) => !s.enabled).length;
  }
  return { revision: doc?.revision ?? 0, groups, stats, catalog: catalog.length };
}

/**
 * Clean one stored choice against the gate. The default appearance is what a denied skin falls back to, so the entry
 * is simply removed; every other field of the card stays as it was (§9). Returns the ids it dropped.
 * @param {Record<string, string>|null} choices the player's map (charId → skin id)
 * @param {string[]} [cardFields] the card's fields that can carry a skin id (portrait, avatar, look, `skin:<id>`)
 */
export function deniedIds(choices, cardFields = []) {
  const dropped = new Set();
  if (choices && typeof choices === 'object') {
    for (const skinId of Object.values(choices)) if (isSkinId(skinId) && skinDenied(skinId)) dropped.add(skinId);
  }
  for (const v of cardFields) {
    const id = typeof v === 'string' && v.startsWith('skin:') ? v.slice(5) : v;
    if (isSkinId(id) && skinDenied(id)) dropped.add(id);
  }
  return dropped;
}

/**
 * The gate as the server reads it: the installed document plus the panel's view. `install()` puts the map into
 * shared/skins.js so the shared cleaners refuse a denied skin; `cleanSession()` is the boot pass.
 * @param {{ dir?: string, log?: any, data?: any, entries?: any[] }} o
 */
export function createSkinGate({ dir = RUNTIME_DIR, data = getData(), entries = [] } = {}) {
  const doc = readSkinDoc(dir).doc;
  setSkinGate(doc.disabled);
  const pack = packSkins(entries);
  return {
    doc,
    disabled: doc.disabled,
    view: () => skinGroups(doc, { data, pack }),
    /** Clean one session's stored choice; returns the skin ids it dropped (null = nothing changed). */
    cleanSession(session) {
      const dropped = deniedIds(session?.skins, [session?.card?.charId, session?.card?.avatar, session?.card?.bg]);
      if (!dropped.size) return null;
      for (const [charId, skinId] of Object.entries(session.skins ?? {})) if (dropped.has(skinId)) delete session.skins[charId];
      for (const key of ['charId', 'avatar', 'bg']) {
        const v = session.card?.[key];
        const id = typeof v === 'string' && v.startsWith('skin:') ? v.slice(5) : v;
        if (dropped.has(id)) session.card[key] = '';
      }
      return dropped;
    },
  };
}
