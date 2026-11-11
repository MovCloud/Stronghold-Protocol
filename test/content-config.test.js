// 内容管理 (docs/CONTENT-ADMIN.md): the rules behind the two runtime documents. contentConfig.js is data + rules and
// contentCatalog.js is the row directory, so what is testable here is validation, the CAS + replay guard, the patch
// semantics, the two batch presets and the row identity — the session, the atomic write and the audit row are tested
// over HTTP in test/player-admin-ops.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PICK_AUTO, PICK_OFF, SCHEMA_VERSION, applyWildPatch, defaultVersions, defaultWild, presetPatch,
  registryIds, validateVersions, validateWild, versionsMutation, wildMutation,
} from '../server/contentConfig.js';
import {
  buildCatalog, contentFilter, filterRows, identicalRow, recencyOrder, resolvePick, rowSelection, tableStats, wildView,
} from '../server/contentCatalog.js';

const IDS = registryIds();
const quiet = { info() {}, warn() {} };
const current = (doc) => ({ doc, raw: undefined });

test('the defaults are the whole registry, newest first', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(defaultVersions().enabled, IDS);
  assert.deepEqual(defaultWild().sources, IDS);
  assert.equal(defaultVersions().revision, 0, 'no file is revision 0, so the panel needs expectedRevision 0 for its first write');
  // The registry is newest first, and that is the order `auto` resolves against — the panel and the generator must
  // agree, so recencyOrder is the registry filtered to the sources rather than a separately stored list.
  assert.deepEqual(recencyOrder(['act1autochess', 'act2autochess'], IDS), ['act2autochess', 'act1autochess']);
});

test('the enabled set is checked against the registry and can never be empty', () => {
  assert.deepEqual(validateVersions(defaultVersions(), IDS), []);
  const empty = validateVersions({ ...defaultVersions(), enabled: [] }, IDS);
  assert.equal(empty.length, 1, 'disabling everything would leave a server with nothing to serve');
  assert.match(empty[0], /至少/);
  const unknown = validateVersions({ ...defaultVersions(), enabled: ['act3autochess'] }, IDS);
  assert.match(unknown.join('；'), /未知的版本/);
  const dup = validateVersions({ ...defaultVersions(), enabled: [IDS[0], IDS[0]] }, IDS);
  assert.match(dup.join('；'), /重复/);
  assert.match(validateVersions({ schemaVersion: 2, revision: 0, enabled: IDS }, IDS).join('；'), /schemaVersion/);
});

test('a wild pick may only name auto, off or a source that provides the row', () => {
  const membership = new Map([['bonds:b1', new Set(['act1autochess'])], ['operators:char_x', new Set(['act1autochess:b1'])]]);
  const base = defaultWild(IDS);
  assert.deepEqual(validateWild(base, IDS, membership), []);
  // The version is a source, but it does not provide this row: picking it would resolve to nothing.
  assert.match(validateWild({ ...base, picks: { bonds: { b1: 'act2autochess' } } }, IDS, membership).join('；'), /不存在/);
  assert.match(validateWild({ ...base, picks: { bonds: { b1: 'act1autochess@V1_1' } } }, IDS, membership).join('；'), /不存在/);
  assert.match(validateWild({ ...base, picks: { bonds: { nope: 'auto' } } }, IDS, membership).join('；'), /不在任何来源中/);
  assert.match(validateWild({ ...base, picks: { effects: { b1: 'auto' } } }, IDS, membership).join('；'), /未知的内容类型/);
  // The operator matrix records the unchecked (version × bond) cells, so each one has to be a cell the source has.
  assert.deepEqual(validateWild({ ...base, operators: { char_x: { off: ['act1autochess:b1'] } } }, IDS, membership), []);
  assert.match(validateWild({ ...base, operators: { char_x: { off: ['act1autochess:b2'] } } }, IDS, membership).join('；'), /没有盟约/);
  assert.match(validateWild({ ...base, operators: { char_x: { off: ['act2autochess:b1'] } } }, IDS, membership).join('；'), /没有盟约|不在来源中/);
});

test('the patch is a delta applied to a copy; a null value puts the row back to auto', () => {
  const doc = { ...defaultWild(IDS), picks: { bonds: { b1: 'auto' }, items: { i1: PICK_OFF } }, operators: { char_x: { off: ['act1autochess:b1'] } } };
  const next = applyWildPatch(doc, { picks: { bonds: { b1: null }, bands: { b2: 'act2autochess' } } });
  assert.deepEqual(next.picks.bonds, {}, 'clearing an override returns the row to the default');
  assert.equal(next.picks.bands.b2, 'act2autochess', 'untouched tables keep their values');
  assert.equal(next.picks.items.i1, PICK_OFF);
  assert.deepEqual(next.operators.char_x, { off: ['act1autochess:b1'] });
  assert.equal(doc.picks.bonds.b1, 'auto', 'the document is not mutated');
});

