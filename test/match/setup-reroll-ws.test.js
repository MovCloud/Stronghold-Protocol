import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../../public/js/ui/toasts.js';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { ERR } from '../../shared/constants.js';

const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
};
const err = async (c, msg, code) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'error', JSON.stringify(r));
  assert.equal(r.code, code, JSON.stringify(r));
};
const setupOf = (pub) => ({ stageId: pub.stageId, bossId: pub.bossId, hiddenBossId: pub.hiddenBossId,
  factions: pub.factions, disabledBonds: pub.disabledBonds, bannedChess: pub.bannedChess, setupRevision: pub.setupRevision });

test('real four-player sockets: host-only proposal in a private room, ¾ sync, reconnect and stale requests', { timeout: 15000 }, async (t) => {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', seedFn: () => 123,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
    assert.deepEqual(errors, []);
  });
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'HARD' });
  const room = await host.waitFor('room.state');
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const c = await player(`Guest${i}`);
    guests.push(c);
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  const spectator = await player('Viewer');
  await ok(spectator, { t: 'room.spectate', code: room.code });
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  // fork: a guest of a private room may not propose, only the host (server/lobby.js Lobby.rerollSetup)
  await err(guests[0], { t: 'room.rerollSetup', setupRevision: 0 }, ERR.NOT_HOST);
  await err(spectator, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.SPECTATOR);
  await ok(guests[0], { t: 'g.infoReady', setupRevision: 0 });
  await ok(host, { t: 'room.rerollSetup', setupRevision: 0 });
  const voting = await host.waitFor('m.public', (p) => !!p.rerollVote);
  // fork §32.14.45: the proposal pauses the briefing clock (deadline 0) while the vote keeps its own window
  assert.equal(voting.deadline, 0);
  assert.equal(voting.rerollVote.voters.length, 4);
  assert.deepEqual(voting.rerollVote.agreed, [host.id]);
  assert.equal(voting.rerollVote.need, 3, '¾ of 4 voters');
  const voteId = voting.rerollVote.id;
  await err(spectator, { t: 'g.rerollVote', voteId, agree: true }, ERR.SPECTATOR);
  await err(guests[0], { t: 'room.cancelReroll', voteId }, ERR.NOT_HOST);
  await ok(guests[0], { t: 'g.rerollVote', voteId, agree: false });
  await ok(guests[1], { t: 'g.rerollVote', voteId, agree: true });
  assert.equal(m.setupRevision, 0, '2/4 agrees never refreshes');
  await ok(guests[2], { t: 'g.rerollVote', voteId, agree: true }); // 3 of the 4 reaches need → the vote passes
  assert.equal(m.setupRevision, 1, 'the ¾ vote refreshes the setup');
  const all = [host, ...guests, spectator];
  const fresh = await Promise.all(all.map((c) => c.waitFor('m.public', (p) => p.setupRevision === 1)));
  for (const p of fresh) {
    assert.deepEqual(setupOf(p), setupOf(fresh[0]));
    assert.equal(p.deadline, fresh[0].deadline, 'all players share the same new deadline');
    assert.equal(Math.ceil((p.deadline - p.serverNow) / 1000), 45, 'each player sees a fresh 45-second countdown');
    assert.equal(p.rerollVote, null);
    assert.ok(p.players.every((ps) => !ps.ready));
  }
  assert.notDeepEqual(setupOf(fresh[0]), { ...setupOf(initial), setupRevision: 1 });
  assert.equal(srv.lobby.rooms.get(room.code).match, m, 'room/match instance and sockets retained');
  assert.ok(all.every((c) => c.isOpen));
  await err(guests[0], { t: 'g.infoReady', setupRevision: 0 }, ERR.BAD_TARGET);
  await err(guests[0], { t: 'g.infoReady' }, ERR.BAD_TARGET);
  await err(host, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.BAD_TARGET);
  // A completed reroll opens a fresh 30 s window; in a private room only the host starts and cancels.
  await new Promise((resolve) => setTimeout(resolve, 310)); // fork's 300 ms request guard (setupVote.js)
  await ok(host, { t: 'room.rerollSetup', setupRevision: 1 });
  const again = await host.waitFor('m.public', (p) => p.rerollVote && p.rerollVote.id > voteId);
  await err(guests[1], { t: 'room.cancelReroll', voteId: again.rerollVote.id }, ERR.NOT_HOST);
  await ok(host, { t: 'room.cancelReroll', voteId: again.rerollVote.id });
  await host.waitFor('m.public', (p) => !p.rerollVote && p.deadline > 0);
  // the cancelled vote keeps the cooldown; the toast names that limit, not the generic RATE text (PR #860 review)
  const cooled = await host.request({ t: 'room.rerollSetup', setupRevision: 1 });
  assert.deepEqual([cooled.t, cooled.code, cooled.detail], ['error', ERR.RATE, 'setup reroll cooldown']);
  assert.equal(describeError(cooled), '每人 30 秒内只能发起一次重刷投票');
  assert.equal(describeError({ code: ERR.RATE }), '操作过于频繁', 'other RATE refusals keep the generic text');
  // Disconnect/reconnect retains this room and returns the current full setup.
  const guest = guests[2];
  await guest.terminate();
  await host.waitFor('m.public', (p) => p.setupRevision === 1 && p.players.some((ps) => ps.playerId === guest.id && !ps.connected));
  const resumed = await player('Guest2', guest.token);
  assert.equal(resumed.id, guest.id);
  assert.deepEqual(setupOf(await resumed.waitFor('m.public', (p) => p.setupRevision === 1)), setupOf(fresh[0]));
  const restoredRoom = await resumed.waitFor('room.state');
  assert.equal(restoredRoom.code, room.code);
  for (const c of [host, guests[0], guests[1], resumed]) await ok(c, { t: 'g.infoReady', setupRevision: 1 });
  await host.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT');
  await err(host, { t: 'room.rerollSetup', setupRevision: 1 }, ERR.WRONG_PHASE);
});

