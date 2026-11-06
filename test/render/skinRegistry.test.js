// Node tests for the skin plugin registry (public/js/skinRegistry.js, P6): the whole-plugin gate, the composed
// manifest's new skin records, the unregister fallback. The composition runs through the page's own cosmetic layers
// (cosmetics.apply) — the registry only hangs its synthetic layer onto them, so these tests assert that end to end.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { cosmetics, loadVisual } from '../../public/js/cosmetics.js';
import { isSkinId } from '../../shared/protocol.js';
import { avatarUrl, portraitUrl, illustUrl, skinsOf, skinHasModel, spineEntry, validSpine } from '../../public/js/assets.js';
import { appearanceEntry } from '../../public/js/ui/skinAssets.js';
import { register, unregister, unregisterSkin, reset, validateSkins, globalSkinKey } from '../../public/js/skinRegistry.js';

// the checks need the shared op machinery behind the layers (the page loads it on demand; tests load it once here)
await loadVisual();

/** The installation's manifest, as /data/assets.json would load it: two operators, no skins of their own. */
const base = () => ({
  chars: {
    char_002_amiya: {
      name: '阿米娅',
      avatar: '/assets/~1111111111111111/amiya.png',
      portrait: '/assets/~1111111111111111/amiya_1.png',
      illust: '/assets/~1111111111111111/amiya_i.png',
    },
    char_010_chen: { name: '陈', avatar: '/assets/~2222222222222222/chen.png' },
  },
});

const OK = { charId: 'char_002_amiya', skinId: 'look1', kind: 'static', displayName: '黄昏制服', avatar: '/p/myplugin/ab12cd34/a.png', portrait: '/p/myplugin/ab12cd34/p.png', illust: '/p/myplugin/ab12cd34/i.png' };
const composed = () => cosmetics.apply(base());