test('mutations guard replay and the revision, and only count a change once', () => {
  const first = versionsMutation(current(defaultVersions()), { enabled: ['act2autochess'], expectedRevision: 0 }, { ids: IDS });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.document.revision, 1);
  assert.deepEqual(first.document.enabled, ['act2autochess']);

  const replay = versionsMutation(current(first.document), { enabled: ['act2autochess'], expectedRevision: 1 }, { ids: IDS });
  assert.equal(replay.ok, true);
  assert.equal(replay.changed, false, 'the same payload is not applied twice');
  assert.equal(replay.document.revision, 1);

  const stale = versionsMutation(current(first.document), { enabled: IDS, expectedRevision: 0 }, { ids: IDS });
  assert.equal(stale.ok, false);
  assert.equal(stale.cas, true, 'a stale revision is refused before anything is validated');
  assert.equal(stale.revision, 1);
  assert.match(stale.errors.join('；'), /刷新/);

  const bad = versionsMutation(current(first.document), { enabled: [], expectedRevision: 1 }, { ids: IDS });
  assert.equal(bad.ok, false);
  assert.equal(bad.cas, undefined);
  assert.match(bad.errors.join('；'), /至少/);

  const wild = wildMutation(current(defaultWild(IDS)), { patch: { picks: { bonds: { b1: 'act1autochess' } } }, expectedRevision: 0 }, { ids: IDS });
  assert.equal(wild.document.revision, 1);
  assert.equal(wildMutation(current(wild.document), { patch: { picks: { bonds: { b1: 'act1autochess' } } }, expectedRevision: 1 }, { ids: IDS }).changed, false);
  assert.equal(wildMutation(current(wild.document), { patch: [], expectedRevision: 1 }, { ids: IDS }).ok, false);
});

test('the two batch presets: pin only touches conflicting rows, exclude takes the version out entirely', () => {
  const rows = {
    bonds: [{ id: 'shared', versions: ['act2autochess', 'act1autochess'] }, { id: 'only1', versions: ['act1autochess'] }],
    bands: [{ id: 'b1', versions: ['act2autochess'] }],
    items: [{ id: 'i1', versions: ['act1autochess', 'act2autochess'] }],
    operators: [{ id: 'char_x', versions: ['act1autochess', 'act2autochess'], cells: { act1autochess: ['ba'], act2autochess: ['bb'] } }],
  };
  const order = ['act2autochess', 'act1autochess'];

  const pin = presetPatch(rows, { preset: 'pin', version: 'act1autochess', order });
  assert.equal(pin.picks.bonds.shared, 'act1autochess');
  assert.equal(pin.picks.bonds.only1, undefined, 'a row only this version provides has nothing to pin');
  assert.equal(pin.picks.items.i1, 'act1autochess');
  assert.deepEqual(pin.picks.bands, {}, 'a table with no conflicting row is not touched');
  assert.deepEqual(pin.operators.char_x, { off: ['act2autochess:bb'] }, 'pin keeps only the cells of the chosen version');

  const exclude = presetPatch(rows, { preset: 'exclude', version: 'act1autochess', order });
  assert.equal(exclude.picks.bonds.only1, PICK_OFF, 'what only this version provides is taken out');
  assert.equal(exclude.picks.bonds.shared, 'act2autochess', 'what it shares takes the newest of the other sources');
  assert.equal(exclude.picks.items.i1, 'act2autochess');
  assert.deepEqual(exclude.operators.char_x, { off: ['act1autochess:ba'] }, 'its own cells are unchecked');
  assert.equal(presetPatch(rows, { preset: 'maybe', version: 'act1autochess', order }), null);
});

test('row identity is (type, id) — never a content hash', () => {
  const catalog = buildCatalog(['act1autochess', 'act2autochess'], { log: quiet });
  assert.deepEqual(catalog.order, ['act2autochess', 'act1autochess']);
  const bonds = catalog.tables.bonds;
  const row = bonds.filter((r) => r.id === 'kjeragShip');
  assert.equal(row.length, 1, 'the same id in two sources is one row, even when the content is identical');
  assert.deepEqual(row[0].versions, ['act2autochess', 'act1autochess']);
  assert.equal(row[0].conflict, true, 'identical content is still a conflict row: each version keeps its own option');
  assert.ok(row[0].entries['act1autochess'] && row[0].entries['act2autochess'], 'both entries are kept for the expanded row');
  const ids = bonds.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'one row per id');
  assert.ok(catalog.tables.items.some((r) => !r.conflict), 'a row one source alone provides is not a conflict');
  assert.ok(catalog.tables.operators.some((r) => r.conflict), 'the operator matrix conflicts on the bonds it carries');
  assert.ok(catalog.membership.get('bonds:kjeragShip').has('act1autochess'));
});

