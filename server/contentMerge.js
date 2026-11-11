// server/contentMerge.js — the wild-mode synthesis (docs/CONTENT-ADMIN.md §5): the sources' data and the selection
// document in, one merged data set out. mergeWild() is pure rules (data in, data out) so the rules can be tested
// without a server; writeWild() is the only IO, and synthesizeWild() is the boot wiring that reads runtime/wild.json.
// Serving the result needs the 'wild' registry entry, which is P3.

import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from '../shared/i18n.js';
import { PICK_AUTO, PICK_OFF, PICK_TYPES, RUNTIME_DIR, WILD_FILE, registryIds, validateWild } from './contentConfig.js';
import { recencyOrder } from './contentCatalog.js';
import { DATA_DIR, VERSION_DATA_FILES, getVersionData } from './data.js';
import { validateReferences } from '../shared/plugins/validate.js';

/** The version the merged set is registered as (P3), and where it is written. */
export const WILD_ID = 'wild';
export const WILD_DIR = path.join(DATA_DIR, 'versions', 'wild');

/** The record maps a selection can decide: unioned by id, each record from the source that owns it. */
const FLAT_MAPS = Object.freeze(['bonds', 'bands', 'items', 'effects', 'garrisons', 'chess', 'enemies', 'waves', 'stages', 'bosses', 'tokens']);
/** Files whose record-map sections are unioned and whose other sections (rule tables) come from the newest source. */
const SECTION_FILES = Object.freeze(['choices', 'factions', 'backups']);
/** Taken whole from the newest source: the rule table is not per-id editable (§5). */
const NEWEST_FILES = Object.freeze(['config']);
/** Sections that look like record maps but are not editable per id. */
const NO_UNION = Object.freeze({ backups: Object.freeze(['diy']) });

/**
 * The reference fields validateReferences checks, so the same edges decide provenance: a record referenced by a
 * selected row comes from that row's source, not from the newest source that happens to hold the same id.
 * Each entry lists the ids a record references and how to drop one when it cannot resolve (§5: no dangling
 * reference may reach a match). `required` has no drop — an unresolvable one is an error, not a silent hole.
 */
