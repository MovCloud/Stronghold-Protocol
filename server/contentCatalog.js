// server/contentCatalog.js — the rows the 内容管理 panel shows (docs/CONTENT-ADMIN.md §4). A row is one content item
// keyed by its stable id across versions, so the same item in several sources is one row with one entry per source.
// Row identity is (type, id) only — never a content hash: a hash-merged row would let removing one version from the
// wild set drop content another version still provides. The hash stays where it belongs, in the /cs/<cs16>/ addressing.

import { PICK_AUTO, PICK_OFF, PICK_TYPES, registryIds } from './contentConfig.js';
import { getVersionData } from './data.js';

/** What one version's record contributes to a row. `name`/`desc` is what the expanded row shows (§4.2). */
const TABLES = {
  bonds: { source: 'bonds', idOf: (rec, key) => rec.bondId ?? key, entry: (rec) => ({ name: rec.name, desc: rec.desc }) },
  bands: { source: 'bands', idOf: (rec, key) => rec.bandId ?? key, entry: (rec) => ({ name: rec.name, effectName: rec.effectName, desc: rec.desc }) },
  // base and golden are two states of one mapping (§4.1), so the row is keyed by the base item and the base record
  // is the entry; the golden variant is listed under it, not as its own row.
  items: { source: 'items', idOf: (rec, key) => rec.baseId ?? key, entry: (rec) => ({ name: rec.name, desc: rec.desc, price: rec.price }) },
};

/** Newest first: registry order, limited to the sources. `auto` resolves against this order. */
export function recencyOrder(sources, ids = registryIds()) { return ids.filter((id) => sources.includes(id)); }

/**
 * Does the row only look like a conflict? Two sources that carry the same content with the same effect are not a
 * decision the admin has to make, so 仅显示冲突 hides them (§4.2) and a batch preset has nothing to pick for them.
 * A pick row compares the entry the panel shows; an operator row compares the bonds each source carries.
 */
export function identicalRow(row) {
  if (row.versions.length < 2) return false;
  if (row.cells) {
    const keys = row.versions.map((v) => [...(row.cells[v] ?? [])].sort().join('|'));
    return keys.every((k) => k === keys[0]);
  }
  const keys = row.versions.map((v) => JSON.stringify(row.entries?.[v] ?? null));
  return keys.every((k) => k === keys[0]);
}

/**
 * Rows per type, from the sources' data. Cached per source set — the data behind a version is frozen, so the rows
 * only change when the sources do; the selection itself is applied by wildView() on top of them.
 * @param {string[]} sources
 * @param {{ ids?: readonly string[], log?: any }} o
 */
export function buildCatalog(sources, { ids = registryIds(), log = console } = {}) {
  const order = recencyOrder(sources, ids);
  const data = {};
  for (const id of order) data[id] = getVersionData(id, { log });
  const membership = new Map();
  const tables = {};
  for (const type of PICK_TYPES) {
    const spec = TABLES[type];
    const rows = new Map();
    for (const id of order) {
      for (const [key, rec] of Object.entries(data[id][spec.source] ?? {})) {
        const rowId = String(spec.idOf(rec, key));
        let row = rows.get(rowId);
        if (!row) {
          row = { id: rowId, name: rec.name, versions: [], entries: {} };
          rows.set(rowId, row);
        }
        if (!row.versions.includes(id)) row.versions.push(id);
        if (!row.entries[id]) row.entries[id] = spec.entry(rec);
        const set = membership.get(`${type}:${rowId}`) ?? new Set();
        set.add(id);
        membership.set(`${type}:${rowId}`, set);
      }
    }
    tables[type] = [...rows.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const row of tables[type]) { row.conflict = row.versions.length > 1; row.identical = identicalRow(row); }
  }
  // The operator matrix: one row per 干员 (charId), base record only, and the bonds that record carries per version.
  const operators = new Map();
  for (const id of order) {
    for (const rec of Object.values(data[id].chess ?? {})) {
      if (rec.chessId !== rec.baseId) continue;
      const charId = String(rec.charId ?? '');
      if (!charId) continue;
      let row = operators.get(charId);
      if (!row) {
        row = { id: charId, name: rec.name, versions: [], cells: {}, bondNames: {} };
        operators.set(charId, row);
      }
      if (!row.versions.includes(id)) row.versions.push(id);
      const bonds = (rec.bonds ?? []).map(String);
      if (!row.cells[id]) {
        row.cells[id] = bonds;
        // The cell's label is the bond's own 中文名, not its id: `miraShip` reads as nothing to a maintainer, the same
        // reason the version cards show the label and keep the id as the technical detail. Resolved per source, so a
        // rename in one version belongs to that version's cell.
        for (const bondId of bonds) row.bondNames[`${id}:${bondId}`] = data[id].bonds?.[bondId]?.name ?? String(bondId);
      }
      const set = membership.get(`operators:${charId}`) ?? new Set();
      for (const bondId of bonds) set.add(`${id}:${bondId}`);
      membership.set(`operators:${charId}`, set);
    }
  }
  tables.operators = [...operators.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const row of tables.operators) { row.conflict = row.versions.length > 1; row.identical = identicalRow(row); }
  return { sources: order, order, tables, membership };
}

