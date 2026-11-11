// 内容管理 (docs/CONTENT-ADMIN.md §5): the wild synthesis rules. mergeWild() is pure rules (data in, data out), so the
// fixture below is the smallest data set that passes validateReferences; the real data is checked at the end. What is
// testable here is the union, the three pick states, provenance, the token home, the dangling-reference policy and the
// version stamp — the write itself is writeWild()'s single IO step and the boot wiring is tested over HTTP elsewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICK_AUTO, PICK_OFF, defaultWild, registryIds } from '../server/contentConfig.js';
import { mergeWild } from '../server/contentMerge.js';
import { getVersionData } from '../server/data.js';

const NEW = 'act2autochess';
const OLD = 'act1autochess';
const IDS = [NEW, OLD];
const quiet = { info() {}, warn() {}, error() {} };

/** The smallest record set validateReferences accepts: one enemy, one wave, one stage, empty everything else. */
function fixture(src, over = {}) {
  const mark = (rec) => ({ ...rec, src });
  return {
    config: { modes: [{ modeId: 'm1', rounds: {}, stages: ['s1'], activeBondIds: [], inactiveBondIds: [] }], unite: { templates: {} } },
    chess: {}, bonds: {}, bands: {}, items: {}, effects: {}, garrisons: {},
    enemies: { en1: mark({ key: 'en1', stats: { maxHp: 10, bat: 1, aspd: 1, moveSpeed: 1, lpr: 0, rangeRadius: 0 } }) },
    waves: { w1: mark({ id: 'w1', spawns: [{ key: 'en1', routeIndex: 0 }], branches: {}, overrides: {}, routes: [1], extraRoutes: [] }) },
    stages: { s1: mark({ id: 's1', kind: 'unite', helpers: 1, active: false, rows: Array.from({ length: 19 }, () => Array(21).fill('.')) }) },
    bosses: {}, tokens: {},
    choices: { cards: { bounty: [] }, pools: {} },
    factions: { entries: {} },
    backups: { units: {}, tokens: {}, diy: { slots: {}, prototypes: {}, locked: {}, ownedPool: {}, operators: {} } },
    ...over,
  };
}

/** A PRESET chess is its own backup (§18), so the fixture uses one and skips the stand-in checks. */
const unit = (src, chessId, extra = {}) => ({
  chessId, baseId: chessId, charId: 'cx', goldenId: null, chessType: 'PRESET', backup: { charId: 'cx' },
  bonds: [], garrisonIds: [], tokens: [], stats: {}, skill: { skillId: 'sk' }, rangeGrid: [],
  skills: [{ skillId: 'sk', isDefault: true }], src, ...extra,
});

const token = (src, tokenId, extra = {}) => ({ tokenId, stats: {}, variants: { o1: { sources: ['x'] } }, src, ...extra });

const run = (docs, doc) => mergeWild({ ...defaultWild(IDS), ...doc }, (id) => docs[id], { ids: IDS, log: quiet });

test('the union takes the newest source that has the row, and a pick overrides it', () => {
  const docs = {
    [NEW]: fixture(NEW, { bonds: { b1: { bondId: 'b1', effectId: 'e1', members: [], thresholds: [1], src: NEW } } }),
    [OLD]: fixture(OLD, { bonds: { b1: { bondId: 'b1', effectId: 'e1', members: [], thresholds: [1], src: OLD } } }),
  };
  assert.equal(run(docs).data.bonds.b1.src, NEW, 'auto resolves against the recency order');
  assert.equal(run(docs, { picks: { bonds: { b1: OLD } } }).data.bonds.b1.src, OLD, 'a pin takes that source');
  assert.equal(run(docs, { picks: { bonds: { b1: PICK_OFF } } }).data.bonds.b1, undefined, 'off takes the row out');

  const only = { [NEW]: fixture(NEW), [OLD]: fixture(OLD, { bands: { band1: { bandId: 'band1', effectId: 'e1', bondIds: [], src: OLD } } }) };
  assert.equal(run(only).data.bands.band1.src, OLD, 'a row one source alone provides still enters the union');
});

test('a dropped reference is counted, a required one is an error rather than a silent hole', () => {
  const docs = {
    [NEW]: fixture(NEW, {
      effects: { e1: { effectId: 'e1', src: NEW } },
      bonds: { b1: { bondId: 'b1', effectId: 'e1', members: [], thresholds: [1], src: NEW } },
      bands: { band1: { bandId: 'band1', effectId: 'e1', bondIds: ['b1'], src: NEW } },
    }),
    [OLD]: fixture(OLD),
  };
  const off = run(docs, { picks: { bonds: { b1: PICK_OFF } } });
  assert.ok(off.ok, 'a droppable reference does not refuse the merge');
  assert.deepEqual(off.dropped, [{ name: 'bands', id: 'band1', target: 'bonds', refId: 'b1' }]);
  assert.deepEqual(off.data.bands.band1.bondIds, [], 'the dangling reference is removed from the merged record');

  const ghost = run({ [NEW]: fixture(NEW, { bonds: { b1: { bondId: 'b1', effectId: 'eGhost', members: [], thresholds: [1], src: NEW } } }), [OLD]: fixture(OLD) },
    { picks: { bonds: { b1: NEW } } });
  assert.equal(ghost.ok, false);
  assert.ok(ghost.errors.some((e) => /解析不到/.test(e)), 'an effect no source has cannot be dropped quietly');
  assert.equal(ghost.data.bonds.b1.effectId, 'eGhost', 'a required reference is reported, not rewritten');
});

