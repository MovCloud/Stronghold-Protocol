// test/admin-packs.test.js — the admin's runtime pack switches (server/pluginPolicy.js): a paid entry defaults to
// disabled and every other entry to enabled; a disabled entry is delivered as the shallow copy marked
// { status: 'disabled', disabled: { code: 'admin' } } (the scan cache is never polluted, so a toggle works without
// a rescan), a disabled paid entry is filtered out of the delivered catalogues entirely; the three delivery paths
// (GET /plugins/index.json via pluginIndex, GET /packs/index.json via index, /p/… via pluginFile) answer for the
// next request; the admin API lists the raw entries plus the policy (a disabled paid pack stays visible to the
// admin), needs confirm to enable a paid pack, and persists the switches in state.json, restored on restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPackPolicy } from '../server/pluginPolicy.js';
import { createPluginRegistry } from '../server/plugins/registry.js';
import { credentials, atomicJson, mountPlayerAdmin } from '../server/playerAdmin.js';

const PASSWORD = 'packs-admin-password';
const quietLog = { info() {}, warn() {}, error() {} };
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-admin-packs-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
const dirsOf = (root) => ({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
  packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins') });

const cosmetic = (extra = {}) => ({ manifest: 2, name: 'Skin', version: '1.0.0', app: '*', api: 1,
  class: 'cosmetic', permissions: ['assets.override'], assets: { chars: { char_102_texas: { avatar: 'art/avatar.png' } } }, ...extra });

/** A checkout-shaped root: one language pack, one cosmetic plugin, one paid cosmetic plugin. */
function exampleRoot(paid = []) {
  const dir = tmpdir('root');
  put(dir, 'public/i18n/en.json', { _meta: { name: 'English', complete: true }, 开始: 'Start' });
  // the art manifest the overlay validates against (test/helpers/pluginFixtures.js shape)
  put(dir, 'data/assets.json', { version: 1, hash: 'testhash', chars: { char_102_texas: { avatar: '/assets/char/avatar/char_102_texas.png' } } });
  put(dir, 'plugins/skin/plugin.json', cosmetic());
  put(dir, 'plugins/skin/art/avatar.png', 'png');
  put(dir, 'plugins/paid-skin/plugin.json', cosmetic());
  put(dir, 'plugins/paid-skin/art/avatar.png', 'png');
  const policy = createPackPolicy({ paid, log: quietLog });
  const registry = createPluginRegistry(dirsOf(dir), { log: quietLog, policy });
  return { dir, policy, registry };
}

test('policy defaults: paid disabled, everything else enabled; an explicit switch wins', () => {
  const policy = createPackPolicy({ paid: ['paid-skin'], log: quietLog });
  const paidEntry = { id: 'paid-skin', class: 'cosmetic', status: 'loaded', manifest: {} };
  const plainEntry = { id: 'skin', class: 'cosmetic', status: 'loaded', manifest: {} };
  const forward = { id: 'future', class: 'ui', status: 'loaded', manifest: { paid: true } }; // the future manifest field
  assert.equal(policy.isPaid(paidEntry), true);
  assert.equal(policy.isPaid(plainEntry), false);
  assert.equal(policy.isPaid(forward), true);
  assert.equal(policy.isEnabled(paidEntry), false);   // paid defaults to disabled
  assert.equal(policy.isEnabled(plainEntry), true);   // the rest defaults to enabled
  assert.equal(policy.isEnabled(forward), false);
  policy.set('paid-skin', true);
  assert.equal(policy.isEnabled(paidEntry), true);    // an explicit enable beats the default
  policy.set('skin', false);
  assert.equal(policy.isEnabled(plainEntry), false);
  assert.deepEqual(policy.snapshot(), { 'paid-skin': true, skin: false }); // explicit switches only, sorted
});

test('view marks a disabled entry without polluting the scan cache; a disabled paid entry filters out', () => {
  const policy = createPackPolicy({ paid: ['paid-skin'], log: quietLog });
  const paidEntry = { id: 'paid-skin', class: 'cosmetic', status: 'loaded', manifest: {} };
  const plainEntry = { id: 'skin', class: 'cosmetic', status: 'loaded', manifest: {} };
  assert.equal(policy.view(paidEntry), null); // disabled paid: never delivered, never in the catalogues
  policy.set('skin', false);
  const copy = policy.view(plainEntry);
  assert.equal(copy.status, 'disabled');
  assert.deepEqual(copy.disabled, { code: 'admin' });
  assert.equal(copy.supported, false);
  assert.equal(plainEntry.status, 'loaded');  // the scan cache stays as it was
  assert.notEqual(copy, plainEntry);
  policy.set('skin', true);
  assert.equal(policy.view(plainEntry), plainEntry);
});

test('delivery paths: the catalogues and pluginFile answer the policy for the next request', () => {
  const { policy, registry } = exampleRoot(['paid-skin']);
  // default: the paid plugin is off, the rest on
  assert.equal(registry.plugin('paid-skin'), null);
  assert.equal(registry.pluginFile('paid-skin', 'art/avatar.png'), null);
  assert.equal(registry.servable('paid-skin', 'plugin.json'), null);
  let index = registry.pluginIndex({ vanilla: 'cs' });
  assert.ok(!index.plugins.some((e) => e.id === 'paid-skin'));
  assert.ok(index.plugins.some((e) => e.id === 'skin'));
  // the admin enables the paid pack (confirm is the API's gate, not the policy's) → delivered again
  policy.set('paid-skin', true);
  assert.ok(registry.pluginFile('paid-skin', 'art/avatar.png'));
  assert.ok(registry.pluginIndex({ vanilla: 'cs' }).plugins.some((e) => e.id === 'paid-skin'));
  // a normal pack switched off: out of the catalogues, its files 404
  policy.set('skin', false);
  assert.equal(registry.pluginFile('skin', 'art/avatar.png'), null);
  index = registry.pluginIndex({ vanilla: 'cs' });
  assert.ok(!index.plugins.some((e) => e.id === 'skin'));
  // a language pack switched off: /packs/index.json filters it, its files stop being servable
  const lang = registry.plugin('en');
  assert.ok(lang && lang.class === 'lang');
  policy.set('en', false);
  assert.ok(!registry.index().packs.some((e) => e.lang === 'en'));
  assert.equal(registry.servable('en', 'en.json'), null);
  assert.ok(!registry.list('lang').some((p) => p.lang === 'en'));
});

test('visual sets see a disabled cosmetic plugin as blocked, not usable', async () => {
  const { policy, registry } = exampleRoot([]);
  const { createVisualSets } = await import('../server/plugins/visualSet.js');
  const sets = createVisualSets({ registry, log: quietLog });
  assert.ok(sets.resolve(['skin']).ok);
  policy.set('skin', false);
  const r = sets.resolve(['skin']);
  assert.ok(!r.ok);
  assert.equal(r.error, 'PLUGIN_BLOCKED');
  // the internal accessor still sees the entry, marked disabled (the delivered catalogue filters it — test above)
  assert.equal(registry.plugins('cosmetic').find((p) => p.id === 'skin').status, 'disabled');
});

// ---------------------------------------------------------------------------------------------------
// The admin API over a real listener (the fakes mirror the shapes playerSnapshot reads, as in
// test/player-admin-ops.test.js; the pack rows themselves need nothing of the lobby)
// ---------------------------------------------------------------------------------------------------

function fakes() {
  return {
    lobby: { maintenance: () => false, arcadeOpen: () => false, arcadeInfo: () => ({}), setArcadeMode: () => false,
      onExpire() {}, roomOf: () => null, rooms: new Map(), queue: { entries: new Map() }, queueByPlayer: new Map(),
      stats: () => ({ rooms: 0, matches: 0, humans: 0, bots: 0, spectators: 0, online: 0, queued: 0 }) },
    network: { conns: new Map(), opts: { trustProxy: false }, moderation: null, onlineCount: 0 },
    registry: { all: () => [], byId: () => null, byToken: () => null, remove() {} },
  };
}

async function adminFixture(t, paid = []) {
  const dir = tmpdir('admin');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const configFile = path.join(dir, 'player-admin', 'config.json');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { salt, passwordHash } = await credentials(PASSWORD);
  await atomicJson(configFile, { version: 1, username: 'admin', publicOrigin: origin, salt, passwordHash });
  const mount = async (policy) => {
    const packs = createPluginRegistry(dirsOf(dir), { log: quietLog, policy });
    const mounted = await mountPlayerAdmin({ server, ...fakes(), packs, policy,
      configFile, announcementFile: path.join(dir, 'announcements.json'), publicDir: path.join(dir, 'public'), log: quietLog });
    t.after(() => mounted.unmount());
    return mounted;
  };
  return { dir, origin, mount };
}

const login = async (origin, password = PASSWORD) => {
  const res = await fetch(`${origin}/admin/api/login`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: 'admin', password }) });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: JSON.parse(text).csrf };
};

