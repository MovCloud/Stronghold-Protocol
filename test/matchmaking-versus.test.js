// test/matchmaking-versus.test.js — the 2V2 side in same-capacity matchmaking (server/matchmaking.js) and the room
// shape the lobby hands it (Lobby#versusPartyShape, server/lobby.js). A party is indivisible and the pool key carries
// the room mode, so a complete 2V2 side (one team full, the other empty) never merges with a partial four-player co-op
// group; two such sides allocate one four-seat versus room with mode 'versus'.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Matchmaking } from '../server/matchmaking.js';
import { Lobby } from '../server/lobby.js';
import { MATCHMAKING_VERSION, MAX_SEATS, TEAM_SIZE } from '../shared/constants.js';

const session = (id) => ({
  playerId: id, matchmakingVersion: MATCHMAKING_VERSION, matchmakingResult: null, roomCode: null, limitKey: null,
});

/** A queue whose members factory reads the party table by the joining session's id; solos fall back to one seat. */
const makeQueue = (parties, allocate) => {
  const sent = [];
  const queue = new Matchmaking({
    send: (s, message) => sent.push({ id: s.playerId, message }),
    available: () => true,
    members: (s) => parties[s.playerId] || { sessions: [s], roomCode: null, leaderId: s.playerId },
    allocate: allocate || ((sessions) => { for (const s of sessions) s.roomCode = 'MM01'; return { code: 'MM01' }; }),
  });
  return { queue, sent };
};

const entryOf = (queue, s) => queue.entries.get(s.playerId);
const offerOf = (queue, s) => queue.offers.get(entryOf(queue, s).offerId);

describe('a 2V2 side is one same-capacity party', () => {
  test('one full team and one empty team queue as one party needing four seats', () => {
    const a = session('a'), b = session('b');
    const { queue } = makeQueue({
      a: { sessions: [a, b], roomCode: 'R1', leaderId: 'a', mode: 'versus' },
    });
    assert.equal(queue.join(a, { difficulty: 'NORMAL' }).ok, true);
    const state = queue.state(a);
    assert.equal(state.state, 'queued');
    assert.equal(state.mode, 'versus');
    assert.equal(state.required, MAX_SEATS);
    assert.equal(state.partySize, TEAM_SIZE);
    assert.equal(state.waitingCount, TEAM_SIZE);
    assert.equal(queue.offers.size, 0);
    queue.close();
  });

  test('the pool key carries the mode: a versus side never pairs with a two-player co-op group', () => {
    const v1 = session('v1'), v2 = session('v2'), c1 = session('c1'), c2 = session('c2');
    const { queue } = makeQueue({
      v1: { sessions: [v1, v2], roomCode: 'V1', leaderId: 'v1', mode: 'versus' },
      c1: { sessions: [c1, c2], roomCode: 'C1', leaderId: 'c1', mode: 'coop' },
    });
    assert.equal(queue.join(v1, { difficulty: 'NORMAL' }).ok, true);
    assert.equal(queue.join(c1, { difficulty: 'NORMAL' }).ok, true);
    // Both parties need four seats, but two 2V2 sides and two four-player co-op half-groups are different matches.
    assert.equal(queue.offers.size, 0);
    assert.equal(queue.poolKey(entryOf(queue, v1)), `${MATCHMAKING_VERSION}:versus:NORMAL:${MAX_SEATS}`);
    assert.equal(queue.poolKey(entryOf(queue, c1)), `${MATCHMAKING_VERSION}:coop:NORMAL:${MAX_SEATS}`);
    queue.close();
  });

  test('two versus sides form one offer and allocate one 2V2 room', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(session);
    const allocated = [];
    const { queue } = makeQueue({
      a: { sessions: [a, b], roomCode: 'R1', leaderId: 'a', mode: 'versus' },
      c: { sessions: [c, d], roomCode: 'R2', leaderId: 'c', mode: 'versus' },
    }, (sessions, difficulty) => {
      allocated.push({ ids: sessions.map((s) => s.playerId), difficulty });
      for (const s of sessions) s.roomCode = 'MM01';
      return { code: 'MM01' };
    });
    assert.equal(queue.join(a, { difficulty: 'NORMAL' }).ok, true);
    assert.equal(queue.join(c, { difficulty: 'NORMAL' }).ok, true);

    const offer = offerOf(queue, a);
    assert.equal(offer.mode, 'versus');
    assert.equal(offer.required, MAX_SEATS);
    assert.deepEqual(offer.entries.map((e) => e.session.playerId), ['a', 'b', 'c', 'd']);
    for (const s of [a, b, c, d]) {
      assert.equal(queue.accept(s, { ticketId: entryOf(queue, s).ticketId, offerId: offer.id }).ok, true);
    }
    assert.deepEqual(allocated, [{ ids: ['a', 'b', 'c', 'd'], difficulty: 'NORMAL' }]);

    const state = queue.state(a);
    assert.equal(state.state, 'matched');
    assert.equal(state.mode, 'versus');
    assert.equal(state.required, MAX_SEATS);
    assert.equal(state.code, 'MM01');
    queue.close();
  });

  test('two co-op parties of two still merge into a four-player room', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(session);
    const { queue } = makeQueue({
      a: { sessions: [a, b], roomCode: 'R1', leaderId: 'a', mode: 'coop' },
      c: { sessions: [c, d], roomCode: 'R2', leaderId: 'c', mode: 'coop' },
    });
    assert.equal(queue.join(a, { difficulty: 'NORMAL' }).ok, true);
    assert.equal(queue.join(c, { difficulty: 'NORMAL' }).ok, true);
    const offer = offerOf(queue, a);
    assert.equal(offer.mode, 'coop');
    assert.deepEqual(offer.entries.map((e) => e.session.playerId), ['a', 'b', 'c', 'd']);
    queue.close();
  });
});

describe('Lobby#versusPartyShape: the room that counts as one side', () => {
  const shape = (room) => Lobby.prototype.versusPartyShape.call({}, room);
  const room = (mode, seats, capacity = MAX_SEATS) => ({ mode, capacity, activeHumans: () => seats.map((seat) => ({ seat })) });

  test('one full team (seats 0/1 or 2/3) with the other team empty', () => {
    assert.equal(shape(room('versus', [0, 1])), true);
    assert.equal(shape(room('versus', [2, 3])), true);
    assert.equal(shape(room('versus', [0])), false, 'a lone player is not a complete side');
    assert.equal(shape(room('versus', [0, 1, 2])), false, 'more than one team is not one side');
    assert.equal(shape(room('versus', [0, 2])), false, 'split seats are not one team');
  });

  test('only a versus room can be a 2V2 side', () => {
    assert.equal(shape(room('coop', [0, 1])), false);
    assert.equal(shape(room('solo', [0])), false);
    assert.equal(shape(null), false);
  });
});