describe('skinRegistry.validateSkins (the whole-plugin gate)', () => {
  it('accepts a well-formed static skin and keeps the record to the manifest\'s own field names', () => {
    const r = validateSkins(base(), 'myplugin', [OK]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries, [{
      charId: 'char_002_amiya',
      key: 'myplugin/look1',
      record: { name: '黄昏制服', avatar: '/p/myplugin/ab12cd34/a.png', portrait: '/p/myplugin/ab12cd34/p.png', illust: '/p/myplugin/ab12cd34/i.png' },
    }]);
  });

  it('rejects an unknown charId', () => {
    const r = validateSkins(base(), 'myplugin', [{ ...OK, charId: 'char_999_ghost' }]);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.join('\n').includes('char_999_ghost'));
  });

  it('rejects a skinId registered twice in one plugin (one global key per skin)', () => {
    const r = validateSkins(base(), 'myplugin', [OK, { ...OK, displayName: '另一套' }]);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.join('\n').includes('twice'));
  });

  it("keeps the global key inside the wire's cap: a longer one would be refused by room.skins", () => {
    // The registry's key is what travels in room.skins, so it must satisfy shared/protocol.js isSkinId — one '/' and
    // the whole value inside SKIN_LIMITS.idLen (64). A skinId that registers here but is refused on the wire leaves
    // its player the only one who could ever see the skin.
    assert.equal(isSkinId(globalSkinKey('myplugin', 'look1')), true, 'the key the registry produces is the key the wire accepts');
    const cap = 64 - 'myplugin'.length - 1;
    const fits = validateSkins(base(), 'myplugin', [{ ...OK, skinId: 'x'.repeat(cap) }]);
    assert.equal(fits.ok, true, `the longest skinId that still fits: ${cap} characters`);
    assert.equal(fits.entries[0].key, `myplugin/${'x'.repeat(cap)}`);
    assert.equal(isSkinId(fits.entries[0].key), true);
    const over = validateSkins(base(), 'myplugin', [{ ...OK, skinId: 'x'.repeat(cap + 1) }]);
    assert.equal(over.ok, false);
    assert.match(over.reasons.join('\n'), /over the wire's 64 cap/);
  });

  it('rejects a URL outside the plugin space and an imported alias', () => {
    for (const slot of ['avatar', 'portrait', 'illust', 'avatarE2', 'portraitE2']) {
      for (const url of ['https://cdn.example.com/a.png', '/data/assets.json', '/assets/spine/x.png', 'avatar.png', 'p/myplugin/ab12cd34/a.png']) {
        const r = validateSkins(base(), 'myplugin', [{ ...OK, [slot]: url }]);
        assert.equal(r.ok, false, `${slot} ${url} must be refused`);
        assert.ok(r.reasons.join('\n').includes(slot));
      }
    }
  });

  it('accepts an imported alias for a picture slot', () => {
    const r = validateSkins(base(), 'myplugin', [{ ...OK, avatar: '/assets/~0123456789abcdef/x.png' }]);
    assert.equal(r.ok, true);
    assert.equal(r.entries[0].record.avatar, '/assets/~0123456789abcdef/x.png');
  });

  it('rejects a kind that is neither static nor spine', () => {
    const r = validateSkins(base(), 'myplugin', [{ ...OK, kind: 'l2d' }]);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.join('\n').includes('kind'));
  });

  it('accepts a spine skin only with model+atlas, both gated URLs of the right kind, and registers the manifest front entry', () => {
    const model = '/p/myplugin/ab12cd34/model.skel';
    const atlas = '/p/myplugin/ab12cd34/model.atlas';
    const r = validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: { model, atlas } }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries[0].record.spine, { front: { skel: model, atlas, anims: {} } });
    // the shape the dynamic chain reads (assets.js skinHasModel / spineEntry / validSpine)
    assert.equal(skinHasModel(r.entries[0].record), true);
    assert.equal(validSpine(r.entries[0].record.spine.front), true);
    // both URLs required and gated, each of its own kind
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: { model: '/data/m.skel', atlas } }]).ok, false);
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: { model, atlas: '/data/m.atlas' } }]).ok, false);
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: { model: '/p/myplugin/ab12cd34/model.json', atlas } }]).ok, false);
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: { model, atlas: '/p/myplugin/ab12cd34/model.png' } }]).ok, false);
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine' }]).ok, false);
    assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: 'model' }]).ok, false);
  });

  it('a spine skin carries the optional capped extras into the front entry, or is refused whole', () => {
    const spine = {
      model: '/p/myplugin/ab12cd34/model.skel', atlas: '/p/myplugin/ab12cd34/model.atlas',
      textures: ['/p/myplugin/ab12cd34/model.png', '/assets/~0123456789abcdef/page2.png'],
      pma: true, anims: { idle: 'Stand' }, bounds: { x: 0, y: 0, width: 720, height: 1280 },
    };
    const r = validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries[0].record.spine.front, {
      skel: spine.model, atlas: spine.atlas, anims: { idle: 'Stand' },
      textures: spine.textures, pma: true, bounds: spine.bounds,
    });
    for (const bad of [
      { ...spine, textures: ['/data/evil.png'] },
      { ...spine, textures: Array.from({ length: 17 }, () => '/p/myplugin/ab12cd34/p.png') },
      { ...spine, textures: 'model.png' },
      { ...spine, pma: 'yes' },
      { ...spine, anims: { idle: 7 } },
      { ...spine, anims: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`a${i}`, 'Idle'])) },
      { ...spine, bounds: { x: 0, y: 0, width: -1, height: 10 } },
      { ...spine, bounds: { x: 0, y: 0, width: Number.NaN, height: 10 } },
    ]) {
      assert.equal(validateSkins(base(), 'myplugin', [{ ...OK, kind: 'spine', spine: bad }]).ok, false, JSON.stringify(bad).slice(0, 60));
    }
  });

  it('rejects the whole plugin when one entry is bad — not a part of it', () => {
    const r = validateSkins(base(), 'myplugin', [OK, { ...OK, skinId: 'look2', avatar: '/data/evil.png' }]);
    assert.equal(r.ok, false);
    assert.equal(r.entries, undefined);
    assert.ok(r.reasons.join('\n').includes('skins[1]'));
  });

  it('rejects a bad pluginId, a non-list payload, and a manifest without chars', () => {
    for (const id of ['Myplugin', 'my/plugin', 'a', '', 'x'.repeat(33)]) {
      assert.equal(validateSkins(base(), id, [OK]).ok, false, `pluginId ${JSON.stringify(id)}`);
    }
    assert.equal(validateSkins(base(), 'myplugin', 'look1').ok, false);
    assert.equal(validateSkins({}, 'myplugin', [OK]).ok, false);
  });

  it('lets a payload field outside the whitelist never reach the record', () => {
    const r = validateSkins(base(), 'myplugin', [{ ...OK, spine: { front: { skel: '/data/x.skel' } }, evil: { a: 1 } }]);
    assert.equal(r.ok, true);
    assert.equal('spine' in r.entries[0].record, false);
    assert.equal('evil' in r.entries[0].record, false);
  });
});

