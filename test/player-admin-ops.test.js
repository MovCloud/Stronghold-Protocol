// P7a admin operations over a real HTTP listener: first-boot announcement seeding (and its one-time latch),
// deleting any historic notice, the runtime maintenance switch and the plugin route registry. The drain
// semantics (room.create / room.start refuse, presence.state reaches everyone) run against a full server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { credentials, atomicJson, mountPlayerAdmin, playerSnapshot } from '../server/playerAdmin.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const PASSWORD = 'p7a-admin-password';
const quietLog = { info() {}, warn() {}, error() {} };

/** Fakes mirror the shapes playerSnapshot actually reads (server/lobby.js rooms + queue, server/net.js registry).
 *  The previous version invented activeMatchOf / matchmaker.roomQueue / matchmakingCounts, which only the mock
 *  had — the real server threw on the first player in a room and the admin UI crashed on stats.matchmaking. */
function fakes() {
  let override = false; // mirrors server/lobby.js: the runtime override wins over the (absent) limits file
  const rooms = new Map();
  const queue = { entries: new Map(), get size() { return this.entries.size; } };
  const queueByPlayer = new Map();
  const sessions = [];
  return {
    lobby: {
      maintenance: () => override,
      setMaintenanceOverride(on) { const before = override; override = on === true; return before !== override; },
      // 娱乐模式 (arcade): the admin panel's per-mode switches (server/lobby.js arcadeOpen / setArcadeMode)
      arcade: { hunt2v2: true, alliancehunt: true },
      arcadeOpen(id) { return this.arcade[id] === true; },
      arcadeInfo() { return { ...this.arcade }; },
      setArcadeMode(id, open) {
        if (!Object.hasOwn(this.arcade, id) || typeof open !== 'boolean') return false;
        const before = this.arcade[id]; this.arcade[id] = open; return before !== open;
      },
      onExpire() {}, roomOf: () => null, rooms, queue, queueByPlayer,
      roomQueued: (room) => room.activeHumans().some((seat) => queue.entries.has(seat.playerId)),
      stats: () => ({ rooms: rooms.size, matches: 0, humans: 0, bots: 0, spectators: 0, online: 0, queued: queue.size }),
    },
    network: { conns: new Map(), opts: { trustProxy: false }, moderation: null, onlineCount: 0 },
    registry: { all: () => sessions, byId: () => null, byToken: () => null, remove() {} },
    rooms, queue, queueByPlayer, sessions,
  };
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stronghold-admin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configFile = join(dir, 'player-admin', 'config.json');
  const announcementFile = join(dir, 'announcements.json');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { salt, passwordHash } = await credentials(PASSWORD);
  await atomicJson(configFile, { version: 1, username: 'admin', publicOrigin: origin, salt, passwordHash });
  const mount = async () => {
    const mounted = await mountPlayerAdmin({ server, ...fakes(), configFile, announcementFile,
      publicDir: join(dir, 'public'), log: quietLog });
    t.after(() => mounted.unmount());
    return mounted;
  };
  return { dir, configFile, announcementFile, origin, mount };
}

const login = async (origin, password = PASSWORD) => {
  const res = await fetch(`${origin}/admin/api/login`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'admin', password }) });
  const text = await res.text(); // read once: the body cannot feed both the message and json()
  assert.equal(res.status, 200, text);
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: JSON.parse(text).csrf };
};

