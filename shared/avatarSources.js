// shared/avatarSources.js — the avatar source registry (2026-11-08): what a 头像 can be.
//
// An avatar id is either a legacy operator charId (no prefix, so every existing save and the server's card whitelist
// keep working) or `<kind>:<key>`, the same id form as the 名片底图 (public/js/ui/namecards.js):
//   bond:<bondId>  band:<bandId>  enemy:<enemyKey>  camp:<campKey>  loading:<loadingKey>  pack:<packId>/<name>
// `pack` is the reserved form for a later avatar pack (the owner's decision of 2026-11-08 — e.g. the operators' own
// avatar set unpacked from the game): nothing is registered there yet, so a pack id resolves to nothing.
//
// The picture always comes from the art manifest (data/assets.json): bonds and bands are key → path, enemies are
// key → { icon }, the faction emblems and the loading pictures are ui['campLogo/logo_*'] and
// ui['loading/loading_ac_*']. An entry whose file is not in the manifest is not offered at all (the owner's decision:
// no "not installed" state in the picker). Names come from the game data (bonds.json / bands.json / enemies.json) or
// from the tables below; the tables hold msgids, so the caller translates them.
import { N_ } from './i18n.js';

/** The loading pictures (one per simulation difficulty) — the 名片底图's loading cards and the 模拟场景 avatars. */
export const LOADING = [
  { key: 'prototype', name: N_('模拟·原型') },
  { key: 'core', name: N_('模拟·核心') },
  { key: 'hard', name: N_('模拟·险境') },
  { key: 'abyss', name: N_('模拟·终极') },
];

/** The factions with an emblem in the material, each with a tint for the card behind the white emblem. */
export const CAMPS = [
  { key: 'rhodes', name: N_('罗德岛'), tint: '#1f3a4a' },
  { key: 'lungmen', name: N_('龙门'), tint: '#5a2a1c' },
  { key: 'yan', name: N_('炎'), tint: '#6a1f1f' },
  { key: 'higashi', name: N_('东'), tint: '#5c2a3e' },
  { key: 'victoria', name: N_('维多利亚'), tint: '#2a3358' },
  { key: 'kazimierz', name: N_('卡西米尔'), tint: '#4a3b1c' },
  { key: 'laterano', name: N_('拉特兰'), tint: '#5a4c1e' },
  { key: 'leithanien', name: N_('莱塔尼亚'), tint: '#3c2a52' },
  { key: 'columbia', name: N_('哥伦比亚'), tint: '#1f3f58' },
  { key: 'ursus', name: N_('乌萨斯'), tint: '#3a3a3a' },
  { key: 'siracusa', name: N_('叙拉古'), tint: '#4a1e2a' },
  { key: 'iberia', name: N_('伊比利亚'), tint: '#1e3c3c' },
  { key: 'egir', name: N_('阿戈尔'), tint: '#163a4e' },
  { key: 'sargon', name: N_('萨尔贡'), tint: '#5a4418' },
  { key: 'kjerag', name: N_('谢拉格'), tint: '#2c4656' },
  { key: 'sami', name: N_('萨米'), tint: '#24443a' },
  { key: 'minos', name: N_('米诺斯'), tint: '#4e3220' },
  { key: 'bolivar', name: N_('玻利瓦尔'), tint: '#2e4a22' },
  { key: 'rim', name: N_('雷姆必拓'), tint: '#4a3420' },
];

/** kind → { name (msgid), dataKey?, static?, path(manifestRecord, manifest) }. */
const SOURCES = Object.freeze({
  bond: { name: N_('盟约标识'), dataKey: 'bonds', path: (rec) => rec },
  band: { name: N_('策略标识'), dataKey: 'bands', path: (rec) => rec },
  enemy: { name: N_('敌方标识'), dataKey: 'enemies', path: (rec) => rec?.icon },
  camp: { name: N_('阵营徽记'), static: CAMPS, path: (rec, m) => m?.ui?.[`campLogo/logo_${rec.key}`] },
  loading: { name: N_('模拟场景'), static: LOADING, path: (rec, m) => m?.ui?.[`loading/loading_ac_${rec.key}`] },
  pack: { name: N_('头像包'), path: () => null },
});