const call = (origin, p, { method = 'GET', cookie, csrf, body } = {}) => fetch(`${origin}${p}`, {
  method, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
    ...(body ? { 'content-type': 'application/json', origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('admin API: paid rows stay visible when disabled, enabling needs confirm, switches persist and restore', async (t) => {
  const { dir, origin, mount } = await adminFixture(t, ['paid-skin']);
  put(dir, 'plugins/paid-skin/plugin.json', cosmetic());
  put(dir, 'plugins/paid-skin/art/avatar.png', 'png');
  put(dir, 'plugins/skin/plugin.json', cosmetic());
  put(dir, 'plugins/skin/art/avatar.png', 'png');
  const policy = createPackPolicy({ paid: ['paid-skin'], log: quietLog });
  const admin = await mount(policy);
  const { cookie, csrf } = await login(origin);

  // the panel sees both rows: the paid one disabled by default, the plain one enabled
  let res = await call(origin, '/admin/api/packs', { cookie, csrf });
  assert.equal(res.status, 200);
  let rows = (await res.json()).packs;
  const paidRow = rows.find((r) => r.id === 'paid-skin');
  const plainRow = rows.find((r) => r.id === 'skin');
  assert.ok(paidRow && plainRow);
  assert.equal(paidRow.paid, true);
  assert.equal(paidRow.enabled, false);
  assert.equal(plainRow.enabled, true);
  assert.equal(rows.indexOf(paidRow) > rows.indexOf(plainRow), true); // paid rows last

  // enabling a paid pack without confirm is refused; with confirm it works
  res = await call(origin, '/admin/api/packs', { method: 'POST', cookie, csrf, body: { id: 'paid-skin', enabled: true } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /confirm/);
  res = await call(origin, '/admin/api/packs', { method: 'POST', cookie, csrf, body: { id: 'paid-skin', enabled: true, confirm: true } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).packs.find((r) => r.id === 'paid-skin').enabled, true);

  // a normal pack can be switched off without confirm
  res = await call(origin, '/admin/api/packs', { method: 'POST', cookie, csrf, body: { id: 'skin', enabled: false } });
  assert.equal(res.status, 200);

  // an unknown id and a bad body are refused
  res = await call(origin, '/admin/api/packs', { method: 'POST', cookie, csrf, body: { id: 'absent', enabled: false } });
  assert.equal(res.status, 404);
  res = await call(origin, '/admin/api/packs', { method: 'POST', cookie, csrf, body: { id: 'skin', enabled: 'no' } });
  assert.equal(res.status, 400);

  // persisted in state.json (explicit switches only), and the audit names the pack
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'player-admin', 'state.json'), 'utf8'));
  assert.deepEqual(state.packs, { 'paid-skin': true, 'skin': false });
  assert.ok(state.audit.some((a) => a.action === 'pack' && a.packId === 'skin' && a.enabled === false));

  // the delivery paths answer for the next request: the disabled plain pack is out, the enabled paid one in
  assert.equal(policy.isEnabled({ id: 'skin', manifest: {} }), false);
  assert.equal(policy.isEnabled({ id: 'paid-skin', manifest: {} }), true);

  // a restart restores the switches from state.json
  const policy2 = createPackPolicy({ paid: ['paid-skin'], log: quietLog });
  const admin2 = await mount(policy2);
  assert.equal(policy2.isEnabled({ id: 'skin', manifest: {} }), false);
  assert.equal(policy2.isEnabled({ id: 'paid-skin', manifest: {} }), true);
  assert.ok(admin2);
});