test('auto resolves against the recency order, off resolves to nothing', () => {
  const row = { id: 'x', versions: ['act1autochess', 'act2autochess'] };
  const order = ['act2autochess', 'act1autochess'];
  assert.equal(resolvePick(PICK_AUTO, row, order), 'act2autochess');
  assert.equal(resolvePick('act1autochess', row, order), 'act1autochess');
  assert.equal(resolvePick(PICK_OFF, row, order), null);
  assert.equal(resolvePick('act2autochess@V2_1', row, order), null, 'a pick that names a source without this row resolves to nothing');
});

test('the operation bar: conflicts by default, plus search and the version filter', () => {
  const catalog = buildCatalog(['act1autochess', 'act2autochess'], { log: quiet });
  assert.equal(contentFilter({}).conflictOnly, true, '仅显示冲突 is on by default');
  assert.equal(contentFilter(new URLSearchParams('conflictOnly=0')).conflictOnly, false);
  assert.equal(contentFilter(new URLSearchParams('search=x')).conflictOnly, true,
    'a query that only carries search keeps the default: URLSearchParams returns null for an absent key, not undefined');
  const all = catalog.tables.items;
  assert.ok(all.some((r) => r.conflict) && all.some((r) => !r.conflict), 'one table shows both kinds of row');
  const shown = filterRows(all, {});
  assert.ok(shown.length && shown.every((r) => r.conflict && !r.identical),
    '仅显示冲突 hides both the single-source rows and the multi-source rows that read the same with the same effect');
  assert.ok(all.some((r) => r.conflict && r.identical), 'the two versions do carry identical implementations');
  assert.equal(filterRows(all, { conflictOnly: false }).length, all.length);
  const named = filterRows(all, { conflictOnly: false, search: shown[0].name });
  assert.ok(named.length >= 1 && named[0].id === shown[0].id, 'the search box matches the row by name');
  const byVersion = filterRows(all, { conflictOnly: false, version: 'act1autochess' });
  assert.ok(byVersion.length && byVersion.every((r) => r.versions.includes('act1autochess')));
  const ops = catalog.tables.operators;
  const labelled = ops.find((r) => Object.values(r.bondNames ?? {}).some((n) => n && n !== r.id));
  assert.ok(labelled, 'the matrix labels each cell with the bond 中文名, not the raw id');
  const byBondName = filterRows(ops, { conflictOnly: false, search: Object.values(labelled.bondNames)[0] });
  assert.ok(byBondName.some((r) => r.id === labelled.id), 'the search box matches an operator row by the bond 中文名');
  const stats = tableStats(catalog);
  assert.equal(stats.items.rows, all.length);
  assert.equal(stats.items.conflicts, all.filter((r) => r.conflict && !r.identical).length, 'the header counts what the filter lists');
  assert.equal(stats.items.identical, all.filter((r) => r.conflict && r.identical).length);
});

test('实现相同 covers both a pick row and an operator row', () => {
  assert.equal(identicalRow({ versions: ['a', 'b'], entries: { a: { name: 'x', desc: 'y' }, b: { name: 'x', desc: 'y' } } }), true);
  assert.equal(identicalRow({ versions: ['a', 'b'], entries: { a: { name: 'x', desc: 'y' }, b: { name: 'x', desc: 'z' } } }), false);
  assert.equal(identicalRow({ versions: ['a'], entries: { a: { name: 'x' } } }), false, 'one source is 唯一来源, not 实现相同');
  assert.equal(identicalRow({ versions: ['a', 'b'], cells: { a: ['1', '2'], b: ['2', '1'] } }), true, 'the order the bonds are listed in is not a difference');
  assert.equal(identicalRow({ versions: ['a', 'b'], cells: { a: ['1'], b: ['1', '2'] } }), false);
});

test('the panel view carries the selection and what it resolves to', () => {
  const catalog = buildCatalog(['act1autochess', 'act2autochess'], { log: quiet });
  const doc = { ...defaultWild(catalog.sources), picks: { bonds: { kjeragShip: 'off' } }, operators: {} };
  const view = wildView(doc, catalog, { conflictOnly: false, search: 'kjeragShip' });
  assert.equal(view.revision, 0);
  assert.equal(view.tables.bonds.length, 1);
  assert.equal(rowSelection(doc, 'bonds', view.tables.bonds[0]), 'off');
  assert.equal(view.tables.bonds[0].selection, 'off');
  assert.equal(view.tables.bonds[0].effective, null);
  const op = view.tables.operators.find((r) => r.conflict);
  assert.ok(op, 'the matrix shows a 干员 two sources both provide');
  assert.deepEqual(rowSelection(doc, 'operators', op), [], 'nothing unchecked = every cell on');
  assert.ok(Object.keys(op.cells).length > 1);
});
