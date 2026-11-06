import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packRootOf, packStateOf, markPackInstalled, markPackRemoved, markPackMissing, onPackInstalled, resetPackState, resolve,
} from '../../public/js/resourcePacks.js';
import * as reexported from '../../public/js/materialFallback.js';

const skel = '/assets/spine/enemy/enemy_1165_duhond_2/enemy_1165_duhond_2.skel';

test('packRootOf classifies public material URLs; imported aliases, /media and plugin files are outside packs', () => {
  assert.equal(packRootOf(skel), '/assets/spine');
  assert.equal(packRootOf('/assets/char/char_002_amiya/1.png'), '/assets/char');
  assert.equal(packRootOf('/fonts/Novecento.ttf'), '/fonts');
  assert.equal(packRootOf('/assets/nosegment'), '/assets/nosegment', 'a bare file becomes its own root');
  assert.equal(packRootOf('/assets/~0123456789abcdef/x.png'), '/assets/~0123456789abcdef', 'an imported prefix is still a root');
  assert.equal(packRootOf('/media/bgm/prep'), null);
  assert.equal(packRootOf('/p/skin123/abcd1234/art.png'), null);
  assert.equal(packRootOf('/data/assets.json'), null);
  assert.equal(packRootOf('https://other.example/assets/x.png'), null, 'cross-origin stays untouched');
  assert.equal(packRootOf(null), null);
  assert.equal(packRootOf(undefined), null);
});

test('resolve answers imported prefixes directly and never rewrites the URL', () => {
  const imported = '/assets/~0123456789abcdef/char_002_amiya.png';
  assert.deepEqual(resolve(imported), { url: imported, state: 'ok', source: 'imported' });
  assert.deepEqual(resolve('/fonts/~0123456789abcdef/Novecento.ttf').state, 'ok');
  assert.deepEqual(resolve('/media/~0123456789abcdef/voice.mp3').state, 'ok');
  assert.deepEqual(resolve('/assets/~short/x.png').source, 'none', 'a non-16-hex segment is not an import');
  for (const url of [skel, '/media/bgm/prep', '/p/x/abcd1234/a.png', null]) {
    assert.equal(resolve(url).url, url, 'the URL goes back untouched');
  }
});

test('resolve reflects learned pack state; unknown state never objects to a load', () => {
  resetPackState();
  assert.deepEqual(resolve(skel), { url: skel, state: 'unknown', source: 'none' });
  assert.equal(packStateOf(skel), 'unknown');
  markPackMissing(skel, 'enemy_1165_duhond_2/');
  assert.deepEqual(resolve(skel), { url: skel, state: 'missing', source: 'none' });
  assert.deepEqual(resolve('/assets/spine/other/other.skel').state, 'missing', 'the state is per pack root');
  assert.deepEqual(resolve('/assets/char/char_002_amiya/1.png').state, 'unknown', 'other roots stay unknown');
  markPackInstalled(skel);
  assert.deepEqual(resolve(skel), { url: skel, state: 'ok', source: 'pack' });
  resetPackState();
  assert.deepEqual(resolve(skel).state, 'unknown', 'reset clears the table');
});

test('markPackMissing warns once per pack root for the page lifetime', () => {
  resetPackState();
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(markPackMissing(skel), true);
    assert.equal(markPackMissing(skel), false, 'the same root never warns twice');
    assert.equal(markPackMissing('/assets/spine/other/other.skel'), false, 'the same root via another file');
    assert.equal(markPackMissing('/media/bgm/prep'), false, 'a URL outside any pack has no root to learn');
    assert.equal(markPackMissing('/assets/char/char_002_amiya/1.png'), true, 'another root warns on its own');
  } finally { console.warn = original; }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^\[assets\] \/assets\/spine pack is missing/);
  assert.match(warnings[1], /^\[assets\] \/assets\/char pack is missing/);
  resetPackState();
});

