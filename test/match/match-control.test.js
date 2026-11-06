// 比赛控制 (server/match/match/matchControl.js): g.matchControl { action } + g.matchControlBallot { voteId, agree } —
// the pause, the fast-forward toggle and the one-shot 跳过. Every action is a request the connected humans must all
// agree to; a match with no other connected human (a solo run, or humans only against AI seats) is applied directly.
// A passed speed change recomputes every running field's end time from the game seconds still left; a vote that times
// out is a refusal; a voter that disconnects or leaves is dropped and recounted; a checkpoint drops the open vote and
// the speed (transient / derived).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR, MATCH_CONTROL_ACTIONS, PLAYBACK } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { RESULT_GRACE_MS, GAME_SPEED } from '../../server/match/fields.js';
import { MATCH_CONTROL_MS } from '../../server/match/match/matchControl.js';
import { makeMatch } from './harness.js';
import { snapshotMatch, restoreMatch } from '../../server/match/snapshot.js';
import { createRngFromState } from '../../server/sim/rng.js';

const pub = (h) => { h.m.flush(true); return h.lastBc('m.public'); };
const req = (h, id, action) => h.m.handle(id, { t: 'g.matchControl', action });
const ballot = (h, id, agree, voteId = h.m.matchControl.id) => h.m.handle(id, { t: 'g.matchControlBallot', voteId, agree });
/** A client field's result deadline at the speed the match currently runs at. */
const due = (m, f) => f.startAt + Math.round((f.spec.timeLimit / m.gameSpeed) * 1000) + RESULT_GRACE_MS;
/** The real ms still left before a running field's result is due (its clock at `m._clockNow()`). */
const leftMs = (m, f) => due(m, f) - m._clockNow();
/** Reach COMBAT with a battle still running (a battle that is not instantly finished: `f.live`). */
function battle(o) {
  const h = makeMatch({ difficulty: 'FUNNY', fake: true, clientCombat: true, clients: false, instant: false, ...o });
  h.start();
  assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT), 'the battle must be running');
  return h;
}

test('protocol: four actions for the request, a vote id plus a bool for the ballot', () => {
  assert.deepEqual([...MATCH_CONTROL_ACTIONS], ['pause', 'resume', 'fast', 'skip']);
  for (const action of MATCH_CONTROL_ACTIONS) assert.equal(validateC2S({ t: 'g.matchControl', action }), null, action);
  assert.equal(validateC2S({ t: 'g.matchControlBallot', voteId: 1, agree: false }), null);
  // unknown extra fields are not part of the spec and validateC2S ignores them, so the bad cases are bad values
  for (const bad of [{ t: 'g.matchControl' }, { t: 'g.matchControl', action: 'speed' }, { t: 'g.matchControl', action: 'SKIP' },
    { t: 'g.matchControl', action: 1 }, { t: 'g.matchControlBallot', voteId: 0, agree: true },
    { t: 'g.matchControlBallot', voteId: 1 }, { t: 'g.matchControlBallot', voteId: 1, agree: 'yes' }]) {
    assert.notEqual(validateC2S(bad), null, JSON.stringify(bad));
  }
});

