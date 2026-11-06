// test/state-delta-format.test.js — the delta state wire format (shared/stateDelta.js) on its own.
// Extracted verbatim from test/state-delta.test.js (authored by @xinhai-ai) so that the format can be merged
// and reviewed before the lobby / client wiring that consumes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffState, applyStatePatch, StateReceiver } from '../shared/stateDelta.js';
import { prepareStateFrame, negotiateStateDelta, resetStateDelta } from '../server/stateTransport.js';

const makeView = (extra = {}) => ({ t: 'm.private', playerId: 'p1', funds: 10,
  board: [{ uid: 1, row: 2, col: 3, items: [] }], padding: 'unchanged'.repeat(300), ...extra });

test('JSON exactness: object deletes/adds, nulls, array length/type changes, nested player/board fields', () => {
  const before = { t: 'm.public', removed: 2, nullable: { x: 1 }, players: [{ hp: 12, board: [null, { col: 4 }] }], empty: [] };
  const after = { t: 'm.public', added: false, nullable: null, players: [{ hp: 8, board: [null, { col: 5, dir: 'UP' }] }], empty: [1] };
  const saved = structuredClone(before);
  assert.deepEqual(applyStatePatch(before, diffState(before, after)), after);
  assert.deepEqual(before, saved);
  let seed = 17;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const value = (depth) => {
    const n = random();
    if (!depth) return [null, true, false, n, String(n)][n % 5];
    if (n % 3 === 0) return Array.from({ length: n % 5 }, () => value(depth - 1));
    if (n % 3 === 1) return Object.fromEntries(Array.from({ length: n % 5 }, (_, i) => ['k' + i, value(depth - 1)]));
    return value(0);
  };
  for (let i = 0; i < 500; i++) {
    const a = { t: 'm.private', data: value(4) }, b = { t: 'm.private', data: value(4) };
    assert.deepEqual(applyStatePatch(a, diffState(a, b)), b);
  }
});

test('unsafe/malformed patches are rejected atomically; previous views and prototypes stay intact', () => {
  const base = makeView();
  for (const op of [
    [['__proto__', 'polluted'], true], [['constructor', 'prototype', 'polluted'], true],
    [['board', -1], null], [['board', '0'], null], [['board', 0]], [['absent', 'x'], 1],
    [['t'], 'm.public'], [[], null], [['funds'], 1, 2],
  ]) {
    assert.throws(() => applyStatePatch(base, [[['funds'], 0], op]));
    assert.equal(base.funds, 10);
    assert.equal({}.polluted, undefined);
  }
  assert.equal(diffState({}, JSON.parse('{"__proto__":{"x":1}}')), null);
  assert.equal(diffState({ t: 'm.private' }, {
    t: 'm.private', ...Object.fromEntries(Array.from({ length: 4097 }, (_, i) => ['k' + i, i])),
  }), null, 'bounded op count falls back to full');
  const deep = (leaf) => { for (let i = 0; i < 70; i++) leaf = { value: leaf }; return { t: 'm.private', nested: leaf }; };
  assert.equal(diffState(deep(1), deep(2)), null, 'bounded path depth falls back to full');
});

const wire = (text) => JSON.parse(text);
const fakeWs = () => ({});

test('the sequence is reserved per encoding and never rewinds; a new encoding takes a new number', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const msg = { t: 'm.public', players: [{ hp: 10 }], padding: 'x'.repeat(500) };
  const first = prepareStateFrame(ws, msg, JSON.stringify(msg));
  const n1 = wire(first.data).seq;
  assert.ok(Number.isSafeInteger(n1) && n1 > 0, 'the first frame of a connection carries a reserved number');
  assert.ok('full' in wire(first.data), 'the first frame of a connection is a full one');
  first.commit();

  // the same content again is still a full frame. The number is the reservation taken for that encoding and is
  // shared with every recipient of the same broadcast (net-fanout encodes once), so it does not move here; the
  // client emits a full frame regardless of the number it has already seen.
  const repeated = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(repeated.data).seq, n1, 'the same encoding keeps its reservation');
  assert.ok('full' in wire(repeated.data));
  repeated.commit();

  // new content: a delta based on the frame the client actually holds
  msg.players[0].hp = 11;
  const delta = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.ok(wire(delta.data).seq > n1, 'a new encoding takes a new number');
  assert.equal(wire(delta.data).base, n1);
  delta.commit();

  // content that goes back to an earlier encoding must not reuse that encoding's old number
  msg.players[0].hp = 10;
  const back = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.ok(wire(back.data).seq > wire(delta.data).seq, 'the number never rewinds to a snapshot created earlier');
});

