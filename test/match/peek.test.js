// 同盟盟约速查 peek, server side (server/match/match/peek.js): the roster flyout asks g.peek { open } and the server
// unicasts its TEAM MATES' board operators — one snapshot on the open, then one frame per changed layout. The server
// filters by team (co-op: the whole roster; 2V2: the viewer's own team only), nothing goes into m.public, and a moved
// piece is not a layout change. The viewer-side merge (peek over flyOpsFor) is test/ui/team-flyout.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileKey } from '../../server/match/board.js';
import { PHASE } from '../../shared/constants.js';
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
