// P7a seams: the reserved Identity/OAuth interface (server/identity.js), the no-OAuth 501 answer, the
// read-only /api/announcement projection, /metrics and the three-state asset download switch
// (/data/asset-source.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.js';
import { assetSourceFrom } from '../server/http/config.js';
import { createIdentityProvider, IDENTITY_KINDS } from '../server/identity.js';

test('identity seam: anonymous is the default; other kinds are honest placeholders', async () => {
  assert.deepEqual([...IDENTITY_KINDS], ['anonymous', 'admin', 'oauth']);
  const anon = createIdentityProvider();
  assert.equal(anon.kind, 'anonymous');
  assert.deepEqual(await anon.identify(), { authed: false, provider: null });
  await assert.rejects(() => createIdentityProvider({ kind: 'oauth' }).identify(), /not configured/);
  assert.throws(() => createIdentityProvider({ kind: 'ldap' }), /unknown identity kind/);
});

test('assetSourceFrom: absent keeps the entry, explicit empty disables it, a value validates', () => {
  assert.deepEqual(assetSourceFrom({}, {}), { origin: '', disabled: false });
  assert.deepEqual(assetSourceFrom({ assetOrigin: '' }, {}), { origin: '', disabled: true });
  assert.deepEqual(assetSourceFrom({}, { SP_ASSET_ORIGIN: '  ' }), { origin: '', disabled: true });
  assert.deepEqual(assetSourceFrom({ assetOrigin: 'https://cdn.example.com/assets/' }, {}),
    { origin: 'https://cdn.example.com/assets', disabled: false });
  assert.deepEqual(assetSourceFrom({ assetOrigin: '/cdn' }, {}), { origin: '/cdn', disabled: false });
  assert.throws(() => assetSourceFrom({ assetOrigin: 'javascript:alert(1)' }, {}), /SP_ASSET_ORIGIN/);
});

test('a plain installation: /auth/* answers 501 JSON, the dashboard stays dark, projections serve JSON', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'stronghold-seams-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const announcementsFile = join(dir, 'announcements.json');
  await writeFile(announcementsFile, JSON.stringify({ announcements: [] }));
  const boot = { host: '127.0.0.1', port: 0, quiet: true, workers: 0, store: null, adminConfigFile: null, announcementsFile };

  const srv = await startServer(boot);
  t.after(() => srv.close());

  const auth = await fetch(`${srv.url}/auth/login`, { method: 'POST' });
  assert.equal(auth.status, 501);
  assert.deepEqual(await auth.json(), { error: '此安装未配置 OAuth 登录' });
  assert.equal((await fetch(`${srv.url}/admin/api/session`)).status, 404, 'no credentials: /admin/* is a bare 404');

  // An explicit announcementsFile opts this installation into the public schedule projection (server/publicApi.js).
  const projection = await (await fetch(`${srv.url}/api/announcement`)).json();
  assert.equal(projection.announcement, null);
  assert.ok(Number.isFinite(projection.serverTime));
  const popupProjection = await (await fetch(`${srv.url}/api/popup-announcement`)).json();
  assert.equal(popupProjection.announcement, null);

  const metrics = await (await fetch(`${srv.url}/metrics`)).json();
  assert.equal(metrics.online, 0);
  assert.equal(metrics.announcements.entries, 0);
  assert.equal(metrics.announcements.configError, null);

  assert.deepEqual(await (await fetch(`${srv.url}/data/asset-source.json`)).json(), { version: 1, origin: '' },
    'the default install keeps the download entry');

  const disabled = await startServer({ ...boot, assetOrigin: '' });
  t.after(() => disabled.close());
  assert.deepEqual(await (await fetch(`${disabled.url}/data/asset-source.json`)).json(),
    { version: 1, origin: '', disabled: true }, 'SP_ASSET_ORIGIN="" hides the download entry');
});
