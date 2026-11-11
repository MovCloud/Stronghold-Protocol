// 皮肤管理 (docs/CONTENT-ADMIN.md §9): the gate that decides which skins this installation offers. What is testable
// here is the document (validation, CAS + replay guard), the one judgement the four surfaces share (shared/skins.js
// and shared/playerCard.js), the panel's row order and the boot pass that restores a player left with a stopped skin.
// The HTTP write is tested over the admin API in test/player-admin-ops.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSkins, validateSkins, skinsMutation, SKINS_FILE, SCHEMA_VERSION } from '../server/contentConfig.js';
import { readSkinDoc, packSkins, skinGroups, deniedIds, createSkinGate } from '../server/skinGate.js';
import { setSkinGate, skinDenied, cleanSkinChoices, skinIdFor } from '../shared/skins.js';
import { cleanPlayerCard, cardSkinDenied } from '../shared/playerCard.js';
import { sendJson, sendError } from '../server/http/common.js';
import { createPublicApi } from '../server/publicApi.js';

const current = (doc) => ({ doc, raw: undefined });
const CHAR = 'char_103_angel';
const SKIN = 'char_103_angel_wild_1';

// shared/skins.js holds the gate for the whole process, so every test that installs one has to take it back off.
function withGate(disabled, fn) {
  setSkinGate(disabled);
  try { return fn(); } finally { setSkinGate(null); }
}

test('no file is the same as an empty map: everything stays offered', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(defaultSkins().disabled, {});
  assert.equal(defaultSkins().revision, 0, 'the panel needs expectedRevision 0 for its first write');
  const missing = readSkinDoc(join(tmpdir(), 'sp-no-such-dir'));
  assert.deepEqual(missing.doc, defaultSkins());
  assert.equal(missing.raw, undefined);
});

test('the gate document is checked by shape only — a plugin skin can disappear with its pack', () => {
  assert.deepEqual(validateSkins(defaultSkins()), []);
  assert.deepEqual(validateSkins({ ...defaultSkins(), disabled: { [CHAR]: [SKIN, 'forge/skin_key'] } }), []);
  assert.match(validateSkins({ ...defaultSkins(), disabled: [] }).join('；'), /皮肤停用表/);
  assert.match(validateSkins({ ...defaultSkins(), disabled: { [CHAR]: 'x' } }).join('；'), /数组/);
  assert.match(validateSkins({ ...defaultSkins(), disabled: { [CHAR]: ['not a skin id'] } }).join('；'), /皮肤 id 无效/);
  assert.match(validateSkins({ ...defaultSkins(), disabled: { [CHAR]: [SKIN, SKIN] } }).join('；'), /皮肤重复/);
  assert.match(validateSkins({ schemaVersion: 2, revision: 0, disabled: {} }).join('；'), /schemaVersion/);
});

test('the save is the whole map, replay is not a change and the revision is guarded', () => {
  const first = skinsMutation(current(defaultSkins()), { disabled: { [CHAR]: [SKIN] }, expectedRevision: 0 });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.document.revision, 1);
  // The panel sends the whole map every save: an operator with nothing off is not an entry.
  const same = skinsMutation(current(first.document), { disabled: { [CHAR]: [SKIN], other: [] }, expectedRevision: 1 });
  assert.equal(same.changed, false, 'the same map is a replay, not a second revision');
  const stale = skinsMutation(current(first.document), { disabled: {}, expectedRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.cas, true);
  assert.equal(skinsMutation(current(defaultSkins()), { expectedRevision: 0 }).ok, false);
});