describe('skinRegistry.register / unregister (the page singleton)', () => {
  beforeEach(() => reset());

  it('changes nothing with nothing registered: the composed manifest IS the base one', () => {
    const m = base();
    assert.equal(cosmetics.apply(m), m);
    assert.equal(cosmetics.skins, null);
    assert.equal(cosmetics.active, false);
  });

  it('the entries land in the composed manifest and every art lookup resolves them', () => {
    const r = register('myplugin', [OK], { manifest: base() });
    assert.equal(r.ok, true);
    const m = composed();
    assert.deepEqual(skinsOf(m, 'char_002_amiya')['myplugin/look1'], r.entries[0].record);
    assert.deepEqual(appearanceEntry(m, 'char_002_amiya', 'myplugin/look1'), r.entries[0].record);
    const key = 'myplugin/look1';
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: key }), '/p/myplugin/ab12cd34/a.png');
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: key, e2: true }), '/p/myplugin/ab12cd34/a.png');
    assert.equal(portraitUrl(m, 'char_002_amiya', { skin: key }), '/p/myplugin/ab12cd34/p.png');
    assert.equal(illustUrl(m, 'char_002_amiya', { skin: key }), '/p/myplugin/ab12cd34/i.png');
  });

  it('a slot the skin lacks falls back to the operator\'s own art, never a placeholder', () => {
    register('myplugin', [{ ...OK, displayName: '只有立绘', avatar: undefined, portrait: undefined, illust: '/p/myplugin/ab12cd34/i.png' }], { manifest: base() });
    const m = composed();
    const key = 'myplugin/look1';
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: key }), '/assets/~1111111111111111/amiya.png');
    assert.equal(portraitUrl(m, 'char_002_amiya', { skin: key }), '/p/myplugin/ab12cd34/i.png');
    assert.equal(illustUrl(m, 'char_002_amiya', { skin: key }), '/p/myplugin/ab12cd34/i.png');
  });

  it('the base manifest is never mutated: the entries are copies on the way', () => {
    const m = base();
    register('myplugin', [OK], { manifest: m });
    assert.equal(m.chars.char_002_amiya.skins, undefined);
    const again = cosmetics.apply(m);
    assert.notEqual(again, m);
    assert.notEqual(again.chars, m.chars);
  });

  it('a rejected register writes nothing and leaves a previous registration standing', () => {
    const seen = [];
    const off = cosmetics.subscribe(() => seen.push(1));
    assert.equal(register('myplugin', [OK], { manifest: base() }).ok, true);
    assert.equal(seen.length, 1);
    const bad = register('myplugin', [{ ...OK, skinId: 'look2', avatar: '/data/evil.png' }], { manifest: base() });
    assert.equal(bad.ok, false);
    assert.equal(seen.length, 1); // no broadcast, nothing changed
    const m = composed();
    assert.ok(skinsOf(m, 'char_002_amiya')['myplugin/look1']); // the old registration stands
    assert.equal(skinsOf(m, 'char_002_amiya')['myplugin/look2'], undefined);
    off();
  });

  it('re-registering a pluginId is idempotent: the last registration wins', () => {
    register('myplugin', [OK], { manifest: base() });
    const again = register('myplugin', [OK], { manifest: base() });
    assert.equal(again.ok, true);
    assert.deepEqual(skinsOf(composed(), 'char_002_amiya')['myplugin/look1'], again.entries[0].record);
    const second = register('myplugin', [{ ...OK, skinId: 'look2', displayName: '另一套' }], { manifest: base() });
    assert.equal(second.ok, true);
    const map = skinsOf(composed(), 'char_002_amiya');
    assert.equal(map['myplugin/look1'], undefined);
    assert.ok(map['myplugin/look2']);
  });

  it('two plugins may carry the same skinId: the global key keeps them apart', () => {
    register('myplugin', [OK], { manifest: base() });
    register('other', [{ ...OK, avatar: '/p/other/ef01ab23/a.png', portrait: '/p/other/ef01ab23/p.png', illust: '/p/other/ef01ab23/i.png' }], { manifest: base() });
    const map = skinsOf(composed(), 'char_002_amiya');
    assert.equal(globalSkinKey('other', 'look1'), 'other/look1');
    assert.equal(avatarUrl(composed(), 'char_002_amiya', { skin: 'myplugin/look1' }), '/p/myplugin/ab12cd34/a.png');
    assert.equal(avatarUrl(composed(), 'char_002_amiya', { skin: 'other/look1' }), '/p/other/ef01ab23/a.png');
    assert.ok(map['myplugin/look1'] && map['other/look1']);
  });

  it('a spine entry wears its own battle model through the manifest chain', () => {
    const model = '/p/myplugin/ab12cd34/model.skel';
    const atlas = '/p/myplugin/ab12cd34/model.atlas';
    register('myplugin', [{ ...OK, kind: 'spine', spine: { model, atlas, anims: { idle: 'Stand' } } }], { manifest: base() });
    const m = composed();
    const rec = skinsOf(m, 'char_002_amiya')['myplugin/look1'];
    assert.equal(skinHasModel(rec), true); // the same predicate the picker's wearable and the renderer read
    assert.deepEqual(spineEntry(m, 'char_002_amiya', { skin: 'myplugin/look1' }),
      { skel: model, atlas, anims: { idle: 'Stand' } });
    // a static skin (no spine) still resolves no model of its own — the operator's own model is worn
    register('other', [OK], { manifest: base() });
    assert.equal(spineEntry(m, 'char_002_amiya', { skin: 'other/look1' }),
      spineEntry(m, 'char_002_amiya'));
  });

  it('unregister removes the plugin\'s entries; a worn skin falls back to the operator\'s own art', () => {
    register('myplugin', [OK], { manifest: base() });
    register('other', [{ ...OK, skinId: 'look2' }], { manifest: base() });
    assert.deepEqual(unregister('myplugin'), ['myplugin/look1']);
    const m = composed();
    const key = 'myplugin/look1';
    assert.equal(appearanceEntry(m, 'char_002_amiya', key), null);
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: key }), '/assets/~1111111111111111/amiya.png');
    assert.equal(portraitUrl(m, 'char_002_amiya', { skin: key }), '/assets/~1111111111111111/amiya_1.png');
    assert.equal(illustUrl(m, 'char_002_amiya', { skin: key }), '/assets/~1111111111111111/amiya_i.png');
    assert.ok(appearanceEntry(m, 'char_002_amiya', 'other/look2')); // the other plugin stands
  });

  it('unregistering an unknown pluginId is a silent no-op', () => {
    let told = 0;
    const off = cosmetics.subscribe(() => { told += 1; });
    assert.deepEqual(unregister('myplugin'), []);
    assert.equal(told, 0);
    assert.equal(cosmetics.skins, null);
    off();
  });

  it('unregisterSkin removes ONE skin of a plugin; the others and other plugins stand; a worn key falls back', () => {
    register('myplugin', [OK, { ...OK, skinId: 'look2', displayName: '另一套' }], { manifest: base() });
    register('other', [{ ...OK, skinId: 'look9', avatar: '/p/other/ef01ab23/a.png', portrait: '/p/other/ef01ab23/p.png', illust: '/p/other/ef01ab23/i.png' }], { manifest: base() });
    assert.equal(unregisterSkin('myplugin', 'look1'), 'myplugin/look1');
    const m = composed();
    const gone = 'myplugin/look1';
    assert.equal(appearanceEntry(m, 'char_002_amiya', gone), null);
    assert.equal(avatarUrl(m, 'char_002_amiya', { skin: gone }), '/assets/~1111111111111111/amiya.png');
    assert.equal(portraitUrl(m, 'char_002_amiya', { skin: gone }), '/assets/~1111111111111111/amiya_1.png');
    assert.ok(skinsOf(m, 'char_002_amiya')['myplugin/look2']); // the plugin's other entry stands
    assert.ok(skinsOf(m, 'char_002_amiya')['other/look9']); // so does the other plugin's
  });

  it('unregisterSkin on the last entry leaves no plugin behind: a later unregister is an empty no-op', () => {
    register('myplugin', [OK], { manifest: base() });
    assert.equal(unregisterSkin('myplugin', 'look1'), 'myplugin/look1');
    assert.equal(cosmetics.skins, null);
    assert.deepEqual(unregister('myplugin'), []);
    assert.equal(unregisterSkin('myplugin', 'look1'), null);
    const m = base();
    assert.equal(cosmetics.apply(m), m);
  });

  it('unregisterSkin with an unknown pluginId or skinId returns null, says nothing and changes nothing', () => {
    register('myplugin', [OK], { manifest: base() });
    let told = 0;
    const off = cosmetics.subscribe(() => { told += 1; });
    assert.equal(unregisterSkin('nope', 'look1'), null);
    assert.equal(unregisterSkin('myplugin', 'nope'), null);
    assert.equal(unregisterSkin('myplugin', null), null);
    assert.equal(told, 0);
    off();
    assert.ok(skinsOf(composed(), 'char_002_amiya')['myplugin/look1']);
  });

  it('a skin removed by unregisterSkin may be registered again under the same skinId', () => {
    register('myplugin', [OK], { manifest: base() });
    unregisterSkin('myplugin', 'look1');
    const again = register('myplugin', [OK], { manifest: base() });
    assert.equal(again.ok, true);
    assert.deepEqual(appearanceEntry(composed(), 'char_002_amiya', 'myplugin/look1'), again.entries[0].record);
  });

  it('reset drops everything and the composed manifest is the base one again', () => {
    register('myplugin', [OK], { manifest: base() });
    reset();
    const m = base();
    assert.equal(cosmetics.apply(m), m);
    assert.equal(cosmetics.active, false);
  });
});
