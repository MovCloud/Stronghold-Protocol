// test/lobby-card.test.js — room.card (名片干员, PR #643 split 6) end to end over WebSocket: the wire check, the
// whitelist (a chess record's charId or the 自选 owned pool — a stand-in body or an unknown id is refused), the avatar
// field (an operator id or a well-formed `<kind>:<key>` source id of shared/avatarSources.js — shape only, the picture
// is resolved from the deployed manifest on the client), storage
// on the session (it follows the player into the next room) and the seat, room.state seats[].card for every member (human seats with a
// card only), '' clearing it, the documented change budget (CARD_CHANGES per CARD_WINDOW_MS, RATE beyond), and no phase
// gate (cosmetic: a running match is neither asked nor refused).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { CARD_CHANGES } from '../server/lobby.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { BG_SHIFT_DEFAULT } from '../shared/playerCard.js';
import { getData } from '../server/data.js';
import { cardOperators } from '../public/js/ui/seatArt.js';

const OPERATOR = 'char_498_inside';   // 隐现 (chess.json)
const OTHER = 'char_1012_skadi2';     // 浊心斯卡蒂 (chess.json)
const STAND_IN = 'char_600_cpione';   // a 补位 body (backups.units), no chess record
const DIY_ONLY = 'char_003_kalts';    // a 自选 operator (backups.diy.ownedPool), no chess record
const HIDDEN = 'char_616_pithst';     // a hidden preset: a chess record the client picker does not list

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
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
const quietLog = () => ({ info() {}, warn() {}, debug() {}, error() {} });
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
async function createRoom(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'FUNNY' });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id);

