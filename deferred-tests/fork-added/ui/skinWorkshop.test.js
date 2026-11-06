// Node tests for the local skin workshop's data layer (public/js/skinWorkshop.js, P6 §3.4): the /p/local/… URL
// naming, the file-name sanitising, the slot guessing, the byte store into the verified object cache (under the
// file's own URL path — the key both service workers answer, shared/assetCache.js pluginObjectKey), the register
// payload of a document, the document's own
// add/remove, the sp.pref.localSkins persistence (the personal cosmetic plugins' storage path) and the reload
// registration content.js runs (restoreLocalSkins). No DOM — the settings section is public/js/ui/skinWorkshop.js.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The workshop's store seeds itself from localStorage at import time (sp.pref.localSkins): install the stub and the
// seed BEFORE the first import, exactly the way a page that has used the workshop before boots.
const pref = new Map();
const seedDoc = [
  {
    skinId: 'look1', charId: 'char_002_amiya', displayName: '黄昏制服',
    slots: { avatar: '/p/local/aaaaaaaa/amiya_avatar.png', illust: '/p/local/cccccccc/amiya_i.png' },
    files: [
      { slot: 'avatar', url: '/p/local/aaaaaaaa/amiya_avatar.png', name: 'amiya_avatar.png', sha256: 'a'.repeat(64), bytes: 5 },
      { slot: 'illust', url: '/p/local/cccccccc/amiya_i.png', name: 'amiya_i.png', sha256: 'c'.repeat(64), bytes: 5 },
    ],
  },
];
pref.set('sp.pref.localSkins', JSON.stringify(seedDoc));
globalThis.localStorage = {
  getItem: (k) => (pref.has(k) ? pref.get(k) : null),
  setItem: (k, v) => pref.set(k, String(v)),
  removeItem: (k) => pref.delete(k),
};

// register reaches cosmetics.setSkins, and the layers' op machinery loads on demand: bring it in first, like
// test/render/skinRegistry.test.js does
const { loadVisual, cosmetics } = await import('../../public/js/cosmetics.js');
await loadVisual();

const sw = await import('../../public/js/skinWorkshop.js');
const { pluginObjectKey } = await import('../../shared/assetCache.js');
const { reset, register } = await import('../../public/js/skinRegistry.js');
const { avatarUrl, illustUrl, skinsOf, spineEntry, skinHasModel, registeredDynamicArt } = await import('../../public/js/assets.js');

/** A manifest as /data/assets.json would load it: one operator. */
const base = () => ({ chars: { char_002_amiya: { name: '阿米娅', avatar: '/assets/~1111111111111111/amiya.png' } } });

/** A picked file as the file input hands it over: a name and its bytes, nothing else needed here. */
const fakeFile = (name, text) => ({
  name,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  text: async () => String(text),
});

/** A fake digest: hash8 runs from the first byte so different files get different /p/local/ folders. */
const fakeDigest = async (bytes) => (new Uint8Array(bytes)[0] % 10).toString().repeat(64);

/** A fake Cache with the two methods the workshop touches. */
const fakeCache = (misses = new Set()) => {
  const puts = new Map();
  return {
    puts,
    async put(k, r) { puts.set(k, r); return r; },
    async delete(k) { if (misses.has(k)) return false; return puts.delete(k); },
  };
};

describe('skinWorkshop naming (safeFileName / inferSlot / localSkinUrl)', () => {
  it('reduces a picked name to a safe last segment and never an empty one', () => {
    assert.equal(sw.safeFileName('C:\\pics\\my (new) avatar.png'), 'my_new_avatar.png');
    assert.equal(sw.safeFileName('dir/sub/amiya 立绘.PN’G'), 'amiya_.PN_G');
    assert.equal(sw.safeFileName('name'.repeat(40) + '.png').length, 64);
    assert.equal(sw.safeFileName(''), 'skin.png');
    assert.equal(sw.safeFileName('///'), 'skin.png');
  });

  it('guesses the slot from the file name; an unnamed picture is an illustration', () => {
    assert.equal(sw.inferSlot('阿米娅 头像.png'), 'avatar');
    assert.equal(sw.inferSlot('amiya avatar e2.png'), 'avatarE2');
    assert.equal(sw.inferSlot('half portrait_e2.PNG'), 'portraitE2');
    assert.equal(sw.inferSlot('精二头像.png'), 'avatarE2');
    assert.equal(sw.inferSlot('illust_full.png'), 'illust');
    assert.equal(sw.inferSlot('random_picture.jpg'), 'illust');
  });

  it('names a skin file after the built-in local plugin and the hash8 folder', () => {
    assert.equal(sw.localSkinUrl('f'.repeat(64), 'a.png'), '/p/local/ffffffff/a.png');
    assert.equal(sw.LOCAL_PLUGIN_ID, 'local');
  });
});