test('real sockets: reject/cancel/disconnect keep the setup and resume the countdown; a matchmade room lets any seated human propose', { timeout: 15000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close(); });
  for (const name of ['Host', 'GuestA', 'GuestB']) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
  }
  const [host, guestA, guestB] = clients;
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state');
  for (const c of [guestA, guestB]) {
    await ok(c, { t: 'room.join', code: room.code });
    await ok(c, { t: 'room.ready', ready: true });
  }
  await ok(host, { t: 'room.start' });
  const initial = await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = srv.lobby.rooms.get(room.code).match;
  // one proposal per player per setup revision; a guest of a private room may not propose (Lobby.rerollSetup),
  // so the scenarios run once the room is matchmade. Each uses a different starter, because one seat may only
  // start one vote per 30 s.
  await err(guestA, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.NOT_HOST);
  const lobbyRoom = srv.lobby.rooms.get(room.code);
  lobbyRoom.source = 'matchmaking';
  const moves = [
    { starter: guestA, finish: 'reject', by: guestB },
    { starter: guestB, finish: 'cancel', by: host },
    { starter: host, finish: 'disconnect', by: guestA },
  ];
  let lastVoteId = 0;
  for (const { starter, finish, by } of moves) {
    await new Promise((resolve) => setTimeout(resolve, 310)); // the 300 ms request guard (setupVote.js)
    await ok(starter, { t: 'room.rerollSetup', setupRevision: 0 });
    // Buffered frames may still carry the previous vote, so wait for a strictly newer one.
    const voting = await starter.waitFor('m.public', (p) => p.rerollVote && p.rerollVote.id > lastVoteId);
    lastVoteId = voting.rerollVote.id;
    assert.equal(voting.rerollVote.proposerId, starter.id);
    assert.equal(voting.rerollVote.need, 3, '¾ of 3 voters rounds up');
    if (finish === 'reject') await ok(by, { t: 'g.rerollVote', voteId: lastVoteId, agree: false });
    if (finish === 'cancel') {
      // 野排 lets any seated human propose, but cancelling stays the host's
      await err(guestA, { t: 'room.cancelReroll', voteId: lastVoteId }, ERR.NOT_HOST);
      await ok(by, { t: 'room.cancelReroll', voteId: lastVoteId });
    }
    if (finish === 'disconnect') {
      // fork: a dropped voter is removed and need is recomputed from the voters left, so the vote goes on
      // (3 voters → 2, need 2) and still needs one more answer; the last seated voter declining ends it.
      await by.terminate();
      const recounted = await host.waitFor('m.public', (p) => p.rerollVote && p.rerollVote.need === 2);
      assert.equal(recounted.rerollVote.id, lastVoteId, 'the same vote continues, it is not cancelled by a drop');
      assert.deepEqual(recounted.rerollVote.voters, [host.id, guestB.id]);
      assert.deepEqual(recounted.rerollVote.agreed, [host.id]);
      await ok(guestB, { t: 'g.rerollVote', voteId: lastVoteId, agree: false });
    }
    await host.waitFor('m.public', (p) => !p.rerollVote && p.deadline > 0);
    assert.equal(m.setupRevision, 0);
    assert.deepEqual(setupOf(m.publicView()), setupOf(initial));
    // A rejected or cancelled vote does not give the starter its cooldown back.
    await err(starter, { t: 'room.rerollSetup', setupRevision: 0 }, ERR.RATE);
  }
  lobbyRoom.source = 'private';
});

test('real socket, one human: completed rerolls clear the seat cooldown, so the 300 ms request guard is what refuses an immediate second one', { timeout: 15000 }, async (t) => {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', seedFn: () => 123,
    log: { info() {}, warn() {}, debug() {}, error: (...args) => errors.push(args.map(String).join(' ')) } });
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(async () => {
    await c.terminate();
    await srv.close();
    assert.deepEqual(errors, []);
  });
  await c.hello('Solo');
  await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'HARD' });
  await ok(c, { t: 'room.start' });
  await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
  const m = [...srv.lobby.rooms.values()][0].match;
  // A lone human completes its own vote at once, so every reroll clears the seat cooldown (setupVote.js) and the
  // fork's 300 ms request guard is the limit the seat keeps hitting; MAX_SETUP_REROLLS (3) caps the match.
  await ok(c, { t: 'room.rerollSetup', setupRevision: 0 });
  assert.equal(m.setupRevision, 1);
  const guard = await c.request({ t: 'room.rerollSetup', setupRevision: 1 });
  assert.deepEqual([guard.t, guard.code, guard.detail], ['error', ERR.RATE, undefined], 'the guard, not the seat cooldown');
  let revision = 1;
  for (let i = 1; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 310));
    await ok(c, { t: 'room.rerollSetup', setupRevision: revision++ });
  }
  assert.equal(m.setupRevision, 3);
  const r = await c.request({ t: 'room.rerollSetup', setupRevision: revision });
  assert.deepEqual([r.t, r.code, r.detail], ['error', ERR.ALREADY, 'reroll-limit'], JSON.stringify(r));
  assert.equal(m.setupRevision, 3, 'the refused start rebuilds nothing');
});