const call = (origin, path, { method = 'GET', cookie, csrf, body } = {}) => fetch(`${origin}${path}`, {
  method, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...(body ? { 'content-type': 'application/json', origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('first boot records the board seed without writing rows; deletion stays deleted', async (t) => {
  const { announcementFile, mount } = await fixture(t);
  const first = await mount(); // announcementFile is missing: the shipped board (data/announcements.json) is empty
  await assert.rejects(readFile(announcementFile, 'utf8'), { code: 'ENOENT' },
    'an empty shipped board seeds nothing instead of writing an empty store');
  assert.equal(first.admin.state.announceSeeded, true);

  await first.unmount();
  await writeFile(announcementFile, JSON.stringify({ announcements: [] }));
  const second = await mount();
  assert.deepEqual(JSON.parse(await readFile(announcementFile, 'utf8')), { announcements: [] },
    'announceSeeded keeps a later deletion permanent across restarts');
  assert.equal(second.admin.state.announceSeeded, true);
  await second.unmount();

  await writeFile(announcementFile, JSON.stringify({ announcements: [{ id: 'kept', type: 'popup', title: '已排期',
    text: '已有排期不重播', startAt: new Date().toISOString(), durationSeconds: 3600, level: 'info', enabled: true }] }));
  const raw = await readFile(announcementFile, 'utf8');
  await mount();
  assert.equal(await readFile(announcementFile, 'utf8'), raw, 'a populated store is never reseeded');
});

test('admin publishes and deletes notices over HTTP, flips maintenance and serves plugin routes', async (t) => {
  const { announcementFile, origin, mount } = await fixture(t);
  const { admin } = await mount();
  assert.equal((await call(origin, '/admin/api/announcements')).status, 401, 'anonymous reads are refused');
  const { cookie, csrf } = await login(origin);

  const publishedText = await (await call(origin, '/admin/api/announcement', { method: 'POST', cookie, csrf,
    body: { text: '停服公告：今晚 02:00–04:00', durationSeconds: 3600, level: 'info' } })).text();
  assert.match(publishedText, /"announcementId":"admin_/);
  const { announcementId } = JSON.parse(publishedText);

  assert.equal((await (await call(origin, '/admin/api/announcement/delete', { method: 'POST', cookie, csrf,
    body: { announcementId } })).json()).ok, true);
  assert.equal(JSON.parse(await readFile(announcementFile, 'utf8')).announcements.some((n) => n.id === announcementId), false,
    'an admin notice deletes outright');
  assert.equal((await call(origin, '/admin/api/announcement/delete', { method: 'POST', cookie, csrf,
    body: { announcementId } })).status, 404, 'deleting twice is a clean 404');

  assert.deepEqual(await (await call(origin, '/admin/api/maintenance', { cookie })).json(), { maintenance: false });
  assert.deepEqual(await (await call(origin, '/admin/api/maintenance', { method: 'POST', cookie, csrf,
    body: { maintenance: true } })).json(), { ok: true, maintenance: true, changed: true });
  assert.deepEqual(await (await call(origin, '/admin/api/maintenance', { cookie })).json(), { maintenance: true });
  assert.equal((await call(origin, '/admin/api/maintenance', { method: 'POST', cookie, csrf,
    body: { maintenance: 'yes' } })).status, 400);
  assert.equal(admin.state.audit[0].action, 'maintenance');

  admin.registerAdminRoute('/admin/api/example/ping', { permission: 'ops', handler: (body) => ({ ok: true, echo: body.hi }) });
  assert.deepEqual(await (await call(origin, '/admin/api/example/ping', { method: 'POST', cookie, csrf,
    body: { hi: 'pong' } })).json(), { ok: true, echo: 'pong' });
  // The feedback console reads with GET, so a route has to declare its method and the handler gets the query instead of a body.
  admin.registerAdminRoute('/admin/api/example/pong', { permission: 'ops', method: 'GET', handler: (body, query) => ({ ok: true, q: query.get('q') }) });
  assert.deepEqual(await (await call(origin, '/admin/api/example/pong?q=1', { cookie })).json(), { ok: true, q: '1' });
  assert.equal((await call(origin, '/admin/api/example/pong', { method: 'POST', cookie, csrf, body: {} })).status, 404,
    'the method is part of the route: POST cannot reach a GET route');
  assert.throws(() => admin.registerAdminRoute('/admin/api/example/put', { method: 'PUT', handler() {} }), /method must be GET or POST/);
  assert.throws(() => admin.registerAdminRoute('/admin/api/example/ping', { handler() {} }), /already exists/);
  assert.throws(() => admin.registerAdminRoute('/admin/api/login', { handler() {} }), /already exists/, 'built-ins cannot be shadowed');
  assert.throws(() => admin.registerAdminRoute('/admin/api/bad path', { handler() {} }), /invalid admin route/);
  assert.throws(() => admin.registerAdminRoute('/admin/api/x', { permission: 'has space', handler() {} }), /permission/);
  assert.throws(() => admin.registerAdminRoute('/admin/api/x', {}), /handler/);
});

test('the snapshot reads the queue from lobby.stats() and lists rooms for the match view', async (t) => {
  const f = fakes();
  assert.equal(playerSnapshot(f).stats.queued, 0, 'the queue counter is a number, not a missing field');
  assert.deepEqual(playerSnapshot(f).matches, []);

  const room = { code: 'ROOM1', mode: 'coop', difficulty: 'NORMAL', source: 'private', hostId: 'p1',
    seats: [{ playerId: 'p1', isBot: false, left: false }], spectators: [], match: null, matchCtx: null,
    matchCount: 0, createdAt: 1700000000000, disposed: false, capacity: 2,
    seatOf: (id) => room.seats.find((s) => s?.playerId === id), spectatorOf: () => null,
    activeHumans: () => room.seats.filter((s) => s && !s.left && !s.isBot), freeSeat: () => null };
  f.rooms.set(room.code, room);
  f.queue.entries.set('p1', { mode: 'coop' });
  f.queueByPlayer.set('p1', { mode: 'coop' });
  f.sessions.push({ playerId: 'p1', name: '博士', connected: false, ws: null });
  f.lobby.roomOf = () => room;

  const data = playerSnapshot(f);
  assert.equal(data.stats.queued, 1);
  assert.equal(data.stats.matchmaking, undefined, 'the client reads stats.queued; the real network has no counter object');
  assert.equal(data.players[0].status, 'disconnected');
  assert.equal(data.players[0].roomCode, 'ROOM1');
  assert.equal(data.matches.length, 1);
  assert.equal(data.matches[0].roomCode, 'ROOM1');
  assert.equal(data.matches[0].queued, true, 'lobby.roomQueued reports a boolean, not a count');
  assert.equal(data.matches[0].inMatch, false);
  assert.equal(data.matches[0].humans, 1);
});

test('each announcement channel picks its own winner, so a popup is never blocked by a scroll notice', async (t) => {
  const { origin, announcementFile, mount } = await fixture(t);
  // The store is operator-managed now (no shipped board), so this test publishes its own popup rows.
  await writeFile(announcementFile, JSON.stringify({ announcements: [
    { id: 'board-1', type: 'popup', title: '甲', text: '早的一条', startAt: '2026-01-01T00:00:00.000Z', level: 'info', enabled: true, autoPopup: false },
    { id: 'board-2', type: 'popup', title: '乙', text: '晚的一条', startAt: '2026-02-01T00:00:00.000Z', level: 'info', enabled: true, autoPopup: false },
  ] }));
  await mount();
  const { cookie } = await login(origin);
  const data = await (await call(origin, '/admin/api/announcements', { cookie })).json();
  assert.equal(data.current, null, 'the scroll channel has no live announcement here');
  assert.ok(data.popupCurrent, 'the popup channel reports its own winner');
  assert.equal(data.popupCurrent.type, 'popup');
  assert.equal(data.popupCurrent.startAt, Math.min(...data.announcements.map((n) => n.startAt)),
    'earliest start wins among equal levels inside the same channel');
});

test('the runtime maintenance override drains: new rooms and starts refuse, presence.state reaches everyone', async (t) => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, store: null,
    adminConfigFile: null, announcementsFile: null });
  t.after(() => srv.close());
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const a = await TestClient.connect(url); t.after(() => a.close());
  const b = await TestClient.connect(url); t.after(() => b.close());
  await a.hello('drain-a');
  await b.hello('drain-b');

  assert.equal(srv.lobby.setMaintenanceOverride(true), true);
  await a.waitFor('presence.state', (m) => m.maintenance === true);
  await b.waitFor('presence.state', (m) => m.maintenance === true);
  assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).code, 'MAINTENANCE');

  assert.equal(srv.lobby.setMaintenanceOverride(false), true);
  await a.waitFor('presence.state', (m) => m.maintenance == null);
  assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');

  srv.lobby.setMaintenanceOverride(true);
  assert.equal((await a.request({ t: 'room.start' })).code, 'MAINTENANCE', 'a created room survives but cannot start');
  await b.waitFor('presence.state', (m) => m.maintenance === true);
});