describe('skinWorkshop storeSkinFiles (the bytes go to the object cache)', () => {
  it('writes one cache entry per file under its own URL path — the key the SWs answer — with the MIME by extension', async () => {
    const cache = fakeCache();
    const stored = await sw.storeSkinFiles([fakeFile('my avatar.png', 'hello'), fakeFile('illust.png', 'world')],
      { cache, digest: fakeDigest });
    assert.deepEqual(stored.map((s) => [s.slot, s.name, s.sha256.slice(0, 8), s.bytes]), [
      ['avatar', 'my_avatar.png', '44444444', 5],
      ['illust', 'illust.png', '99999999', 5],
    ]);
    assert.deepEqual(stored.map((s) => s.url), ['/p/local/44444444/my_avatar.png', '/p/local/99999999/illust.png']);
    // the mirror: the write side's key IS the shared matcher's key (both service workers derive it from the URL)
    assert.deepEqual([...cache.puts.keys()], stored.map((s) => pluginObjectKey(s.url, '')));
    const res = cache.puts.get(pluginObjectKey('/p/local/44444444/my_avatar.png', ''));
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(new Uint8Array(await res.arrayBuffer())[0], 'h'.charCodeAt(0));
  });

  it('the form\'s own slot choice wins; an unknown slot falls back to the name guess', async () => {
    const stored = await sw.storeSkinFiles([fakeFile('a.png', 'x')], { cache: fakeCache(), digest: fakeDigest, slots: ['portraitE2'] });
    assert.equal(stored[0].slot, 'portraitE2');
    const again = await sw.storeSkinFiles([fakeFile('a.png', 'x')], { cache: fakeCache(), digest: fakeDigest, slots: ['spine'] });
    assert.equal(again[0].slot, 'illust');
  });

  it('nothing picked, nothing stored; an unreadable file is an error the section can say', async () => {
    assert.deepEqual(await sw.storeSkinFiles([], { cache: fakeCache() }), []);
    await assert.rejects(() => sw.storeSkinFiles([{ name: 'x.png' }], { cache: fakeCache(), digest: fakeDigest }));
  });
});

describe('skinWorkshop payload and document (buildSkinEntry / docEntryOf / docToPayload)', () => {
  it('builds the manifest-shaped record: the first file of a slot fills it, the name is optional', () => {
    const stored = [
      { slot: 'avatar', url: '/p/local/00000000/a.png' },
      { slot: 'avatar', url: '/p/local/11111111/b.png' },
      { slot: 'illust', url: '/p/local/22222222/i.png' },
    ];
    assert.deepEqual(sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'look1', displayName: '黄昏制服' }, stored), {
      charId: 'char_002_amiya', skinId: 'look1', kind: 'static', displayName: '黄昏制服',
      avatar: '/p/local/00000000/a.png', illust: '/p/local/22222222/i.png',
    });
    assert.deepEqual(sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'look1' }, stored.slice(0, 1)),
      { charId: 'char_002_amiya', skinId: 'look1', kind: 'static', avatar: '/p/local/00000000/a.png' });
  });

  it('the document record round-trips into the payload the gate receives; a re-registered skinId replaces, delete filters', () => {
    const stored = [{ slot: 'avatar', url: '/p/local/00000000/a.png', name: 'a.png', sha256: '0'.repeat(64), bytes: 1 }];
    const entry = sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'look1', displayName: '黄昏制服' }, stored);
    const rec = sw.docEntryOf(entry, stored);
    assert.deepEqual(rec.slots, { avatar: '/p/local/00000000/a.png' });
    assert.deepEqual(rec.files, stored);
    const doc = sw.addDocSkin([seedDoc[0]], rec); // the same skinId: the new one wins, like the registry's own
    assert.equal(doc.length, 1);
    assert.equal(doc[0].skinId, 'look1');
    assert.deepEqual(sw.docToPayload(doc), [{ charId: 'char_002_amiya', skinId: 'look1', kind: 'static', displayName: '黄昏制服', avatar: '/p/local/00000000/a.png' }]);
    assert.deepEqual(sw.removeDocSkin(doc, 'look1'), []);
  });
});