const EDGES = {
  bonds: (r) => [
    { target: 'effects', ids: [r.effectId], required: true, drop: (rec, id) => { rec.effectId = null; } },
    { target: 'chess', ids: r.members ?? [], drop: (rec, id) => { rec.members = rec.members.filter((x) => x !== id); } },
  ],
  bands: (r) => [
    { target: 'effects', ids: [r.effectId], required: true, drop: (rec, id) => { rec.effectId = null; } },
    { target: 'bonds', ids: r.bondIds ?? [], drop: (rec, id) => { rec.bondIds = rec.bondIds.filter((x) => x !== id); } },
  ],
  items: (r) => [
    { target: 'effects', ids: [r.effectId], required: true, drop: (rec, id) => { rec.effectId = null; } },
    { target: 'items', ids: [r.goldenId], drop: (rec, id) => { rec.goldenId = null; } },
    { target: 'bonds', ids: [r.giveBondId, r.requiresBondId], drop: (rec, id) => {
      if (rec.giveBondId === id) rec.giveBondId = null;
      if (rec.requiresBondId === id) rec.requiresBondId = null;
    } },
  ],
  chess: (r) => [
    { target: 'chess', ids: [r.baseId, r.goldenId], drop: (rec, id) => {
      if (rec.baseId === id) rec.baseId = null;
      if (rec.goldenId === id) rec.goldenId = null;
    } },
    // A stand-in is looked up by the chess's `backup.charId`, and the form the chess needs is
    // `forms[statusKey(chess.status)]`, so the hand-maintained unit has to come from the same source as the chess
    // record. Provenance only: validateReferences reports the missing form itself, so this edge never drops or errors.
    { target: 'backups.units', ids: [r.backup?.charId], provenanceOnly: true, drop: () => {} },
    { target: 'bonds', ids: r.bonds ?? [], drop: (rec, id) => { rec.bonds = rec.bonds.filter((x) => x !== id); } },
    { target: 'garrisons', ids: r.garrisonIds ?? [], drop: (rec, id) => { rec.garrisonIds = rec.garrisonIds.filter((x) => x !== id); } },
    { target: 'tokens', ids: r.tokens ?? [], drop: (rec, id) => { rec.tokens = rec.tokens.filter((x) => x !== id); } },
  ],
  waves: (r) => [
    { target: 'enemies', ids: (r.spawns ?? []).filter((s) => !s.action).map((s) => s.key),
      drop: (rec, id) => { rec.spawns = rec.spawns.filter((s) => s.action || s.key !== id); } },
    { target: 'enemies', ids: Object.values(r.branches ?? {}).flat().flat().filter((s) => !s.action).map((s) => s.key),
      drop: (rec, id) => { for (const [name, phases] of Object.entries(rec.branches)) rec.branches[name] = phases.map((p) => p.filter((s) => s.action || s.key !== id)); } },
    { target: 'enemies', ids: Object.keys(r.overrides ?? {}), drop: (rec, id) => { delete rec.overrides[id]; } },
  ],
  bosses: (r) => [{ target: 'enemies', ids: [r.enemyKey], required: true, drop: (rec, id) => { rec.enemyKey = null; } }],
  'factions.entries': (r) => [{ target: 'enemies', ids: [r.key, ...(r.N ?? []).map((x) => x.key), ...(r.E ?? []).map((x) => x.key)],
    drop: (rec, id) => { if (rec.key === id) rec.key = null; for (const x of [...(rec.N ?? []), ...(rec.E ?? [])]) if (x.key === id) x.key = null; } }],
  'choices.pools': (r) => [{ target: 'items', alt: 'chess', ids: [...(r.items ?? []), ...(r.weighted ?? []).map((x) => x[0])],
    drop: (rec, id) => { rec.items = (rec.items ?? []).filter((x) => x !== id); rec.weighted = (rec.weighted ?? []).filter((x) => x[0] !== id); } }],
  'config.modes': (r) => [
    { target: 'waves', ids: Object.values(r.rounds ?? {}).map((rd) => rd.template).filter(Boolean),
      drop: (rec, id) => { for (const rd of Object.values(rec.rounds)) if (rd.template === id) rd.template = null; } }],
  'backups.diy': (r) => [{ target: 'bonds', ids: Object.values(r.operators ?? {}).flatMap((o) => o.bonds ?? []),
    drop: (rec, id) => { for (const o of Object.values(rec.operators ?? {})) o.bonds = (o.bonds ?? []).filter((x) => x !== id); } }],
  'backups.units': (r) => [{ target: 'tokens', alt: 'backups.tokens', ids: [r.standIn], required: true,
    drop: (rec, id) => { rec.standIn = null; } }],
};

/** A section is a record map when every value is a record (choices.cards holds arrays, so it is not one). */
function isRecordMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => value[k] && typeof value[k] === 'object' && !Array.isArray(value[k]));
}

/** The record maps this merge can union, as `file` or `file.section` names. */
function unionMaps(sources) {
  const maps = [...FLAT_MAPS];
  for (const file of SECTION_FILES) {
    const sections = new Set();
    for (const data of Object.values(sources)) for (const [key, value] of Object.entries(data[file] ?? {})) if (isRecordMap(value)) sections.add(key);
    for (const key of [...sections].sort()) {
      if (NO_UNION[file]?.includes(key)) continue;
      maps.push(`${file}.${key}`);
    }
  }
  return maps;
}

function sectionOf(data, name) {
  if (!name.includes('.')) return data[name];
  const [file, key] = name.split('.');
  return data[file]?.[key];
}

/** The same section in the merged set. */
function mergedSection(merged, name) {
  if (!name.includes('.')) return merged[name];
  const [file, key] = name.split('.');
  return merged[file]?.[key];
}

/** Whether one store (a source's data, or the merged set) can resolve a reference, including its alternate home. */
function hasRef(store, group, id) {
  return Boolean(mergedSection(store, group.target)?.[id] || (group.alt && mergedSection(store, group.alt)?.[id]));
}