test('a full frame takes the baseline; a delta that cannot name it blocks the lane until the next full frame', () => {
  const receiver = new StateReceiver();
  const newer = { t: 'm.public', round: 3 };
  assert.deepEqual(receiver.receive({ kind: 'm.public', seq: 9, full: newer }).message, newer,
    'the receiver hands the UI a copy of the view (§8), not the frame object itself');
  // the transport is reliable and ordered (§8), so a full frame is the newest view the server has and takes the
  // baseline; a delta that cannot name that baseline is not applied and blocks the lane
  const gap = receiver.receive({ kind: 'm.public', seq: 10, base: 8, patch: [] });
  assert.deepEqual(gap, { failed: true, resync: true }, 'the gap asks for one full frame');
  const recovered = { t: 'm.public', round: 4 };
  assert.deepEqual(receiver.receive({ kind: 'm.public', seq: 11, full: recovered }).message, recovered,
    'a full frame ahead of the baseline puts it back in service');
  const next = { t: 'm.public', round: 5 };
  assert.deepEqual(receiver.receive({ kind: 'm.public', seq: 12, base: 11, patch: diffState(recovered, next) }).message, next);
  // a full frame is emitted again even when its number was already seen: on a resync the server re-sends the
  // unchanged encoding, and that encoding keeps the reservation the client last saw. Dropping it here would
  // leave the lane blocked forever.
  assert.deepEqual(receiver.receive({ kind: 'm.public', seq: 12, full: next }).message, next);
});

test('the private view rides the delta channel too (DESIGN §8): a full frame, then a patch', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const view = { t: 'm.private', playerId: 'p1', funds: 10, padding: 'q'.repeat(500) };
  const encoded = JSON.stringify(view);
  const first = prepareStateFrame(ws, view, encoded);
  assert.ok('full' in wire(first.data), 'the first private frame of a connection is a full one');
  first.commit();
  view.funds = 11;
  const second = wire(prepareStateFrame(ws, view, JSON.stringify(view)).data);
  assert.equal(second.kind, 'm.private');
  assert.ok(Array.isArray(second.patch) && second.patch.length, 'the second private frame is a patch');
});

test('a repeated hello keeps the baseline, and a reset never rewinds the sequence', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const msg = { t: 'm.public', players: [{ hp: 1 }], padding: 'y'.repeat(500) };
  const first = prepareStateFrame(ws, msg, JSON.stringify(msg));
  first.commit();

  negotiateStateDelta(ws, 1);                       // a repeated hello on the same connection
  msg.players[0].hp = 2;
  const second = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(second.data).base, wire(first.data).seq, 'the baseline survived the repeated hello');
  second.commit();

  resetStateDelta(ws);                              // a new negotiation, or a client asking for a resync
  msg.players[0].hp = 3;
  const third = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.ok('full' in wire(third.data), 'after a reset the client gets a full frame');
  assert.ok(wire(third.data).seq > wire(second.data).seq, 'and its number is still ahead of the last one');
});

test('the browser decoder applies deltas, asks for one resync after a gap, and resumes on a full frame', () => {
  const receiver = new StateReceiver();
  const view = { t: 'm.private', funds: 10, padding: 'z'.repeat(300) };
  assert.deepEqual(receiver.receive({ kind: 'm.private', seq: 1, full: view }).message, view,
    'the handed-out view is a private copy the UI may mutate');
  const next = { ...view, funds: 11 };
  const applied = receiver.receive({ kind: 'm.private', seq: 2, base: 1, patch: diffState(view, next) });
  assert.deepEqual(applied.message, next);
  assert.equal(applied.resync, false);
  const after = { ...next, funds: 12 };
  assert.deepEqual(receiver.receive({ kind: 'm.private', seq: 3, base: 2, patch: diffState(next, after) }).message, after);
  assert.equal(receiver.receive({ kind: 'm.private', seq: 3, base: 2, patch: diffState(next, after) }), null,
    'the same delta twice is never emitted twice');

  // a lost frame: the next delta cannot be applied, so the channel waits for a full frame
  const lost = receiver.receive({ kind: 'm.private', seq: 6, base: 5, patch: [] });
  assert.deepEqual(lost, { failed: true, resync: true }, 'the gap asks for a resync');
  assert.equal(receiver.receive({ kind: 'm.public', seq: 9, base: 8, patch: [] }).resync, false,
    'one resync request covers every channel');
  assert.equal(receiver.receive({ kind: 'm.private', seq: 7, base: 6, patch: [] }).resync, false,
    'and further deltas do not ask again while the channel is blocked');

  const resumed = receiver.receive({ kind: 'm.private', seq: 8, full: after });
  assert.deepEqual(resumed.message, after, 'the full frame puts the channel back in service');
  const later = { ...after, funds: 13 };
  assert.deepEqual(receiver.receive({ kind: 'm.private', seq: 9, base: 8, patch: diffState(after, later) }).message, later);
});

test('a connection that did not negotiate keeps the frames it gets today', () => {
  const ws = fakeWs();
  const encoded = JSON.stringify({ t: 'm.private', funds: 1 });
  const plain = prepareStateFrame(ws, { t: 'm.private' }, encoded);
  assert.equal(plain.data, encoded, 'the encoded message goes out untouched');
  plain.commit();                                   // a no-op: nothing was baselined

  negotiateStateDelta(ws, 2);                       // a version this server does not speak
  assert.equal(prepareStateFrame(ws, { t: 'm.private' }, encoded).data, encoded);

  const receiver = new StateReceiver();
  assert.deepEqual(receiver.receive({ t: 'm.private', funds: 1 }), { failed: true, resync: false },
    'a message without a kind/seq is not a state frame, so there is no lane to block');
  assert.deepEqual(receiver.receive({ kind: 'm.private' }), { failed: true, resync: true },
    'a state frame that cannot be used blocks the channel and asks for a full one');
});