test('no other connected human: the single voter is already unanimous, so the server applies it directly', (t) => {
  for (const [mode, bots] of [['solo', 0], ['coop', 2]]) {
    const h = battle({ mode, humans: 1, bots, seed: 6001 });
    t.after(() => h.m.dispose());
    const m = h.m;
    assert.equal(m.gameSpeed, GAME_SPEED, 'the default playback is the fast-forward');
    assert.deepEqual(req(h, 'p_0', 'fast'), { ok: true });
    assert.equal(m.matchControl, null, 'the vote closed at once: one voter is unanimous');
    assert.equal(m.gameSpeed, PLAYBACK.NORMAL, 'the fast-forward was toggled off');
    // soloUntimed: no vote happened, and the notice says so (the client then names the speed only)
    assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlPassed', voteId: 1, action: 'fast', agreed: 1, need: 1, solo: true, speed: PLAYBACK.NORMAL });
    assert.equal(pub(h).speed, PLAYBACK.NORMAL);
    h.sched.advance(300);
    assert.deepEqual(req(h, 'p_0', 'fast'), { ok: true });
    assert.equal(m.gameSpeed, PLAYBACK.FAST, 'toggled back on');
    h.sched.advance(300);
    assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
    assert.equal(m.gameSpeed, PLAYBACK.SKIP);
    h.sched.advance(300);
    assert.equal(req(h, 'p_0', 'skip').error, ERR.ALREADY, 'the 跳过 is one-shot');
    assert.equal(req(h, 'p_0', 'zzz').error, ERR.BAD_MSG);
    assert.equal(req(h, 'stranger', 'fast').error, ERR.NOT_IN_ROOM);
    h.invariants();
  }
});

test('co-op: the request opens a vote the connected humans must all agree to; nothing changes until it passes', (t) => {
  const h = battle({ mode: 'coop', humans: 2, bots: 1, seed: 6002, spectators: ['viewer'] });
  t.after(() => h.m.dispose());
  const m = h.m;
  const speed0 = m.gameSpeed;
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  assert.ok(m.matchControl, 'the vote is open');
  assert.deepEqual(m.matchControl.voters, ['p_0', 'p_1'], 'AI seats never vote');
  assert.equal(m.matchControl.need, 2);
  assert.equal(m.gameSpeed, speed0, 'the speed stands until the room agrees');
  const view = pub(h).matchControl;
  assert.equal(view.id, 1);
  assert.equal(view.action, 'skip');
  assert.equal(view.proposerId, 'p_0');
  assert.deepEqual(view.voters, ['p_0', 'p_1']);
  assert.deepEqual(view.agreed, ['p_0']);
  assert.deepEqual(view.rejected, []);
  assert.equal(view.need, 2);
  assert.equal(view.deadline, m.sched.now() + m.scaled(MATCH_CONTROL_MS));
  assert.equal(pub(h).speed, speed0);
  assert.equal(req(h, 'p_1', 'skip').error, ERR.WRONG_PHASE, 'one control at a time');
  assert.equal(ballot(h, 'viewer', true).error, ERR.SPECTATOR, 'a spectator is not a voter');
  assert.deepEqual(ballot(h, 'p_1', true), { ok: true });
  assert.equal(m.matchControl, null);
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlPassed', voteId: 1, action: 'skip', agreed: 2, need: 2, solo: false, speed: PLAYBACK.SKIP });
  assert.equal(pub(h).matchControl, null);
  assert.equal(pub(h).speed, PLAYBACK.SKIP);
  h.invariants();
});