describe('skinWorkshop persistence (sp.pref.localSkins, the personal plugins\' storage path)', () => {
  it('the store seeds itself from the seeded preference', () => {
    assert.deepEqual(sw.localSkins.get().skins, seedDoc);
  });

  it('a change writes the document back to the same preference key', () => {
    const rec = sw.docEntryOf(sw.buildSkinEntry({ charId: 'char_010_chen', skinId: 'look2' }, []), []);
    sw.localSkins.set({ skins: sw.addDocSkin(sw.localSkins.get().skins, rec) });
    const saved = JSON.parse(pref.get('sp.pref.localSkins'));
    assert.equal(saved.length, 2);
    assert.equal(saved[1].skinId, 'look2');
    sw.localSkins.set({ skins: sw.removeDocSkin(sw.localSkins.get().skins, 'look2') });
    assert.equal(JSON.parse(pref.get('sp.pref.localSkins')).length, 1);
  });

  it('a junk preference registers nothing strange', () => {
    assert.deepEqual(sw.sanitizeDocSkins(null), []);
    assert.deepEqual(sw.sanitizeDocSkins([{ skinId: 'x' }, 'junk', { skinId: '', charId: 'c' }]), []);
    const [only] = sw.sanitizeDocSkins([{ skinId: 'ok', charId: 'char_002_amiya', slots: { avatar: '/p/local/aaaaaaaa/a.png', evil: '/data/x' }, files: 'nope' }]);
    assert.deepEqual(only.slots, { avatar: '/p/local/aaaaaaaa/a.png' });
    assert.deepEqual(only.files, []);
  });
});

describe('skinWorkshop restoreLocalSkins (content.js reload registration)', () => {
  beforeEach(() => {
    reset();
    sw.localSkins.set({ skins: sw.sanitizeDocSkins(JSON.parse(JSON.stringify(seedDoc))) });
  });

  it('registers the document through the page\'s own gate; the composed manifest resolves the /p/local/ URLs', () => {
    const r = sw.restoreLocalSkins({ manifest: base() });
    assert.equal(r.ok, true);
    const m = cosmetics.apply(base());
    const key = 'local/look1';
    assert.ok(skinsOf(m, 'char_002_amiya')[key]);
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: key }), '/p/local/aaaaaaaa/amiya_avatar.png');
  });

  it('an empty document registers nothing and touches no layer: the main-line path stays as it is', () => {
    sw.localSkins.set({ skins: [] });
    assert.equal(sw.restoreLocalSkins({ manifest: base() }), null);
    assert.equal(cosmetics.skins, null);
    assert.equal(cosmetics.active, false);
  });

  it('a rejected registration (a charId the manifest no longer has) says its reasons and lands nothing', () => {
    sw.localSkins.set({ skins: [{ ...seedDoc[0], charId: 'char_999_ghost' }] });
    const r = sw.restoreLocalSkins({ manifest: base() });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.join('\n').includes('char_999_ghost'));
    assert.equal(cosmetics.skins, null);
  });
});

describe('skinWorkshop deleteSkinFiles (the delete drops the record\'s cache entries)', () => {
  it('deletes exactly the record\'s file keys and reports the count', async () => {
    const cache = fakeCache();
    for (const { url } of seedDoc[0].files) cache.puts.set(pluginObjectKey(url, ''), 'blob');
    const n = await sw.deleteSkinFiles(seedDoc[0], { cachesApi: { open: async () => cache }, origin: '' });
    assert.equal(n, 2);
    assert.equal(cache.puts.size, 0);
  });

  it('a key already gone counts as nothing deleted; storage trouble is swallowed', async () => {
    const cache = fakeCache();
    assert.equal(await sw.deleteSkinFiles(seedDoc[0], { cachesApi: { open: async () => cache }, origin: '' }), 0);
    assert.equal(await sw.deleteSkinFiles({ files: [] }, { cachesApi: { open: async () => cache }, origin: '' }), 0);
    assert.equal(await sw.deleteSkinFiles(seedDoc[0], { cachesApi: { open: async () => { throw new Error('no cache'); } }, origin: '' }), 0);
  });
});

