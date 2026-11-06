import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

test('Spring shield retaliates once against Bubble S2 without counter recursion', () => {
  const id = 'chess_char_2_08_b';
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 7, autoFinish: false, timeLimit: 60,
    hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 9, col: 5, skillIndex: 1 }],
  });
  h.step();
  const bubble = h.unit(id);
  const spring = h.spawn('enemy_9018_actrpa', { pos: [9, 7], mods: { speedMul: 0 } });
  spring.profile.noAttack = true;
  bubble.skill.gainSp(999, 'test');
  assert.ok(bubble.skill.activate('test'), 'Bubble S2 active');

  h.b.dealDamage(spring, bubble, { amount: 1000, type: 'phys', canDodge: false });

  const hits = h.hooksOf('damaged');
  const bubbleCounters = hits.filter((c) => c.source === bubble && c.target === spring && c.dmg.tags?.includes('counter'));
  const springCounters = hits.filter((c) => c.source === spring && c.target === bubble && c.dmg.tags?.includes('springCounter') && c.dmg.type === 'phys');
  assert.equal(bubbleCounters.length, 1, 'Bubble answers the enemy hit once');
  assert.equal(springCounters.length, 1, 'Spring answers the physical counter once');
  assert.ok(springCounters[0].dmg.tags.includes('counter'), 'Spring retaliation is classified as a counter');
  assert.equal(h.b.errors.length, 0, 'no hook-depth error');
  checkInvariants(h.b);
});
