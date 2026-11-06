// test/http-boot-limits.test.js — the caps in effect are printed once when the session stack is built.
//
// The line is the configuration the server is running with, not a reason for a particular rejection. In this fork every
// cap defaults to 0 and a 0 cap is unlimited — lobby.js and net.js enforce a cap only when it is positive — so a 0
// prints as "unlimited"; the limits file (server/onlineLimit.js) is what sets real caps while the server runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStack } from '../server/http/websocket.js';
import { NET_DEFAULTS } from '../server/net.js';
import { LOBBY_DEFAULTS } from '../server/lobby.js';

/** How a cap prints on boot: 0 is unlimited here, as lobby.js / net.js treat it. */
const cap = (n) => (n > 0 ? n : 'unlimited');

/** Build the stack with `opts` and no SP_MAX_* in the environment; return what `log.info` was given. */
function logLines(opts = {}) {
  const saved = new Map();
  for (const k of ['SP_MAX_ROOMS', 'SP_MAX_ROOMS_PER_ADDR', 'SP_MAX_MATCHES_PER_ADDR', 'SP_MAX_CONNECTIONS', 'SP_MAX_CONNECTIONS_PER_ADDR']) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  const lines = [];
  const log = { info: (m) => lines.push(m), warn() {}, debug() {}, error() {} };
  try {
    createSessionStack(opts, { data: {}, log });
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return lines;
}

test('the defaults are printed as they are', () => {
  const lines = logLines();
  assert.equal(lines.length, 1, 'exactly one line on boot');
  assert.equal(lines[0], `[http] limits: rooms ${cap(LOBBY_DEFAULTS.maxRooms)} (${cap(LOBBY_DEFAULTS.maxRoomsPerAddr)}/network), `
    + `matches ${cap(LOBBY_DEFAULTS.maxMatchesPerAddr)}/network, `
    + `sockets ${cap(NET_DEFAULTS.maxConnections)} (${cap(NET_DEFAULTS.maxConnectionsPerAddr)}/network)`);
});

test('an explicit cap is printed, and a 0 cap reads as unlimited', () => {
  const lines = logLines({ maxRooms: 5, maxConnections: 100, maxConnectionsPerAddr: 0, maxMatchesPerAddr: 0 });
  assert.equal(lines[0], '[http] limits: rooms 5 (unlimited/network), matches unlimited/network, sockets 100 (unlimited/network)');
});

test('a 0 cap prints as unlimited, a positive per-network cap as itself', () => {
  const lines = logLines({ maxRooms: 0, maxRoomsPerAddr: 16, maxConnections: 0, maxConnectionsPerAddr: 64 });
  assert.match(lines[0], /rooms unlimited \(16\/network\)/, 'a 0 room cap is unlimited here, not a rejection');
  assert.match(lines[0], /sockets unlimited \(64\/network\)/, 'a 0 socket cap is unlimited here, not a rejection');
});