describe('skinWorkshop register() reaches the page\'s gate from the UI\'s payload (end to end)', () => {
  beforeEach(() => reset());
  it('the payload of a freshly stored skin registers as the local plugin and resolves its art', async () => {
    const cache = fakeCache();
    const stored = await sw.storeSkinFiles([fakeFile('chen_dusk_illust.png', 'x')], { cache, digest: fakeDigest });
    const entry = sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'dusk', displayName: '黄昏制服' }, stored);
    const r = register(sw.LOCAL_PLUGIN_ID, [entry], { manifest: base() });
    assert.equal(r.ok, true);
    // the file name says illust, so the record fills the illust slot; the avatar slot it lacks stays the operator's own
    assert.equal(illustUrl(cosmetics.apply(base()), 'char_002_amiya', { skin: 'local/dusk' }), '/p/local/00000000/chen_dusk_illust.png');
  });

  it('the gate\'s rejection carries the reasons the section prints (a bad skinId)', async () => {
    const stored = await sw.storeSkinFiles([fakeFile('a.png', 'x')], { cache: fakeCache(), digest: fakeDigest });
    const r = register(sw.LOCAL_PLUGIN_ID, [sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'bad id!' }, stored)], { manifest: base() });
    assert.equal(r.ok, false);
    assert.ok(r.reasons.join('\n').includes('bad id!'));
  });
});

describe('skinWorkshop Spine groups (atlasPageNames / pairSpineGroup, P6 §3.3)', () => {
  const ATLAS = [
    'model.png', 'size: 64,64', 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
    'idle', '  rotate: false', '', 'model2.png', 'size: 64,64', 'filter: Linear,Linear', 'repeat: none', 'walk',
  ].join('\n');

  it('reads the atlas page names: the file may open with the first page, the rest follow blank lines', () => {
    assert.deepEqual(sw.atlasPageNames(ATLAS), ['model.png', 'model2.png']);
    assert.deepEqual(sw.atlasPageNames('\r\nmodel.png\r\nsize: 64,64\r\n\r\nmodel2.webp\r\nsize: 1,1\r\n'), ['model.png', 'model2.webp']);
    assert.deepEqual(sw.atlasPageNames('size: 64,64\nfilter: x\n'), []);
    assert.deepEqual(sw.atlasPageNames(null), []);
  });

  it('pairs a complete group by the atlas\'s own page names', () => {
    const pair = sw.pairSpineGroup([
      { name: 'model.skel', text: null }, { name: 'model.atlas', text: ATLAS },
      { name: 'model.png', text: null }, { name: 'model2.png', text: null },
    ]);
    assert.deepEqual(pair, { ok: true, skel: 'model.skel', atlas: 'model.atlas', pages: ['model.png', 'model2.png'] });
  });

  it('an atlas naming no pages falls back to the <skel>.png convention — present or refused', () => {
    const noNames = sw.pairSpineGroup([
      { name: 'model.skel' }, { name: 'model.atlas', text: 'size: 64,64\nfilter: x\n' }, { name: 'model.png' },
    ]);
    assert.deepEqual(noNames, { ok: true, skel: 'model.skel', atlas: 'model.atlas', pages: ['model.png'] });
    const none = sw.pairSpineGroup([{ name: 'model.skel' }, { name: 'model.atlas', text: '' }]);
    assert.equal(none.ok, false);
    assert.ok(none.reason.includes('model.png'));
  });

  it('refuses the incomplete groups the form must say: missing/extra skeleton, atlas mismatch, missing page', () => {
    const g = [
      { name: 'model.skel' }, { name: 'model.atlas', text: ATLAS }, { name: 'model.png' }, { name: 'model2.png' },
    ];
    assert.ok(sw.pairSpineGroup(g.slice(1)).reason.includes('.skel')); // no skeleton
    assert.ok(sw.pairSpineGroup([g[0], ...g]).reason.includes('2 个 .skel')); // two skeletons
    assert.ok(sw.pairSpineGroup([g[0]]).reason.includes('.atlas')); // no atlas
    assert.ok(sw.pairSpineGroup([{ name: 'other.skel' }, ...g.slice(1)]).reason.includes('不同名'));
    assert.ok(sw.pairSpineGroup(g.slice(0, 3)).reason.includes('model2.png')); // a named page missing
  });
});