/** The version a row resolves to: the pick when it names a source, the newest source when auto, null when off. */
export function resolvePick(pick, row, order) {
  if (pick === PICK_OFF) return null;
  if (pick && pick !== PICK_AUTO) return row.versions.includes(pick) ? pick : null;
  for (const id of order) if (row.versions.includes(id)) return id;
  return null;
}

/** The panel's operation bar (§4.2): 仅显示冲突 is on by default, plus 按名称检索 and 按版本筛选. */
export function contentFilter(source = {}) {
  // A URLSearchParams returns null for an absent key, which is not the same as "the panel did not say": an absent or
  // empty value keeps the default, so the panel's default-on filter survives a query that only carries search.
  const read = (key) => {
    const value = typeof source.get === 'function' ? source.get(key) : source[key];
    return value === null || value === '' ? undefined : value;
  };
  const conflict = read('conflictOnly') ?? read('conflict');
  return { search: String(read('search') ?? '').trim().slice(0, 80), version: read('version') || null,
    conflictOnly: conflict === undefined || conflict === true || conflict === '1' || conflict === 'true' };
}

export function filterRows(rows, filter = {}) {
  const { search = '', version = null, conflictOnly = true } = contentFilter(filter);
  const q = search.toLowerCase();
  return rows.filter((row) => {
    // 仅显示冲突 hides both kinds of row that are not a decision: the single-source row, and the multi-source row
    // whose sources all read the same with the same effect (§4.2).
    if (conflictOnly && !(row.conflict && !row.identical)) return false;
    if (version && !row.versions.includes(version)) return false;
    if (!q) return true;
    if (String(row.id).toLowerCase().includes(q) || String(row.name ?? '').toLowerCase().includes(q)) return true;
    for (const entry of Object.values(row.entries ?? {})) {
      if (String(entry.name ?? '').toLowerCase().includes(q) || String(entry.desc ?? '').toLowerCase().includes(q)) return true;
    }
    for (const bonds of Object.values(row.cells ?? {})) if (bonds.some((b) => b.toLowerCase().includes(q))) return true;
    // The operator row has no entry text of its own, so the search also reads the bond names the matrix labels with.
    for (const name of Object.values(row.bondNames ?? {})) if (String(name).toLowerCase().includes(q)) return true;
    return false;
  });
}

/** A row's selection as the panel shows it: the pick table entry, or the operator matrix's off list. */
export function rowSelection(doc, type, row) {
  if (type === 'operators') return (doc.operators?.[row.id]?.off ?? []);
  return doc.picks?.[type]?.[row.id] ?? PICK_AUTO;
}

/** The rows the panel renders, with the selection and what it resolves to. */
export function wildView(doc, catalog, filter = {}) {
  const out = { sources: catalog.sources, order: catalog.order, revision: doc.revision, tables: {} };
  for (const type of Object.keys(catalog.tables)) {
    const rows = filterRows(catalog.tables[type], filter);
    out.tables[type] = rows.map((row) => {
      const selection = rowSelection(doc, type, row);
      return { ...row, selection, effective: type === 'operators' ? null : resolvePick(selection, row, catalog.order) };
    });
  }
  return out;
}

/** The counts the panel's header shows (rows / conflicts), over the whole table, not the filtered view. `conflicts`
 * counts only the rows that are still a decision, so it matches what 仅显示冲突 lists; `identical` is the rest. */
export function tableStats(catalog) {
  const stats = {};
  for (const [type, rows] of Object.entries(catalog.tables)) {
    stats[type] = { rows: rows.length, conflicts: rows.filter((r) => r.conflict && !r.identical).length,
      identical: rows.filter((r) => r.conflict && r.identical).length };
  }
  return stats;
}