/** The kinds in lookup order; `operator` is the implicit kind of a bare charId. */
export const AVATAR_KINDS = Object.freeze(['operator', ...Object.keys(SOURCES)]);

/** A source key: plain word characters, at most one segment separator (the pack form), nothing that could read as a path. */
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63})?$/;

const str = (v) => (typeof v === 'string' && v ? v : null);

/** The category name of a kind (a msgid — the caller translates it). */
export const avatarKindName = (kind) => SOURCES[kind]?.name || String(kind);

/**
 * An avatar id as { kind, key }: `<kind>:<key>`, or a bare charId as { kind: 'operator', key }. Null for anything
 * else (empty, too long, an unknown kind, a key that is not a plain key).
 * @param {unknown} id
 */
export function parseAvatarId(id) {
  if (typeof id !== 'string' || !id || id.length > 160) return null;
  const at = id.indexOf(':');
  if (at < 0) return { kind: 'operator', key: id };
  const kind = id.slice(0, at), key = id.slice(at + 1);
  if (!SOURCES[kind] || !KEY.test(key)) return null;
  return { kind, key };
}

/** The picture of an avatar id in the loaded art index, or null (an operator: ui/seatArt.js cardAvatarUrl). */
export function avatarPath(id, m) {
  const p = parseAvatarId(id);
  if (!p || p.kind === 'operator') return null;
  const src = SOURCES[p.kind];
  if (src.static) return src.static.some((e) => e.key === p.key) ? str(src.path({ key: p.key }, m)) : null;
  if (!src.dataKey) return null; // a pack: nothing registered yet
  return str(src.path(m?.[src.dataKey]?.[p.key], m));
}

/**
 * The display name of an avatar id (the game data's name, or the table's msgid — the caller translates it); `fallback`
 * for an operator id, an unknown key or an empty id.
 * @param {unknown} id @param {any} [d] the game data ({ bonds, bands, enemies }) @param {string} [fallback]
 */
export function avatarName(id, d = {}, fallback = '') {
  const p = parseAvatarId(id);
  if (!p || p.kind === 'operator') return fallback;
  const src = SOURCES[p.kind];
  if (src.static) return src.static.find((e) => e.key === p.key)?.name || fallback;
  if (!src.dataKey) return fallback;
  return str(d?.[src.dataKey]?.[p.key]?.name) || fallback;
}

/**
 * Whether an avatar id is accepted: an operator in `knownOperators` (the server's card whitelist), or a well-formed
 * `<kind>:<key>` of a registered kind. Shape only — the picture is resolved from the deployed manifest on the client,
 * so a key the tables do not have is not refused here. Never a URL.
 * @param {unknown} id @param {Set<string>|null|undefined} [knownOperators]
 */
export function isAvatarId(id, knownOperators) {
  const p = parseAvatarId(id);
  if (!p) return false;
  if (p.kind === 'operator') return !!knownOperators?.has?.(p.key);
  return !!SOURCES[p.kind];
}

/**
 * The picker's entries: [{ kind, id, name, src, tint? }] — every source entry whose picture is in the manifest, so an
 * entry with no file is not offered. `operator` entries are not here: the picker keeps its operator list.
 * @param {any} d the game data ({ bonds, bands, enemies }) @param {any} [m] the art manifest
 */
export function avatarEntries(d = {}, m = null) {
  const out = [];
  for (const kind of AVATAR_KINDS) {
    const src = SOURCES[kind];
    if (kind === 'operator') continue;
    if (src.static) {
      for (const e of src.static) {
        const url = str(src.path(e, m));
        if (url) out.push({ kind, id: `${kind}:${e.key}`, name: e.name, src: url, tint: e.tint });
      }
      continue;
    }
    if (!src.dataKey) continue;
    const map = d?.[src.dataKey];
    if (!map || typeof map !== 'object') continue;
    for (const [key, rec] of Object.entries(map)) {
      const url = str(src.path(m?.[src.dataKey]?.[key], m));
      if (url) out.push({ kind, id: `${kind}:${key}`, name: str(rec?.name) || key, src: url });
    }
  }
  return out;
}