describe('skinWorkstore Spine storage and payload (storeSkinFiles with a group / spinePayloadOf / buildSkinEntry)', () => {
  it('stores the pages beside the ATLAS (the loader resolves pages next to the atlas URL), parts carry no slot', async () => {
    const cache = fakeCache();
    const files = [fakeFile('model.skel', 's'), fakeFile('model.atlas', 'a'), fakeFile('model.png', 'p'), fakeFile('model2.png', 'q')];
    const group = { skel: 'model.skel', atlas: 'model.atlas', pages: ['model.png', 'model2.png'] };
    const stored = await sw.storeSkinFiles(files, { cache, digest: fakeDigest, spine: group });
    // digests: 's'→55555555, 'a'→77777777, 'p'→22222222, 'q'→99999999 — the pages live in the ATLAS's hash8 folder
    // (77777777), not their own
    assert.deepEqual(stored.map((s) => [s.name, s.url, s.slot]), [
      ['model.skel', '/p/local/55555555/model.skel', null],
      ['model.atlas', '/p/local/77777777/model.atlas', null],
      ['model.png', '/p/local/77777777/model.png', null],
      ['model2.png', '/p/local/77777777/model2.png', null],
    ]);
    // every stored key is one the SWs answer, and the atlas-relative page URL is served by the object cache
    for (const s of stored) assert.ok(cache.puts.has(pluginObjectKey(s.url, '')), s.url);
    // a picture alongside the group keeps its own hash folder and slot
    const mixed = await sw.storeSkinFiles([...files, fakeFile('portrait.png', 'r')],
      { cache: fakeCache(), digest: fakeDigest, slots: [null, null, null, null, 'portrait'], spine: group });
    assert.equal(mixed[4].slot, 'portrait');
    assert.equal(mixed[4].url, '/p/local/44444444/portrait.png'); // digest of 'r' is 4 — its own folder
  });

  it('spinePayloadOf + buildSkinEntry shape the register payload; the document round-trips it', async () => {
    const cache = fakeCache();
    const files = [fakeFile('model.skel', 's'), fakeFile('model.atlas', 'a'), fakeFile('model.png', 'p')];
    const group = { skel: 'model.skel', atlas: 'model.atlas', pages: ['model.png'] };
    const stored = await sw.storeSkinFiles(files, { cache, digest: fakeDigest, spine: group });
    const spine = sw.spinePayloadOf(group, stored);
    assert.deepEqual(spine, { model: '/p/local/55555555/model.skel', atlas: '/p/local/77777777/model.atlas', textures: ['/p/local/77777777/model.png'] });
    assert.equal(sw.spinePayloadOf({ skel: 'gone.skel', atlas: 'model.atlas', pages: [] }, stored), null);
    const entry = sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'dusk', spine }, stored);
    assert.deepEqual(entry, {
      charId: 'char_002_amiya', skinId: 'dusk', kind: 'spine',
      spine: { model: '/p/local/55555555/model.skel', atlas: '/p/local/77777777/model.atlas', textures: ['/p/local/77777777/model.png'] },
    });
    const rec = sw.docEntryOf(entry, stored);
    assert.deepEqual(rec.spine, spine);
    assert.deepEqual(sw.docToPayload([rec]), [{ charId: 'char_002_amiya', skinId: 'dusk', kind: 'spine', displayName: 'dusk', spine }]);
    assert.deepEqual(sw.docToPayload([{ charId: 'c', skinId: 's', slots: {} }]), [{ charId: 'c', skinId: 's', kind: 'static' }]);
  });

  it('a stored Spine skin wears and resolves through the manifest chain; the document registers on reload', async () => {
    reset();
    sw.localSkins.set({ skins: [] });
    const cache = fakeCache();
    const files = [fakeFile('model.skel', 's'), fakeFile('model.atlas', 'a'), fakeFile('model.png', 'p')];
    const group = { skel: 'model.skel', atlas: 'model.atlas', pages: ['model.png'] };
    const stored = await sw.storeSkinFiles(files, { cache, digest: fakeDigest, spine: group });
    const spine = sw.spinePayloadOf(group, stored);
    const entry = sw.buildSkinEntry({ charId: 'char_002_amiya', skinId: 'dusk', spine }, stored);
    assert.equal(register(sw.LOCAL_PLUGIN_ID, [entry], { manifest: base() }).ok, true);
    const rec = sw.docEntryOf(entry, stored);
    sw.localSkins.set({ skins: [rec] });
    const m = cosmetics.apply(base());
    assert.equal(skinHasModel(skinsOf(m, 'char_002_amiya')['local/dusk']), true);
    assert.deepEqual(spineEntry(m, 'char_002_amiya', { skin: 'local/dusk' }),
      { skel: spine.model, atlas: spine.atlas, textures: spine.textures, anims: {} });
    // the narrow record→dynamic mapping the picker reads: a registered dynamic skin maps (its static source is the
    // skin's own illust first — none here, so null), an official key (no '/') never maps
    const mapped = registeredDynamicArt(m, 'char_002_amiya', 'local/dusk');
    assert.deepEqual(mapped.entry, spineEntry(m, 'char_002_amiya', { skin: 'local/dusk' }));
    assert.equal(mapped.staticSrc, null);
    assert.equal(registeredDynamicArt(m, 'char_002_amiya', 'default'), null);
    assert.equal(registeredDynamicArt(m, 'char_002_amiya', 'local/static'), null); // registered but no spine block
  });
});
