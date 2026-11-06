// test/lobby-speed.test.js — the room rule 「全局默认速度」 (room.setSpeed {speed}; room.state.speed): host-only, before the
// match, 1× or 2×; every match starts at it (opts.combatSpeed) and every round returns to it (Match.defaultSpeed —
// test/match/match-control.test.js). A 快进/60× that a vote won lasts only for the battle it was voted in.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, PLAYBACK } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
async function createRoom(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'NORMAL' });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}
async function joinRoom(c, code) {
  await ok(c, { t: 'room.join', code });
  return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
}

/** StubMatch that records the options each match was started with. */
const started = [];
class RecordingMatch extends StubMatch {
  constructor(opts) {
    super(opts);
    started.push(opts);
  }
}

test('protocol: room.setSpeed takes exactly 1× or 2×', () => {
  assert.equal(validateC2S({ t: 'room.setSpeed', speed: PLAYBACK.NORMAL }), null);
  assert.equal(validateC2S({ t: 'room.setSpeed', speed: PLAYBACK.FAST }), null);
  for (const speed of [undefined, null, 0, 1.5, 3, PLAYBACK.SKIP, '1', '2', {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.setSpeed', speed }), null, JSON.stringify(speed));
  }
});

describe('room.setSpeed (lobby)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('defaults to 2×; the host picks 1× or 2×; every seat sees it; a change un-readies the guests', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    assert.equal(st.speed, PLAYBACK.FAST, 'the fast-forward is the default rule');
    const guest = await pool.player('Guest');
    const js = await joinRoom(guest, st.code);
    assert.equal(js.speed, PLAYBACK.FAST);
    await err(guest, { t: 'room.setSpeed', speed: PLAYBACK.NORMAL }, ERR.NOT_HOST);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.setSpeed', speed: PLAYBACK.NORMAL });
    const one = await guest.waitFor('room.state', (s) => s.speed === PLAYBACK.NORMAL);
    assert.equal(seatOf(one, guest.id).ready, false, 'the rule changed: the guest confirms again');
    await host.waitFor('room.state', (s) => s.speed === PLAYBACK.NORMAL);
    // the same value again changes nothing (no broadcast needed, still ok)
    await ok(host, { t: 'room.setSpeed', speed: PLAYBACK.NORMAL });
    await ok(host, { t: 'room.setSpeed', speed: PLAYBACK.FAST });
    await guest.waitFor('room.state', (s) => s.speed === PLAYBACK.FAST);
    // a value outside 1×/2× never reaches the lobby
    await err(host, { t: 'room.setSpeed', speed: PLAYBACK.SKIP }, ERR.BAD_MSG);
  });

  test('the match gets it as combatSpeed; it cannot change during the match; the room keeps it for the next match', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    await ok(host, { t: 'room.addBot' });
    await ok(host, { t: 'room.setSpeed', speed: PLAYBACK.NORMAL });
    await host.waitFor('room.state', (s) => s.speed === PLAYBACK.NORMAL);
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch && s.speed === PLAYBACK.NORMAL);
    assert.equal(started.length, n + 1);
    assert.equal(started[n].combatSpeed, PLAYBACK.NORMAL, 'opts.combatSpeed');
    await err(host, { t: 'room.setSpeed', speed: PLAYBACK.FAST }, ERR.ROOM_STARTED);
    // the stub match ends once every human confirmed the briefing → back in the lobby with the rule kept
    host.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    const back = await host.waitFor('room.state', (s) => !s.inMatch);
    assert.equal(back.speed, PLAYBACK.NORMAL);
  });

  test('without a choice the match gets the default 2×', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.addBot' });
    const n = started.length;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch);
    assert.equal(started[n].combatSpeed, PLAYBACK.FAST);
  });
});