describe('room.card (lobby, stub match)', () => {
  let srv;
  let pool;
  before(async () => {
    // a burst large enough for the test that walks the whole picker list
    srv = await startServer({ port: 0, host: '127.0.0.1', log: quietLog(), MatchClass: StubMatch, heavyBurst: 400, heavyPerSec: 4, rateBurst: 400 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('the wire check: a charId or "" passes; a chess id, a number or junk is BAD_MSG; a field left out keeps the stored value', async () => {
    const c = await pool.player('Wire');
    await ok(c, { t: 'room.card', charId: OPERATOR });
    await ok(c, { t: 'room.card', charId: '' });
    for (const charId of ['chess_char_1_01_a', 7, null, 'char_498 inside', `char_1_${'x'.repeat(70)}`]) {
      await err(c, { t: 'room.card', charId }, ERR.BAD_MSG);
    }
    // every field is optional (network.md §fork lobby): a message that names none changes nothing
    await ok(c, { t: 'room.card' });
  });

  test('the whitelist is the game data the server knows: a chess record or the 自选 owned pool passes; a stand-in body or an unknown id is refused, the stored card stays', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.card', charId: OPERATOR });
    await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.charId === OPERATOR);
    // network.md §fork lobby additions: the server checks the format and that the id is a chess record's charId or a
    // member of the 自选 owned pool — it does not ask whether the client's picker lists it.
    for (const charId of [HIDDEN, DIY_ONLY]) await ok(host, { t: 'room.card', charId });
    for (const charId of [STAND_IN, 'char_999_nobody']) {
      const r = await err(host, { t: 'room.card', charId }, ERR.BAD_MSG);
      assert.match(JSON.stringify(r), /unknown operator/);
    }
    // a refused message changes nothing: the card the last accepted one set stays
    await ok(host, { t: 'room.card', charId: OPERATOR });
    await ok(host, { t: 'room.addBot' });
    const st = await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    assert.equal(seatOf(st, host.id).card?.charId, OPERATOR);
  });

  test('the avatar field: a charId or a well-formed <kind>:<key> source id (shared/avatarSources.js) passes the wire check; a malformed key is refused', async () => {
    const c = await pool.player('AvatarShape');
    // shape only: the server does not ask whether the key is in the tables or whether the file is on disk — the picture
    // is resolved from the deployed manifest on the client, the same rule as an unknown but legal skin id.
    for (const avatar of ['bond:yanShip', 'band:band_bldsk', 'enemy:enemy_1000_gopro_2', 'camp:rhodes', 'loading:core', 'camp:notafaction']) {
      await ok(c, { t: 'room.card', avatar });
    }
    for (const avatar of ['bond', 'bond:../assets', 'loading:core;drop', 'https://example.com/a.png', 7, null]) {
      await err(c, { t: 'room.card', avatar }, ERR.BAD_MSG);
    }
  });

  test('the reserved 头像包 form passes on shape (nothing is registered yet, so the client draws nothing)', async () => {
    const c = await pool.player('AvatarPack');
    await ok(c, { t: 'room.card', avatar: 'pack:ark/rockr' });
  });

  test('a source avatar is stored and echoed like an operator avatar', async () => {
    const host = await pool.player('AvatarSeat');
    await createRoom(host);
    for (const avatar of ['bond:yanShip', 'band:band_bldsk', 'enemy:enemy_1000_gopro_2', 'camp:rhodes', 'loading:core']) {
      await ok(host, { t: 'room.card', avatar });
      const st = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.avatar === avatar);
      assert.equal(seatOf(st, host.id).card.avatar, avatar, 'stored as the client sent it');
    }
    // an operator avatar still passes (the old saves keep working)
    await ok(host, { t: 'room.card', avatar: OPERATOR });
    const st = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.avatar === OPERATOR);
    assert.equal(seatOf(st, host.id).card.avatar, OPERATOR);
  });

  test('the 立绘 crop anchor: an integer percent 0–100 passes, a float / out of range is refused; the default stores nothing', async () => {
    const host = await pool.player('Crop');
    await createRoom(host);
    for (const bgShift of [0, 100, 61]) await ok(host, { t: 'room.card', bgShift });
    for (const bgShift of [101, -1, 24.5, '24', null]) await err(host, { t: 'room.card', bgShift }, ERR.BAD_MSG);
    // the default anchor stores nothing: an unadjusted card keeps the shape it had before the crop window existed
    await ok(host, { t: 'room.card', bg: 'skin:char_103_angel_wild_1', bgShift: BG_SHIFT_DEFAULT });
    const st = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.bg);
    assert.ok(!('bgShift' in seatOf(st, host.id).card), 'the default is not stored');
    await ok(host, { t: 'room.card', bgShift: 61 });
    const moved = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.bgShift === 61);
    assert.equal(seatOf(moved, host.id).card.bgShift, 61, 'the anchor travels with the card to the teammates');
  });

  test('the server takes every operator the client picker lists (ui/seatArt.js cardOperators), in a room too', async () => {
    const list = cardOperators(Object.values(getData().chess)).map((c) => c.charId);
    assert.ok(list.length > 100);
    const c = await pool.player('All');
    await createRoom(c, 'solo');
    const session = srv.registry.byId(c.id);
    // The documented budget (network.md §fork lobby additions): CARD_CHANGES changes per CARD_WINDOW_MS per session,
    // RATE beyond. The first CARD_CHANGES pass, the next one is refused; the bucket is then released per change so the
    // whole picker list is still walked operator by operator.
    for (const charId of list.slice(0, CARD_CHANGES)) await ok(c, { t: 'room.card', charId });
    await err(c, { t: 'room.card', charId: list[CARD_CHANGES] }, ERR.RATE);
    for (const charId of list.slice(CARD_CHANGES + 1)) {
      srv.lobby.cardBuckets.delete(session);
      await ok(c, { t: 'room.card', charId });
    }
  });

  test('every member sees it as room.state seats[].card; "" clears it; bots and card-less seats carry no key', async () => {
    const host = await pool.player('Host');
    const guest = await pool.player('Guest');
    const st0 = await createRoom(host);
    assert.ok(!('card' in seatOf(st0, host.id)), 'a room without cards sends what it sent before');
    await ok(guest, { t: 'room.join', code: st0.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.card', charId: OPERATOR });
    const seen = await guest.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.charId === OPERATOR);
    assert.ok(!('card' in seatOf(seen, guest.id)), 'the guest picked none');
    await ok(host, { t: 'room.addBot' });
    const withBot = await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    assert.ok(withBot.seats.filter((x) => x && x.isBot).every((b) => !('card' in b)));
    await ok(host, { t: 'room.card', charId: '' });
    const cleared = await guest.waitFor('room.state', (s) => !!seatOf(s, host.id) && !('card' in seatOf(s, host.id)));
    assert.equal(cleared.code, st0.code);
  });

  test('the card follows the player: picked outside a room it is on the seat of the next room', async () => {
    const c = await pool.player('Early');
    await ok(c, { t: 'room.card', charId: OTHER });
    const st = await createRoom(c);
    assert.equal(seatOf(st, c.id).card?.charId, OTHER);
    await ok(c, { t: 'room.leave' });
    const again = await createRoom(c, 'solo');
    assert.equal(seatOf(again, c.id).card?.charId, OTHER);
  });

  test('cosmetic, no phase gate: accepted while the match runs and shown in room.state', async () => {
    const host = await pool.player('Solo');
    await createRoom(host, 'solo');
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    await ok(host, { t: 'room.card', charId: OPERATOR });
    const st = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card?.charId === OPERATOR);
    assert.equal(st.inMatch, true);
  });
});