test('the 娱乐模式 switches: GET lists the completed modes, POST flips one, audits it and persists', async (t) => {
  const { origin, mount } = await fixture(t);
  const admin = await mount();
  let { cookie, csrf } = await login(origin);
  assert.deepEqual((await (await call(origin, '/admin/api/arcade', { cookie })).json()).modes, [
    { id: 'hunt2v2', name: '狩猎模拟 2V2', open: true },
    { id: 'alliancehunt', name: '同盟狩猎', open: true },
  ], 'both completed modes start open; 危机合约 is still a 敬请期待 card with no switch');

  assert.equal((await call(origin, '/admin/api/arcade', { method: 'POST', cookie, csrf,
    body: { id: 'alliancehunt', open: false } })).status, 200);
  const after = await (await call(origin, '/admin/api/arcade', { cookie })).json();
  assert.deepEqual(after.modes.map((m) => [m.id, m.open]), [['hunt2v2', true], ['alliancehunt', false]]);
  assert.equal(admin.admin.state.audit[0].action, 'arcade');
  assert.equal(admin.admin.state.arcade.alliancehunt, false);
  assert.equal((await call(origin, '/admin/api/arcade', { method: 'POST', cookie, csrf,
    body: { id: 'contract', open: false } })).status, 400, 'a 敬请期待 mode cannot be switched');
  assert.equal((await call(origin, '/admin/api/arcade', { method: 'POST', cookie, csrf,
    body: { id: 'alliancehunt', open: 'no' } })).status, 400);

  // the switch lives in state.json: a restart applies it before the lobby accepts rooms
  await admin.unmount();
  await mount();
  cookie = (await login(origin)).cookie;
  assert.equal((await (await call(origin, '/admin/api/arcade', { cookie })).json()).modes[1].open, false);
});

