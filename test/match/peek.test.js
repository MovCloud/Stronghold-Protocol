// 同盟盟约速查 peek，服务端（server/match/match/peek.js）：名册浮窗发 g.peek { open }，服务端单播**队友**场上的干员
// —— 展开时一份快照，之后每份变化名单一帧。服务端按队伍过滤（coop：整队；2V2：只发观众自己那队），观战席根本
// 到不了这里，内容不进 m.public，在棋盘上挪动棋子不算名单变化。观众侧与屏上视图的合并见 test/ui/team-flyout.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileKey } from '../../server/match/board.js';
import { PHASE, ERR } from '../../shared/constants.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';

function clearSeat(b) {
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
}

function place(h, b, pick) {
  const id = chessOfTier(1, MELEE).find((x) => h.m.pool.has(x) && !pick.includes(x));
  pick.push(id);
  const [r, c] = legalTileFor(h.m, b, id);
  give(h.m, b, id, 'board', [r, c]);
  return { id, r, c };
}

const lastPeeks = (h, pid) => h.allTo(pid, 'm.peek');

test('g.peek: the open answers the viewer\'s team mates only, then one frame per layout change', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7101, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const used = [];
  place(h, b, used);

  assert.ok(h.m.handle('p_0', { t: 'g.peek', open: true }).ok);
  const snap = h.lastTo('p_0', 'm.peek');
  assert.ok(snap && typeof snap === 'object', 'the snapshot is unicast to the asker');
  assert.deepEqual(Object.keys(snap.ops), ['p_1'], 'the other seats only — never the viewer itself');
  assert.equal(snap.ops.p_1.length, 1);
  assert.ok(!h.bc.some((m) => m.t === 'm.peek'), 'never broadcast (m.public carries no roster)');
  assert.ok(!JSON.stringify(snap).includes('boardOps'), 'the lean flyout shape, not the private field');

  // Moving the piece around is not a layout change: the sorted ids are the same, so nothing is pushed.
  const [oldKey] = [...b.board.keys()];
  const piece = b.board.get(oldKey);
  const [r0, c0] = oldKey.split(',').map(Number);
  b.board.delete(oldKey);
  b.board.set(tileKey(r0 === 0 ? 1 : 0, c0), piece);
  h.m.flush();
  assert.equal(lastPeeks(h, 'p_0').length, 1, 'a moved piece pushes nothing');

  // A new operator on the teammate's board is a change: one incremental frame naming that seat.
  place(h, b, used);
  h.m.flush();
  let frames = lastPeeks(h, 'p_0');
  assert.equal(frames.length, 2, 'one incremental frame for the change');
  assert.equal(frames[1].seat, 'p_1');
  assert.equal(frames[1].ops.length, 2);

  // Closed: no further frames, even when the layout changes again.
  assert.ok(h.m.handle('p_0', { t: 'g.peek', open: false }).ok);
  place(h, b, used);
  h.m.flush();
  assert.equal(lastPeeks(h, 'p_0').length, 2, 'a closed flyout is not updated');
  h.m.dispose();
});

test('g.peek in 2V2: only the viewer\'s own team, never the opponent', () => {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, team: 0 },
    { seat: 1, playerId: 'ai_1', name: 'A1', isBot: true, connected: true, team: 0 },
    { seat: 2, playerId: 'p_1', name: 'P1', isBot: false, connected: true, team: 1 },
    { seat: 3, playerId: 'ai_3', name: 'B1', isBot: true, connected: true, team: 1 },
  ];
  const h = makeMatch({ mode: 'versus', difficulty: 'NORMAL', seats, seed: 7102, fake: true }).start();
  assert.ok(h.m.handle('p_0', { t: 'g.peek', open: true }).ok);
  assert.deepEqual(Object.keys(h.lastTo('p_0', 'm.peek').ops).sort(), ['ai_1'], 'team 0: the enemy seats never appear');
  assert.ok(h.m.handle('p_1', { t: 'g.peek', open: true }).ok);
  assert.deepEqual(Object.keys(h.lastTo('p_1', 'm.peek').ops).sort(), ['ai_3'], 'team 1 likewise');
  h.m.dispose();
});