test("provenance: a record referenced by a pinned row comes from that row's source", () => {
  const docs = {
    [NEW]: fixture(NEW, {
      bands: { band1: { bandId: 'band1', effectId: 'e1', bondIds: [], src: NEW } },
      effects: { e1: { effectId: 'e1', src: NEW } },
    }),
    [OLD]: fixture(OLD, {
      bands: { band1: { bandId: 'band1', effectId: 'e1', bondIds: [], src: OLD } },
      effects: { e1: { effectId: 'e1', src: OLD } },
    }),
  };
  assert.equal(run(docs).data.effects.e1.src, NEW, 'nothing references it: the newest wins');
  assert.equal(run(docs, { picks: { bands: { band1: OLD } } }).data.effects.e1.src, OLD,
    'the newest source that happens to hold the same id is not the owner of a referenced record');
});

test('an operator group stays one source: the base is the newest, its elite form comes with it', () => {
  const docs = {
    [NEW]: fixture(NEW, {
      effects: { e1: { effectId: 'e1', src: NEW } },
      bonds: { ba: { bondId: 'ba', effectId: 'e1', members: [], thresholds: [1], src: NEW }, bb: { bondId: 'bb', effectId: 'e1', members: [], thresholds: [1], src: NEW } },
      chess: { cx: unit(NEW, 'cx', { goldenId: 'g1', bonds: ['ba'] }), g1: unit(NEW, 'g1', { baseId: 'cx', bonds: ['ba'] }) },
    }),
    [OLD]: fixture(OLD, {
      effects: { e1: { effectId: 'e1', src: OLD } },
      bonds: { ba: { bondId: 'ba', effectId: 'e1', members: [], thresholds: [1], src: OLD }, bb: { bondId: 'bb', effectId: 'e1', members: [], thresholds: [1], src: OLD } },
      chess: { cx: unit(OLD, 'cx', { goldenId: 'g1', bonds: ['bb'] }), g1: unit(OLD, 'g1', { baseId: 'cx', bonds: ['bb'] }) },
    }),
  };
  const merged = run(docs).data.chess;
  assert.equal(merged.cx.src, NEW, 'the main record is always the newest, most complete one (§4.4)');
  assert.equal(merged.g1.src, NEW, 'never base from one version and 进阶 from another (§4.5)');
  assert.deepEqual(merged.cx.bonds, ['ba', 'bb'], 'the matrix is the union of the checked cells');
  const off = run(docs, { operators: { cx: { off: [`${NEW}:ba`] } } }).data.chess.cx;
  assert.deepEqual(off.bonds, ['bb'], 'an unchecked cell is taken out of the union');
});

test('a summon has one home per id: the merged set never puts it in both tables', () => {
  const docs = {
    [NEW]: fixture(NEW, { backups: { tokens: { tk1: token(NEW, 'tk1') }, diy: { slots: {}, prototypes: {}, locked: {}, ownedPool: {}, operators: {} } } }),
    [OLD]: fixture(OLD, {
      chess: { cx_old: unit(OLD, 'cx_old', { charId: 'cx_old', backup: { charId: 'cx_old' }, tokens: ['tk1'] }) },
      tokens: { tk1: token(OLD, 'tk1'), tk2: token(OLD, 'tk2') },
    }),
  };
  const r = run(docs);
  assert.ok(r.ok, 'the reference that cannot resolve in the canonical home is droppable, so it is counted, not refused');
  assert.deepEqual(r.dropped, [{ name: 'chess', id: 'cx_old', target: 'tokens', refId: 'tk1' }]);
  assert.equal(Number(Boolean(r.data.tokens.tk1)) + Number(Boolean(r.data.backups.tokens.tk1)), 1);
  assert.equal(r.data.tokens.tk2.src, OLD, 'a row one table alone holds is not a conflict');
});

test('config comes from the newest source and carries the wild stamp', () => {
  const docs = { [NEW]: fixture(NEW, { config: { season: 'act2', modes: [], unite: { templates: {} } } }), [OLD]: fixture(OLD) };
  const merged = run(docs).data;
  assert.equal(merged.config.season, 'act2');
  assert.deepEqual(merged.config.version, { id: 'wild', family: 'covenant', rules: {} });
});

test('a source missing a data file refuses the merge', () => {
  const r = run({ [NEW]: { ...fixture(NEW), bosses: undefined }, [OLD]: fixture(OLD) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('；'), /缺少数据文件 bosses\.json/);
});

test('the real data: same-act sources merge clean, all four report only the cross-table summons', () => {
  const ids = registryIds();
  const dataOf = (id) => getVersionData(id, { log: quiet });
  const runReal = (sources) => mergeWild({ ...defaultWild(ids), sources }, dataOf, { ids, log: quiet });

  for (const subset of [[ids[0], ids[1]], [ids[2], ids[3]], [ids[0]], [ids[2]]]) {
    const r = runReal(subset);
    assert.ok(r.ok, `${subset.join('+')} should merge clean: ${r.errors.join('; ')}`);
    assert.equal(r.dropped.length, 0, 'the same-act sources share their ids with identical content');
  }

  const all = runReal(ids);
  assert.equal(all.ok, false, 'validateReferences allows one home per summon id');
  assert.equal(all.errors.length, 3);
  assert.ok(all.errors.every((e) => e.includes('不同的表')));
  assert.deepEqual(all.errors.map((e) => e.match(/token_[0-9][0-9a-z_]*/)[0]).sort(),
    ['token_10029_slent2_protrb', 'token_10032_jesca2_jckshd', 'token_10043_necras_skeltn']);
});
