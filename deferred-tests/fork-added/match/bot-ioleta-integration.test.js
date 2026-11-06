import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, botPrep, botPrepBegin, deferExperimentalMerge, levelUp } from '../../server/match/bot.js';
import { makeMatch, give, legalTileFor } from './harness.js';
import { experimentalSearchTargets } from '../../server/match/botIoletaExperimental.js';
import { createRng } from '../../server/sim/rng.js';

function setup(t, experimental = true) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  m.botIoletaPolicy = experimental ? 'experimental' : 'legacy';
  m.botFormationEnabled = false;
  ps.bandId = 'band_ioleta';
  ps.shop.slots = [];
  ps.shop.freeRefreshes = 0;
  ps.funds = 0;
  return { m, ps };
}

test('experimental buys usable equipment when remaining funds cannot search for missing targets', t => {
  const { m, ps } = setup(t);
  const operator = 'chess_char_1_09_a', item = 'chess_item_1_01_e_a';
  give(m, ps, operator, 'board', legalTileFor(m, ps, operator));
  ps.funds = 2;
  ps.shop.slots = [
    ...Array.from({ length: 3 }, () => ({ kind: 'chess', id: operator, basePrice: 2, sold: true })),
    { kind: 'item', id: item, basePrice: 1, sold: false },
  ];
  assert.ok(experimentalSearchTargets(m, ps).length > 0);
  botPrep(m, ps);
  assert.equal(ps.stats.refreshes, 0);
  assert.equal(ps.shop.slots[3].sold, true);
  assert.equal(ps.funds, 1);
  assert.ok([...ps.board.values()].some(p => p.items?.some(i => i.id === item)));
  assert.equal(ps.ready, true);
});

test('experimental R7 escape upgrades L1 without elite gate; legacy is unchanged', t => {
  for (const enabled of [false, true]) {
    const { m, ps } = setup(t, enabled);
    m.round = 7;
    ps.shop.upgradePrice = 0;
    levelUp(m, ps);
    assert.equal(ps.shop.level, enabled ? 2 : 1);
  }
});

test('experimental available core merge happens before R7 upgrade', t => {
  const { m, ps } = setup(t);
  const id = 'chess_char_1_10_a'; // 古米
  m.round = 7;
  give(m, ps, id); give(m, ps, id);
  ps.shop.upgradePrice = 0;
  ps.funds = 2;
  ps.shop.slots = [{ kind: 'chess', id, basePrice: 2, sold: false }];
  const events = [];
  const buy = ps.buy.bind(ps), upgrade = ps.levelUp.bind(ps);
  ps.buy = i => { events.push('buy'); return buy(i); };
  ps.levelUp = () => { events.push('upgrade'); return upgrade(); };
  levelUp(m, ps);
  assert.equal(ps.shop.level, 1);
  botPrepBegin(m, ps);
  assert.ok(events.indexOf('buy') >= 0);
  assert.ok(events.indexOf('upgrade') > events.indexOf('buy'));
  assert.ok(ps.allChess().some(p => p.id === m.gd.goldenIdOf(id)));
});

test('R7 escape budget is not spent on a core first copy before upgrading', t => {
  const { m, ps } = setup(t);
  m.round = 7;
  ps.funds = 5;
  ps.shop.upgradePrice = 5;
  ps.shop.slots = [{ kind: 'chess', id: 'chess_char_1_10_a', basePrice: 2, sold: false }];
  const events = [];
  const buy = ps.buy.bind(ps), upgrade = ps.levelUp.bind(ps);
  ps.buy = i => { events.push('buy'); return buy(i); };
  ps.levelUp = () => { events.push('upgrade'); return upgrade(); };
  botPrepBegin(m, ps);
  assert.equal(events[0], 'upgrade');
  assert.ok(ps.shop.level >= 2);
});

test('optional merge delay responds to actual previous leaks, LP and level', t => {
  const { m, ps } = setup(t);
  for (const id of ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_1_09_a']) give(m, ps, id);
  ps.deployCapBonus = 3 - ps.gd.deployCap;
  arrange(m, ps);
  assert.equal(ps.deployCount, 3);
  m.round = 7;
  ps.shop.upgradePrice = 0;
  ps.funds = 10;
  ps.lp = 20;
  m.lastResults.set(ps.playerId, { leaked: [] });
  assert.equal(deferExperimentalMerge(m, ps), true);
  assert.equal(deferExperimentalMerge(m, ps, 11), false, 'never delay for an unaffordable buy-after-upgrade');
  m.lastResults.set(ps.playerId, { leaked: [{ counted: true }] });
  assert.equal(deferExperimentalMerge(m, ps), false);
  m.lastResults.set(ps.playerId, { leaked: [] });
  ps.lp = 10;
  assert.equal(deferExperimentalMerge(m, ps), false);
  ps.lp = 20; ps.shop.level = 4;
  assert.equal(deferExperimentalMerge(m, ps), false);
});

test('legacy formation toggle restores ordinary non-final layout with rehearsal disabled', t => {
  const { m, ps } = setup(t, false);
  for (const id of ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_1_09_a']) give(m, ps, id);
  m.rngBots = createRng(321);
  arrange(m, ps, { final: false });
  const before = [...ps.board].map(([k, p]) => [k, p.uid, p.dir]);
  m.rngBots = createRng(321);
  arrange(m, ps, { final: true });
  assert.deepEqual([...ps.board].map(([k, p]) => [k, p.uid, p.dir]), before);
});