test('one judgement covers the four surfaces a stored choice is read on', () => {
  const disabled = { [CHAR]: [SKIN] };
  withGate(disabled, () => {
    assert.equal(skinDenied(SKIN), true);
    assert.equal(skinDenied('char_other@series#2'), false);
    // the appearance choice: the denied entry is dropped, the rest is kept
    assert.deepEqual(cleanSkinChoices({ [CHAR]: SKIN, char_other: 'forge/skin_key' }), { char_other: 'forge/skin_key' });
    assert.equal(skinIdFor({ [CHAR]: SKIN }, CHAR), null);
    // the card: the portrait and the avatar carry the bare id, the 名片底图 carries `skin:<id>`
    assert.equal(cardSkinDenied(SKIN), true);
    assert.equal(cardSkinDenied(`skin:${SKIN}`), true);
    assert.equal(cardSkinDenied('bond:1234'), false, 'a source avatar is not a skin');
    assert.deepEqual(cleanPlayerCard({ charId: SKIN, avatar: SKIN }), { charId: '', avatar: '' });
    assert.deepEqual(cleanPlayerCard({ charId: 'char_other', avatar: 'bond:1234' }), { charId: 'char_other', avatar: 'bond:1234' });
  });
  // Without the gate nothing changes: the shared cleaners behave as they did before the feature existed.
  assert.equal(skinDenied(SKIN), false);
  assert.deepEqual(cleanSkinChoices({ [CHAR]: SKIN }), { [CHAR]: SKIN });
});

test('the panel lists 默认外观 first, then the official table, then the packs', () => {
  // The official table publishes the official skin id; the row has to carry the catalogue's manifest id, because that
  // is the value a stored choice carries and the value shared/skins.js `skinDenied` checks.
  const data = { skins: { chars: { [CHAR]: [{ id: 'char_103_angel@wild#1', name: '官方皮肤', group: '系列' }] } }, chess: {} };
  const pack = packSkins([{ id: 'forge', manifest: { name: '补充包' },
    visual: { ops: [{ at: ['chars', CHAR, 'skins', 'skin_key', 'name'], value: '插件皮肤' },
      { at: ['chars', CHAR, 'skins', 'skin_key', 'portrait'], value: 'a.png' }] } }]);
  assert.deepEqual(pack, [{ id: 'forge/skin_key', charId: CHAR, name: '插件皮肤', group: '补充包', art: 'a.png' }]);

  const view = skinGroups({ ...defaultSkins(), disabled: { [CHAR]: ['forge/skin_key'] } }, { data, pack, catalog: [] });
  assert.equal(view.groups.length, 1);
  const rows = view.groups[0].skins;
  assert.equal(rows.length, 4, '精一 and 精二 are two tiles of their own, then official, then pack');
  for (const r of rows.slice(0, 2)) {
    assert.equal(r.source, 'default');
    assert.equal(r.id, null);
    assert.equal(r.fixed, true, 'the initial portraits can never be stopped, so the panel cannot take them away');
  }
  assert.equal(rows[0].name, '默认外观（精一）');
  assert.equal(rows[1].name, '默认外观（精二）');
  assert.equal(rows[2].source, 'official');
  assert.equal(rows[2].id, SKIN, 'the tile has to send the gate key, not the official table id');
  assert.equal(rows[3].source, 'pack');
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[1].enabled, true);
  assert.equal(rows[2].enabled, true);
  assert.equal(rows[3].enabled, false);
  assert.deepEqual(view.stats, { chars: 1, skins: 2, disabled: 1 }, 'the two initial portraits are not counted as skins');
  assert.equal(view.revision, 0);
});