test('the 娱乐模式 switches drain per mode: new rooms and starts of that mode refuse, running matches are untouched', async (t) => {
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, workers: 0, store: null,
    adminConfigFile: null, announcementsFile: null });
  t.after(() => srv.close());
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const a = await TestClient.connect(url); t.after(() => a.close());
  const b = await TestClient.connect(url); t.after(() => b.close());
  await a.hello('arcade-a');
  await b.hello('arcade-b');
  assert.equal(srv.lobby.arcadeOpen('hunt2v2'), true);
  assert.equal(srv.lobby.arcadeOpen('alliancehunt'), true);

  // a room built while the mode was open survives the switch; only a NEW match is refused
  assert.equal((await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', hunt: true })).t, 'ok');
  assert.equal(srv.lobby.setArcadeMode('alliancehunt', false), true);
  await b.waitFor('presence.state', (m) => m.arcade && m.arcade.alliancehunt === false);
  assert.equal((await a.request({ t: 'room.start' })).code, 'MODE_DISABLED');
  assert.equal((await b.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', hunt: true })).code, 'MODE_DISABLED');

  // 2V2 uses the same per-mode switch
  assert.equal(srv.lobby.setArcadeMode('alliancehunt', true), true);
  assert.equal(srv.lobby.setArcadeMode('hunt2v2', false), true);
  assert.equal((await b.request({ t: 'room.create', mode: 'versus', difficulty: 'NORMAL' })).code, 'MODE_DISABLED');
  assert.equal(srv.lobby.setArcadeMode('hunt2v2', true), true);
});