test('markPackInstalled flips roots to ok and tells the listeners exactly what changed', () => {
  resetPackState();
  const seen = [];
  const off = onPackInstalled((roots) => seen.push(roots));
  assert.deepEqual(markPackInstalled([skel, '/fonts/Novecento.ttf', '/media/bgm/prep', '/assets']),
    ['/assets/spine', '/fonts', '/assets'], 'out-of-scope refs are ignored, plain roots are accepted');
  assert.deepEqual(seen, [['/assets/spine', '/fonts', '/assets']]);
  assert.deepEqual(markPackInstalled([skel]), [], 'an installed root does not notify again');
  assert.deepEqual(seen, [['/assets/spine', '/fonts', '/assets']]);
  off();
  markPackMissing('/assets/char/char_002_amiya/1.png');
  markPackInstalled([skel, '/assets/char/char_002_amiya/1.png']);
  assert.deepEqual(seen, [['/assets/spine', '/fonts', '/assets']], 'an unsubscribed listener hears nothing more');
  assert.equal(resolve('/assets/char/char_002_amiya/1.png').state, 'ok', 'an install clears a proven-absent root');
  resetPackState();
});

test('markPackRemoved drops what the table learned, so a pruned pack can be proven absent again', () => {
  resetPackState();
  markPackInstalled([skel]);
  assert.deepEqual(markPackRemoved([skel]), ['/assets/spine'], 'only a root with learned state changes');
  assert.deepEqual(resolve(skel), { url: skel, state: 'unknown', source: 'none' },
    'the table stops claiming a pack it can no longer serve — it does not claim it is absent');
  assert.equal(packStateOf(skel), 'unknown');
  assert.deepEqual(markPackRemoved([skel]), [], 'a root with nothing learned changes nothing');
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(markPackMissing(skel), true, 'the one-warning went with the state, so the root can warn again');
    assert.equal(markPackMissing(skel), false, 'and warns once, as ever');
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  resetPackState();
});

test('markPackRemoved notifies the listeners exactly as an install does, once per changed root', () => {
  resetPackState();
  const seen = [];
  const off = onPackInstalled((roots) => seen.push(roots));
  const imported = '/assets/~0123456789abcdef/x.png';
  assert.deepEqual(markPackInstalled([skel, imported, '/fonts']),
    ['/assets/spine', '/assets/~0123456789abcdef', '/fonts']);
  assert.deepEqual(markPackRemoved([imported, '/media/bgm/prep', '/fonts']),
    ['/assets/~0123456789abcdef', '/fonts'], 'a pruned import path is a root too; out-of-scope refs are ignored');
  assert.deepEqual(seen, [
    ['/assets/spine', '/assets/~0123456789abcdef', '/fonts'],
    ['/assets/~0123456789abcdef', '/fonts'],
  ], 'the purge hook hears both flips');
  assert.deepEqual(markPackRemoved([skel]), ['/assets/spine'], 'a root still learned is removed too');
  assert.deepEqual(markPackRemoved([skel, imported]), [], 'nothing is learned any more, so nothing changes');
  assert.equal(seen.length, 3, 'a no-op removal does not notify');
  off();
  resetPackState();
});

test('materialFallback re-exports the manager live: one shared state, never a copy', () => {
  assert.equal(reexported.packRootOf, packRootOf);
  assert.equal(reexported.packStateOf, packStateOf);
  assert.equal(reexported.markPackInstalled, markPackInstalled);
  assert.equal(reexported.markPackRemoved, markPackRemoved);
  assert.equal(reexported.markPackMissing, markPackMissing);
  assert.equal(reexported.onPackInstalled, onPackInstalled);
  assert.equal(reexported.resetPackState, resetPackState);
  resetPackState();
  markPackMissing(skel);
  assert.equal(reexported.packStateOf(skel), 'missing', 'the re-exports share one table');
  resetPackState();
});