test('the tile art is the skin itself, with the operator portrait as the fallback', () => {
  const data = { skins: { chars: { [CHAR]: [{ id: 'char_103_angel@wild#1', name: '官方皮肤', group: '系列' }] } },
    assets: { skins: { [SKIN]: { portrait: '/assets/skins/x/portrait.png' } },
      chars: { [CHAR]: { portrait: '/assets/char/a.png', portraitE2: '/assets/char/a_e2.png' } } },
    chess: {} };
  const rows = skinGroups(defaultSkins(), { data, pack: [], catalog: [] }).groups[0].skins;
  assert.equal(rows[0].art, '/assets/char/a.png', '精一 uses the operator portrait');
  assert.equal(rows[1].art, '/assets/char/a_e2.png', '精二 uses the elite portrait');
  assert.equal(rows[2].art, '/assets/skins/x/portrait.png', 'the manifest is looked up by the gate id, not the official id');
  // A pack overlay is not in the committed manifest, so its own art is the only one available.
  const pack = packSkins([{ id: 'forge', manifest: { name: '补充包' },
    visual: { ops: [{ at: ['chars', CHAR, 'skins', 'skin_key', 'name'], value: '插件皮肤' },
      { at: ['chars', CHAR, 'skins', 'skin_key', 'portrait'], value: 'overlay.png' }] } }]);
  const packRows = skinGroups(defaultSkins(), { data, pack, catalog: [] }).groups[0].skins;
  assert.equal(packRows[3].art, 'overlay.png');
  // Without any art the tile still renders, so the panel needs no image for it.
  const bare = skinGroups(defaultSkins(), { data: { ...data, skins: { chars: {} } },
    pack: [{ id: 'forge/k2', charId: CHAR, name: '插件皮肤', group: '补充包' }], catalog: [] }).groups[0].skins;
  assert.equal(bare[2].art, '/assets/char/a.png', 'a pack skin with no overlay art falls back to the operator portrait');
  const noAssets = skinGroups(defaultSkins(), { data: { skins: { chars: {} }, chess: {} },
    pack: [{ id: 'forge/k2', charId: CHAR, name: '插件皮肤', group: '补充包' }], catalog: [] }).groups[0].skins;
  assert.equal(noAssets[2].art, '', 'no manifest at all leaves the tile without art instead of failing the panel');
});

test('the boot pass restores the default appearance and keeps everything else', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sp-skin-gate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, SKINS_FILE), JSON.stringify({ schemaVersion: 1, revision: 3, lastFingerprint: null,
    disabled: { [CHAR]: [SKIN] } }));

  const gate = createSkinGate({ dir, data: { skins: { chars: {} }, chess: {} }, entries: [] });
  assert.deepEqual(gate.disabled, { [CHAR]: [SKIN] });
  assert.equal(skinDenied(SKIN), true, 'the gate is installed for the shared cleaners');

  const session = { playerId: 'p1', skins: { [CHAR]: SKIN, char_other: 'char_other@series#2' },
    card: { charId: SKIN, avatar: 'bond:1234', bg: `skin:${SKIN}`, bgShift: 40, look: 'e1' } };
  const dropped = gate.cleanSession(session);
  assert.deepEqual([...dropped], [SKIN]);
  assert.deepEqual(session.skins, { char_other: 'char_other@series#2' }, 'only the denied entry is dropped');
  assert.equal(session.card.charId, '');
  assert.equal(session.card.bg, '');
  assert.equal(session.card.avatar, 'bond:1234', 'a source avatar is not a skin and stays');
  assert.equal(session.card.bgShift, 40, 'the other parameters are untouched');
  assert.equal(session.card.look, 'e1', 'the look is not a skin id here');
  assert.equal(gate.cleanSession({ skins: {}, card: {} }), null, 'nothing to clean answers null');
  setSkinGate(null);
});

test('the client reads the same map from GET /api/skins/gate', async () => {
  const api = createPublicApi({ lobby: { rooms: new Map() }, announcements: null, trustProxy: 'auto',
    sendJson, sendError, skinGate: { disabled: { [CHAR]: [SKIN] } } });
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, writeHead: (code) => { res.code = code; }, end: (body) => { res.body = body; } };
  const handled = await api({ method: 'GET', url: '/api/skins/gate', headers }, res, '/api/skins/gate');
  assert.equal(handled, true);
  assert.equal(res.code, 200);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { disabled: { [CHAR]: [SKIN] } });
  // Without a gate the path is left to the other handlers instead of answering an empty map.
  const off = createPublicApi({ lobby: { rooms: new Map() }, announcements: null, trustProxy: 'auto', sendJson, sendError });
  assert.equal(await off({ method: 'GET', url: '/api/skins/gate', headers }, { setHeader() {}, writeHead() {}, end() {} }, '/api/skins/gate'), false);
});