test('g.peek is the status channel: it answers inside a battle window, the team boundary is the only filter', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7104, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  place(h, b, []);
  h.m.phase = PHASE.COMBAT;
  h.m.fields = [
    { fieldId: 'n:p_0', kind: 'normal', live: true, cc: true, players: ['p_0'] },
    { fieldId: 'n:p_1', kind: 'normal', live: true, cc: true, players: ['p_1'] },
  ];
  assert.ok(h.m.handle('p_0', { t: 'g.peek', open: true }).ok);
  const snap = h.lastTo('p_0', 'm.peek');
  assert.deepEqual(Object.keys(snap.ops), ['p_1'], 'the roster is not gated by the viewer\'s own battle (g.watch would be)');
  h.m.dispose();
});

test('g.peek: the subscription ends with its round / phase, and drops on a disconnect', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7103, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const used = [];
  place(h, b, used);

  assert.ok(h.m.handle('p_0', { t: 'g.peek', open: true }).ok);
  assert.ok(h.m._peekSubs.has('p_0'), 'the open subscribes');
  h.m.phase = PHASE.COMBAT; // the phase window ends (the client collapses and sends the close; this is the server half)
  h.m.flush();
  assert.ok(!h.m._peekSubs.has('p_0'), 'a phase change ends the subscription');
  const before = lastPeeks(h, 'p_0').length;
  place(h, b, used);
  h.m.flush();
  assert.equal(lastPeeks(h, 'p_0').length, before, 'a subscription past its phase receives nothing');

  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.ok(h.m._peekSubs.has('p_0'), 'reopening subscribes again');
  h.m.round += 1;
  h.m.flush();
  assert.ok(!h.m._peekSubs.has('p_0'), 'a round change ends it too');

  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.ok(h.m._peekSubs.has('p_0'), 'reopening subscribes again');
  h.m.onDisconnect('p_0');
  assert.ok(!h.m._peekSubs.has('p_0'), 'a disconnect drops the subscription');
  h.m.dispose();
});

test('g.peek: a spectator seat is refused like any other intent — only g.watch reaches the bench', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, spectators: ['s_0'], seed: 7105, fake: true }).start();
  h.toPrep(1);
  const r = h.m.handle('s_0', { t: 'g.peek', open: true });
  assert.equal(r.error, ERR.SPECTATOR);
  assert.ok(!h.m._peekSubs?.has('s_0'), 'no subscription either');
  assert.equal(h.lastTo('s_0', 'm.peek'), null, 'and no frame');
  h.m.dispose();
});

test('g.peek: a finalised death pushes [] to the open flyout (its pieces went back to the pool)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7106, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  place(h, b, []);
  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.equal(h.lastTo('p_0', 'm.peek').ops.p_1.length, 1, 'the snapshot has the operator');

  b.eliminate(1);
  h.m.flush();
  const frames = lastPeeks(h, 'p_0');
  assert.equal(frames.at(-1).seat, 'p_1');
  assert.deepEqual(frames.at(-1).ops, [], 'a finalised seat is empty, not stale');
  h.m.dispose();
});

test('g.peek: the revival window keeps the roster (a seat waiting to be rescued is not dead yet)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7107, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  place(h, b, []);
  // 实验性救援：`alive` 已是 false，但没人救才会最终判死（server/match/match/extensions.js pendingDeath）。
  b.alive = false;
  b.pendingDeath = true;
  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.equal(h.lastTo('p_0', 'm.peek').ops.p_1.length, 1, 'still on the flyout while the rescue is possible');

  b.pendingDeath = false;
  h.m.flush();
  assert.deepEqual(lastPeeks(h, 'p_0').at(-1).ops, [], 'the final death empties it');
  h.m.dispose();
});

test('g.peek: co-op boss rounds cross groups — the roster is status, not battlefield state', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7108, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  place(h, b, []);
  h.m.phase = PHASE.COMBAT;
  h.m.fields = [
    { fieldId: 'b1', kind: 'boss', live: true, cc: true, players: ['p_0'] },
    { fieldId: 'b2', kind: 'hidden', live: true, cc: true, players: ['p_1'] },
  ];
  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.deepEqual(Object.keys(h.lastTo('p_0', 'm.peek').ops), ['p_1'], 'the other group is still the same team');
  h.m.dispose();
});