test('a rejection fails the vote at once; a vote that times out is treated as a refusal', (t) => {
  const h = battle({ mode: 'coop', humans: 3, seed: 6003 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const speed0 = m.gameSpeed;
  assert.deepEqual(req(h, 'p_0', 'fast'), { ok: true });
  assert.deepEqual(ballot(h, 'p_1', false), { ok: true });
  assert.equal(m.matchControl, null, 'failed early: 3 voters, need 3, one no');
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlRejected', voteId: 1, action: 'fast', reason: 'rejected' });
  assert.equal(m.gameSpeed, speed0, 'nothing was applied');
  h.sched.advance(300);
  assert.deepEqual(req(h, 'p_1', 'fast'), { ok: true });
  assert.equal(m.matchControl.id, 2);
  h.sched.advance(m.scaled(MATCH_CONTROL_MS) - 1);
  assert.equal(m.matchControl.id, 2);
  assert.equal(m.gameSpeed, speed0);
  h.sched.advance(1);
  assert.equal(m.matchControl, null);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlRejected', voteId: 2, action: 'fast', reason: 'timeout' });
  assert.equal(m.gameSpeed, speed0);
  assert.equal(ballot(h, 'p_0', true, 2).error, ERR.WRONG_PHASE, 'the vote is over');
  h.invariants();
});

test('the proposer saying no withdraws the request; a stale vote id is refused', (t) => {
  const h = battle({ mode: 'coop', humans: 2, seed: 6004 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const speed0 = m.gameSpeed;
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  const id = m.matchControl.id;
  assert.equal(ballot(h, 'p_1', true, id + 1).error, ERR.BAD_TARGET);
  assert.deepEqual(ballot(h, 'p_0', false), { ok: true });
  assert.equal(m.matchControl, null);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlCancelled', voteId: id, action: 'skip', reason: 'withdrawn' });
  assert.equal(m.gameSpeed, speed0);
  h.invariants();
});

test('a passed speed change recomputes every running field from the game seconds still left', (t) => {
  const h = battle({ mode: 'solo', seed: 6005 });
  t.after(() => h.m.dispose());
  const m = h.m;
  h.sched.advance(4000);
  const f = m.fields[0];
  assert.ok(f.cc && f.live && !f.done && f.spec.timeLimit > 0);
  const el = m._fieldElapsed(f);
  const old = m.gameSpeed;
  const now = m._clockNow();
  const deadline0 = m.deadline;
  assert.ok(deadline0 > now, 'the round countdown is running');
  const before = leftMs(m, f);
  assert.ok(before > 0);
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  // the re-anchor rounds the start time to whole ms, so the progress can only move by half a ms of game time
  assert.ok(Math.abs(m._fieldElapsed(f) - el) <= 0.5 * m.gameSpeed / 1000, 'the game-second progress is unchanged');
  const scale = old / m.gameSpeed;
  assert.equal(m.deadline, now + Math.round((deadline0 - now) * scale), 'the HUD countdown is scaled by old/new');
  const expected = Math.round((f.spec.timeLimit - el) * 1000 / m.gameSpeed) + RESULT_GRACE_MS;
  assert.ok(Math.abs(leftMs(m, f) - expected) <= 1, `the field deadline is the remaining game seconds at the new speed (${leftMs(m, f)} vs ${expected})`);
  assert.ok(leftMs(m, f) < before, 'and it is sooner than it was');
  h.invariants();
});

test('a speed change while paused keeps the clocks frozen and re-arms the deadline on resume', (t) => {
  const h = battle({ mode: 'solo', seed: 6006 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const f = m.fields[0];
  h.sched.advance(3000);
  const el = m._fieldElapsed(f);
  assert.ok(f.deadlineTimer, 'the client field has its result deadline armed');
  assert.deepEqual(req(h, 'p_0', 'pause'), { ok: true });
  assert.equal(m.paused, true);
  assert.equal(f.deadlineTimer, null);
  assert.equal(f.rearmDeadline, true);
  h.sched.advance(60_000);
  assert.ok(Math.abs(m._fieldElapsed(f) - el) < 1e-9, 'the field clock stood still through the pause');
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  assert.equal(f.deadlineTimer, null, 'the deadline is not re-armed while the match is frozen');
  assert.equal(f.rearmDeadline, true);
  assert.ok(Math.abs(m._fieldElapsed(f) - el) < 1e-9);
  h.sched.advance(300);
  assert.deepEqual(req(h, 'p_0', 'resume'), { ok: true });
  assert.equal(m.paused, false);
  assert.equal(f.rearmDeadline, false);
  assert.ok(f.deadlineTimer, 're-armed on resume');
  const expected = Math.round((f.spec.timeLimit - el) * 1000 / m.gameSpeed) + RESULT_GRACE_MS;
  assert.ok(Math.abs(leftMs(m, f) - expected) <= 1, 'the re-armed deadline is the remaining game seconds at the new speed');
  h.invariants();
});

test('a voter that disconnects is dropped and recounted; a reconnect counts again but must answer once more', (t) => {
  const h = battle({ mode: 'coop', humans: 4, seed: 6007 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const speed0 = m.gameSpeed;
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  const id = m.matchControl.id;
  assert.deepEqual(m.matchControl.voters, ['p_0', 'p_1', 'p_2', 'p_3']);
  assert.equal(m.matchControl.need, 4);
  assert.deepEqual(ballot(h, 'p_1', true), { ok: true });
  assert.deepEqual(ballot(h, 'p_2', true), { ok: true });
  assert.equal(m.gameSpeed, speed0, 'three of four agreed');
  m.onDisconnect('p_2');
  assert.equal(m.matchControl.id, id);
  assert.deepEqual(m.matchControl.voters, ['p_0', 'p_1', 'p_3']);
  assert.equal(m.matchControl.need, 3);
  assert.equal(m.matchControl.agreed.size, 2, 'the ballot it cast while away stands for nothing');
  assert.equal(m.gameSpeed, speed0, 'still one agreement short');
  assert.equal(ballot(h, 'p_2', true).error, ERR.NOT_IN_ROOM);
  m.onReconnect('p_2');
  assert.deepEqual(m.matchControl.voters, ['p_0', 'p_1', 'p_3', 'p_2'], 'back online counts again');
  assert.equal(m.matchControl.need, 4);
  assert.equal(m.gameSpeed, speed0);
  assert.deepEqual(ballot(h, 'p_2', true), { ok: true });
  assert.deepEqual(ballot(h, 'p_3', true), { ok: true });
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlPassed', voteId: id, action: 'skip', agreed: 4, need: 4, solo: false, speed: PLAYBACK.SKIP });
  // a vote with no voter left is cancelled, not failed — the proposer goes first, so nobody has agreed
  h.sched.advance(300);
  assert.deepEqual(req(h, 'p_0', 'fast'), { ok: true });
  const id2 = m.matchControl.id;
  m.onDisconnect('p_0');
  assert.deepEqual(m.matchControl.voters, ['p_1', 'p_2', 'p_3']);
  assert.equal(m.matchControl.need, 3);
  assert.equal(m.matchControl.agreed.size, 0);
  m.onDisconnect('p_1');
  assert.equal(m.matchControl.need, 2);
  m.onDisconnect('p_2');
  assert.equal(m.matchControl.need, 1);
  assert.equal(m.gameSpeed, PLAYBACK.SKIP, 'nothing is applied while a voter is left to answer');
  m.onDisconnect('p_3');
  assert.equal(m.matchControl, null);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlCancelled', voteId: id2, action: 'fast', reason: 'empty' });
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  h.invariants();
});

test('the battle ending cancels the open vote (the pause it had already granted is dropped too)', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 6008, fake: true, instant: false }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  assert.ok(m.fields.some((f) => f.live && !f.done), 'the server-run battle is still running');
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  const id = m.matchControl.id;
  assert.ok(h.run(() => !m.controlBattleRunning(), { maxSteps: 3e6 }));
  assert.ok(h.run(() => m.phase !== PHASE.COMBAT, { maxSteps: 3e6 }));
  assert.equal(m.matchControl, null);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlCancelled', voteId: id, action: 'skip', reason: 'battleEnd' });
  assert.equal(m.gameSpeed, GAME_SPEED, 'nothing was applied');
  assert.equal(req(h, 'p_0', 'fast').error, ERR.WRONG_PHASE, 'no battle running');
  h.invariants();
});

test('the room rule speed: the match starts at it, and every round returns to it (a 60× skip covers only its battle)', (t) => {
  const h = makeMatch({ mode: 'solo', seed: 6011, fake: true, instant: false, combatSpeed: PLAYBACK.NORMAL }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT), 'the battle must be running');
  assert.equal(m.gameSpeed, PLAYBACK.NORMAL, 'the match starts at the room rule speed');
  assert.equal(m.defaultSpeed, PLAYBACK.NORMAL);
  assert.equal(pub(h).speed, PLAYBACK.NORMAL);
  assert.deepEqual(req(h, 'p_0', 'skip'), { ok: true });
  assert.equal(m.gameSpeed, PLAYBACK.SKIP);
  assert.equal(pub(h).speed, PLAYBACK.SKIP);
  h.toPrep(2);
  assert.equal(m.round, 2);
  assert.equal(m.gameSpeed, PLAYBACK.NORMAL, 'the next round is back at the room rule speed: it votes again');
  assert.equal(pub(h).speed, PLAYBACK.NORMAL);
  h.invariants();
});

test('a checkpoint drops the open control and the speed it had set (transient fields, derived gameSpeed)', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 6009, fake: true, clientCombat: true, clients: false, instant: false }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.ok(h.drive(() => m.phase === PHASE.PREP, { ready: false }));
  assert.equal(req(h, 'p_0', 'fast').error, ERR.WRONG_PHASE, 'a control needs a running battle');
  // the state a passed control would have left, plus an open vote, at the moment the checkpoint is taken
  m.gameSpeed = PLAYBACK.SKIP;
  m.matchControl = { id: 1, action: 'skip', proposerId: 'p_0', voters: ['p_0', 'p_1'], agreed: new Set(['p_0']),
    rejected: new Set(), need: 2, deadline: h.sched.now() + m.scaled(MATCH_CONTROL_MS), timer: null };
  const doc = JSON.parse(JSON.stringify(snapshotMatch(m)));
  assert.ok(doc, 'PREP is a checkpoint phase');
  assert.equal(doc.match.matchControl, undefined);
  assert.equal(doc.match.gameSpeed, undefined);
  const h2 = makeMatch({ mode: 'coop', humans: 2, seed: 6009, fake: true, clientCombat: true, clients: false, instant: false });
  t.after(() => h2.m.dispose());
  assert.equal(restoreMatch(h2.m, doc, { createRngFromState }), true);
  assert.equal(h2.m.matchControl, null);
  assert.equal(h2.m._matchControlSeq, 0);
  assert.equal(h2.m._matchControlAt.size, 0);
  assert.equal(h2.m.gameSpeed, GAME_SPEED, 'the restored match runs at the default speed');
});

test('the pause is a control too: co-op needs the whole room, and the vote is what authorizes it', (t) => {
  const h = battle({ mode: 'coop', humans: 2, bots: 1, seed: 6010 });
  t.after(() => h.m.dispose());
  const m = h.m;
  const f = m.fields[0];
  assert.deepEqual(req(h, 'p_0', 'pause'), { ok: true });
  assert.equal(m.paused, false, 'nothing is frozen before the room agrees');
  assert.equal(pub(h).paused, false);
  assert.equal(m.matchControl.action, 'pause');
  const el = m._fieldElapsed(f);
  assert.deepEqual(ballot(h, 'p_1', true), { ok: true });
  assert.equal(m.paused, true);
  assert.equal(pub(h).paused, true);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlPassed', voteId: 1, action: 'pause', agreed: 2, need: 2, solo: false, speed: m.gameSpeed });
  h.sched.advance(5000);
  assert.ok(Math.abs(m._fieldElapsed(f) - el) < 1e-9, 'the frozen match did not advance its clock');
  assert.deepEqual(req(h, 'p_1', 'resume'), { ok: true });
  assert.equal(m.paused, true, 'the resume is a request too, and p_0 has not answered it');
  assert.equal(m.matchControl.id, 2);
  assert.deepEqual(ballot(h, 'p_0', true), { ok: true });
  assert.equal(m.paused, false);
  assert.deepEqual(h.lastBc('m.notice'), { t: 'm.notice', kind: 'controlPassed', voteId: 2, action: 'resume', agreed: 2, need: 2, solo: false, speed: m.gameSpeed });
  h.sched.advance(300);
  assert.deepEqual(req(h, 'p_0', 'resume'), { ok: true }, 'a resume with nothing paused is a no-op');
  h.invariants();
});