/** A summon lives in `tokens.json` or in `backups.json`'s tokens, never both in the same source, so its home is fixed
 * per id by the newest source that has it — otherwise the union would put one id in both tables. */
const TOKEN_MAPS = new Set(['tokens', 'backups.tokens']);

/** One source's record of an id, read from whichever table a token home names. */
function recordOf(data, name, id) {
  if (TOKEN_MAPS.has(name)) return data.tokens?.[id] ?? data.backups?.tokens?.[id] ?? null;
  return sectionOf(data, name)?.[id] ?? null;
}

/** The base (non-elite) chess record of a charId in one source's data. */
function baseRecord(data, charId) {
  for (const rec of Object.values(data.chess ?? {})) if (rec.charId === charId && rec.chessId === rec.baseId) return rec;
  return null;
}

/**
 * Merge the sources into one data set.
 * @param {object} doc the wild document (sources, picks, operators)
 * @param {(id: string) => object} dataOf the data of one source version
 * @param {{ ids?: readonly string[], log?: any }} o
 * @returns {{ ok: boolean, errors: string[], data?: object, report?: object }}
 */
export function mergeWild(doc, dataOf, { ids = registryIds(), log = console } = {}) {
  const errors = validateWild(doc, ids);
  if (errors.length) return { ok: false, errors };

  const order = recencyOrder(doc.sources, ids);
  const sources = {};
  for (const id of order) sources[id] = dataOf(id);
  for (const id of order) {
    const missing = VERSION_DATA_FILES.filter((f) => !sources[id] || typeof sources[id][f] !== 'object' || Array.isArray(sources[id][f]));
    if (missing.length) return { ok: false, errors: [`${id} ${t('缺少数据文件')} ${missing.map((f) => `${f}.json`).join(', ')}`] };
  }

  const maps = unionMaps(sources);
  const owner = new Map(); // `map:id` -> the source version whose record the merged set uses
  const tokenHome = (id) => order.map((v) => (sources[v].tokens?.[id] ? 'tokens' : sources[v].backups?.tokens?.[id] ? 'backups.tokens' : null)).find(Boolean);
  const mixedHome = new Set(); // summon ids the sources keep in different tables
  for (const id of new Set(order.flatMap((v) => [...Object.keys(sources[v].tokens ?? {}), ...Object.keys(sources[v].backups?.tokens ?? {})]))) {
    if (new Set(order.map((v) => (sources[v].tokens?.[id] ? 'tokens' : sources[v].backups?.tokens?.[id] ? 'backups.tokens' : null)).filter(Boolean)).size > 1) mixedHome.add(id);
  }
  const put = (name, id, src) => {
    if (!id || !recordOf(sources[src], name, id)) return false;
    owner.set(`${name}:${id}`, src);
    return true;
  };

  // 1. The selection decides its own rows first, so provenance can follow it. `off` takes a row out entirely (§4.2),
  //    so the union in step 4 must not put it back.
  const offRows = new Set();
  for (const [type, row] of Object.entries(doc.picks ?? {})) for (const [id, pick] of Object.entries(row ?? {})) if (pick === PICK_OFF) offRows.add(`${type}:${id}`);
  for (const type of PICK_TYPES) {
    for (const [rowId, pick] of Object.entries(doc.picks?.[type] ?? {})) {
      if (pick === PICK_OFF) continue;
      if (pick === PICK_AUTO) put(type, rowId, order.find((v) => sectionOf(sources[v], type)?.[rowId]));
      else put(type, rowId, pick);
    }
  }
  // 2. An operator's main record is always the newest, most complete one (§4.4), and its elite form comes with it —
  //    a group is one source, never base from one version and 进阶 from another (§4.5).
  const charIds = new Set(order.flatMap((v) => Object.values(sources[v].chess ?? {}).filter((r) => r.chessId === r.baseId).map((r) => r.charId)));
  for (const charId of charIds) {
    const src = order.find((v) => baseRecord(sources[v], charId));
    if (!src) continue;
    const base = baseRecord(sources[src], charId);
    put('chess', base.chessId, src);
    if (base.goldenId) put('chess', base.goldenId, src);
  }
  // 3. Provenance: a record referenced by an already-owned record comes from that record's source.
  const queue = [...owner.entries()];
  while (queue.length) {
    const [key, src] = queue.shift();
    const [name, id] = key.split(':');
    const rec = recordOf(sources[src], name, id);
    if (!rec || !EDGES[name]) continue;
    for (const group of EDGES[name](rec)) {
      for (const refId of group.ids) {
        if (!refId || !hasRef(sources[src], group, refId)) continue; // this source does not have it: the union decides
        const home = TOKEN_MAPS.has(group.target) || TOKEN_MAPS.has(group.alt)
          ? tokenHome(refId)
          : (recordOf(sources[src], group.target, refId) ? group.target : group.alt);
        const refKey = `${home}:${refId}`;
        if (!owner.has(refKey)) { owner.set(refKey, src); queue.push([refKey, src]); }
      }
    }
  }
  // 4. Everything left is the newest source that has it. A summon has one home per id, so it is filled once instead of
  //    once per table.
  for (const name of maps) {
    if (TOKEN_MAPS.has(name)) continue;
    const ids0 = new Set(order.flatMap((v) => Object.keys(sectionOf(sources[v], name) ?? {})));
    for (const id of [...ids0].sort()) {
      const key = `${name}:${id}`;
      if (owner.has(key) || offRows.has(key)) continue;
      put(name, id, order.find((v) => recordOf(sources[v], name, id)));
    }
  }
  const summons = new Set(order.flatMap((v) => [...Object.keys(sources[v].tokens ?? {}), ...Object.keys(sources[v].backups?.tokens ?? {})]));
  for (const id of [...summons].sort()) {
    const home = tokenHome(id);
    if (!home || owner.has(`${home}:${id}`)) continue;
    put(home, id, order.find((v) => recordOf(sources[v], home, id)));
  }

  // 5. Copy the records the owners picked.
  const merged = {};
  const targetOf = (name) => {
    if (!name.includes('.')) return (merged[name] ??= {});
    const [file, key] = name.split('.');
    return ((merged[file] ??= {})[key] ??= {});
  };
  for (const name of maps) targetOf(name);
  for (const [key, src] of owner) {
    const name = key.slice(0, key.indexOf(':'));
    const id = key.slice(key.indexOf(':') + 1);
    targetOf(name)[id] = structuredClone(recordOf(sources[src], name, id));
  }
  for (const file of NEWEST_FILES) merged[file] = structuredClone(sources[order[0]][file] ?? {});
  // The merged set is a version of its own (§5): the rule table comes from the newest source, then carries the wild
  // stamp. Wild has no rules of its own, so `rules` stays empty.
  merged.config.version = { id: WILD_ID, family: 'covenant', rules: {} };
  for (const file of SECTION_FILES) {
    merged[file] ??= {};
    for (const [key, value] of Object.entries(sources[order[0]][file] ?? {})) {
      if (!isRecordMap(value) || NO_UNION[file]?.includes(key)) merged[file][key] = structuredClone(value);
    }
  }
  // 5b. A hand-maintained unit is one record per charId, but the form a chess record needs is `forms[statusKey(status)]`
  //     and the sources define different forms for the same charId. Union the forms (and the module names they are
  //     checked against) so every source's chess record still resolves its own form.
  for (const charId of new Set(order.flatMap((v) => Object.keys(sources[v].backups?.units ?? {})))) {
    const rec = merged.backups?.units?.[charId];
    if (!rec) continue;
    for (const v of order) {
      if (v === owner.get(`backups.units:${charId}`)) continue;
      const u = sources[v].backups?.units?.[charId];
      if (!u) continue;
      for (const [key, form] of Object.entries(u.forms ?? {})) if (!(rec.forms ??= {})[key]) rec.forms[key] = structuredClone(form);
      for (const [key, name] of Object.entries(u.moduleNames ?? {})) if (!(rec.moduleNames ??= {})[key]) rec.moduleNames[key] = structuredClone(name);
    }
  }

  // 6. The operator matrix: the union of the checked cells, minus the ones the panel turned off (§4.4).
  const off = new Set();
  for (const row of Object.values(doc.operators ?? {})) for (const cell of row?.off ?? []) off.add(cell);
  for (const [charId, rec] of Object.entries(merged.chess ?? {})) {
    if (rec.chessId !== rec.baseId) continue;
    const bonds = new Set();
    for (const v of order) for (const b of baseRecord(sources[v], charId)?.bonds ?? []) if (!off.has(`${v}:${b}`)) bonds.add(b);
    rec.bonds = [...bonds].sort();
  }

  // 7. No dangling reference reaches a match: drop what can be dropped and count it, refuse on the rest (§5).
  //    The rule tables and the hand-maintained file are not unioned, but they still reference unioned rows, so they
  //    are checked too.
  const dropped = [];
  for (const name of [...maps, 'config.modes', 'backups.diy']) {
    const map = mergedSection(merged, name);
    if (!EDGES[name] || !map) continue;
    for (const [id, rec] of Object.entries(map)) {
      for (const group of EDGES[name](rec)) {
        if (group.provenanceOnly) continue; // decides provenance only; validateReferences does not check this edge
        for (const refId of group.ids) {
          if (!refId || hasRef(merged, group, refId)) continue;
          dropped.push({ name, id, target: group.target, refId });
          if (group.required) errors.push(`${name} ${id} ${t('引用解析不到')} ${group.target} ${refId}`);
          else group.drop(rec, refId);
        }
      }
    }
  }

  const referenceErrors = validateReferences(merged);
  // A summon id the sources keep in different tables is two different game objects with the same id (a chess-granted
  // summon in act1, a stand-in token in act2). validateReferences allows one home, so report the conflict once per id
  // instead of every reference that cannot resolve.
  const conflictIds = new Set();
  const kept = [];
  for (const e of referenceErrors) {
    const id = e.match(/token_[0-9][0-9a-z_]*/)?.[0];
    if (id && mixedHome.has(id)) conflictIds.add(id);
    else kept.push(e);
  }
  for (const id of [...conflictIds].sort()) {
    const homes = [...new Set(order.map((v) => (sources[v].tokens?.[id] ? 'tokens.json' : sources[v].backups?.tokens?.[id] ? 'backups.json' : null)).filter(Boolean))];
    errors.push(`tokens ${id} ${t('在不同来源里属于不同的表')}: ${homes.join(' / ')}`);
  }
  errors.push(...kept);
  if (errors.length) return { ok: false, errors, dropped, data: merged, report: null };

  const report = { sources: order, dropped: dropped.length, bySource: {}, rows: {} };
  for (const name of maps) {
    report.rows[name] = Object.keys(mergedSection(merged, name) ?? {}).length;
    for (const [key, src] of owner) {
      if (!key.startsWith(`${name}:`)) continue;
      report.bySource[src] = (report.bySource[src] ?? 0) + 1;
    }
  }
  return { ok: true, errors: [], data: merged, report, dropped };
}

/** Write the merged set to data/versions/wild/ (the generated-data rule: only a generator writes there). */
export async function writeWild(data, dir = WILD_DIR, { log = console } = {}) {
  await fs.mkdir(dir, { recursive: true });
  for (const [key, value] of Object.entries(data)) await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(value));
  log.info(`[content] wild ${Object.keys(data).length} files -> ${dir}`);
  return dir;
}

/** Boot synthesis (docs/CONTENT-ADMIN.md §5): runtime/wild.json in, data/versions/wild/ out. No document means no wild
 * set; an unresolvable reference is reported and the caller refuses to start rather than serve half a data set. */
export async function synthesizeWild({ dir = RUNTIME_DIR, ids = registryIds(), log = console, dataOf = (id) => getVersionData(id, { log }) } = {}) {
  let doc = null;
  try {
    doc = JSON.parse(await fs.readFile(path.join(dir, WILD_FILE), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return { ok: false, errors: [`${WILD_FILE} ${t('无法读取')}: ${e.message}`] };
  }
  const result = mergeWild(doc, dataOf, { ids, log });
  if (!result.ok) return result;
  await writeWild(result.data, WILD_DIR, { log });
  return result;
}
