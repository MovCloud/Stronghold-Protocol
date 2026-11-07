// 2V2 双人组队匹配 (user request 2026-11-07): a versus room whose one team is full and the other one empty is ONE party,
// and the client only offers 组队匹配 then. The server re-checks the same shape (Lobby.versusPartyShape) before queuing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versusPartySlot, partyQueueReason } from '../../public/js/screens/room.js';

const seat = (playerId, extra = {}) => ({ playerId, name: playerId, ready: true, connected: true, ...extra });
const versus = (seats, extra = {}) => ({ mode: 'versus', seats, hostId: 'a', ...extra });

test('one full team and one empty team is the 2V2 party', () => {
  assert.equal(versusPartySlot(versus([seat('a'), seat('b'), null, null])), true, 'team 0 full');
  assert.equal(versusPartySlot(versus([null, null, seat('a'), seat('b')])), true, 'team 1 full');
  assert.equal(versusPartySlot(versus([null, null, null, null])), false, 'nobody seated');
  assert.equal(versusPartySlot(versus([seat('a'), null, null, null])), false, 'one player is not a whole side');
  assert.equal(versusPartySlot(versus([seat('a'), seat('b'), seat('c'), seat('d')])), false, 'a full 4-seat room is not a party');
  assert.equal(versusPartySlot(versus([seat('a'), null, null, seat('b')])), false, 'players split across both teams');
  assert.equal(versusPartySlot(versus([seat('a'), { playerId: 'bot', isBot: true }, null, null])), false, 'an AI seat does not fill the side');
  assert.equal(versusPartySlot({ mode: 'coop', seats: [seat('a'), seat('b'), null, null] }), false, 'co-op keeps its own rule');
  assert.equal(versusPartySlot(versus([seat('a'), null, null])), false, 'a malformed seat list is refused');
});

test('partyQueueReason: a valid versus party may queue, a split one is told why not', () => {
  const full = versus([seat('a'), seat('b'), null, null]);
  assert.equal(partyQueueReason(full, 'a'), null, 'host of a complete side may queue');
  assert.match(partyQueueReason(versus([seat('a'), null, null, seat('b')]), 'a'), /一支队伍满员/);
  assert.equal(versusPartySlot(full), true);
});
