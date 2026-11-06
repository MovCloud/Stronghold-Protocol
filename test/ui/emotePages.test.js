// test/ui/emotePages.test.js — public/js/ui/emotePages.js: how the wheel learns that a plugin has a page (docs/PLUGINS.md
// §10c). A page is data, not art, so it is not in the art manifest: the client finds it in the visual set's file table
// (overlays[].files, path → SHA-256) and reads it hash-pinned at /p/<pluginId>/<hash8>/emotes.json. With no layer
// nothing is listed and nothing is asked for — the invariant test/ui/plugins.e2e.test.js checks on the page.
//
// The wheel itself stays in the core (public/js/ui/emotes.js), because a plugin has no interface slot for it
// (shared/plugins/manifest.js UI_SLOT_IDS). emotes.js is not imported here — it pulls the DOM in through
// components.js — so its two plugin behaviours (the pager counts core + plugin pages, and a missing picture says which
// 表情包组 the emote came from) are locked by reading the source, as test/ui/emotes.test.js does for the labels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emotePageUrl, listedPages, emotePages, resolveEmotePages, subscribeEmotePages } from '../../public/js/ui/emotePages.js';
import { cosmetics, loadVisual } from '../../public/js/cosmetics.js';
import { EMOTE_PAGE_FILE, readEmotePage } from '../../shared/plugins/emoteCatalog.js';
import { FILE_URL_DIGITS, PLUGIN_FILES_URL, VISUAL_LIMITS, pluginFileUrl } from '../../shared/plugins/visual.js';
import { sha256Hex } from '../../shared/sha256.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CLIENT = src('public/js/ui/emotePages.js');
const WHEEL = src('public/js/ui/emotes.js');

const jsonText = (o) => JSON.stringify(o, null, 2);

const PAGE = {
  version: 1, name: '表情套组：Ciallo', sortId: 100003,
  emotes: [{ id: 'emote_ciallo_murasame', sortId: 20001, picId: 'pic_ciallo_murasame_battle', label: '丛雨 Ciallo' }],
};
/** A file the file table lists but that is not a page: it keeps its title instead (EmoteBubble). */
const NOT_A_PAGE = { version: 2, name: 'Broken', emotes: [] };

const setDoc = (v, pluginId, files, ops) => {
  const parts = { assets: 'aa'.repeat(32), overlays: [{ id: pluginId, version: '1.0.0', files, writes: v.writesHashOf(ops) }] };
  return { visual: { v: v.VISUAL_HASH_VERSION, vs: v.visualHashOf(parts), ...parts }, writes: [{ id: pluginId, ops }] };
};

test('the URL form is the same as shared/plugins/visual.js: FILE_URL_DIGITS and the part file name', () => {
  assert.equal(Number(/const URL_HASH_DIGITS = (\d+);/.exec(CLIENT)[1]), FILE_URL_DIGITS);
  assert.equal(/const PLUGIN_FILES_URL = '([^']+)'/.exec(CLIENT)[1], PLUGIN_FILES_URL);
  // the file name comes from emoteCatalog.js (which a test locks to PARTS.emotes.name), it is not hardcoded here
  assert.equal(EMOTE_PAGE_FILE, 'emotes.json');
  assert.match(CLIENT, /files\?\.\[EMOTE_PAGE_FILE\]/);
  // shared/plugins/visual.js is deliberately not imported (the title page carries it lazily through cosmetics.js);
  // the header may name it in prose, so only an import line counts
  assert.doesNotMatch(CLIENT, /^import [^\n]*visual\.js/m);
  assert.doesNotMatch(CLIENT, /^import [^\n]*'node:/m);
  assert.ok(CLIENT.includes('readEmotePage'), 'the page is read with the same reader the server uses');
});

test('emotePageUrl is pluginFileUrl for the page file (hash-pinned, first 8 hex)', () => {
  const hash = sha256Hex(jsonText(PAGE));
  const url = emotePageUrl('ciallo', hash);
  assert.equal(url, pluginFileUrl('ciallo', hash.slice(0, FILE_URL_DIGITS), EMOTE_PAGE_FILE));
  assert.equal(url, `${PLUGIN_FILES_URL}ciallo/${hash.slice(0, FILE_URL_DIGITS)}/${EMOTE_PAGE_FILE}`);
  assert.equal(emotePageUrl('ciallo', 'not-a-sha256'), null, 'an unlisted page is never asked for');
  assert.equal(emotePageUrl('', hash), null);
  assert.equal(emotePageUrl('my plugin', hash), `${PLUGIN_FILES_URL}my%20plugin/${hash.slice(0, FILE_URL_DIGITS)}/${EMOTE_PAGE_FILE}`);
});

test('no layer: nothing listed, nothing asked for (a page without plugins fetches nothing)', async () => {
  assert.equal(cosmetics.active, false, 'this file starts with no layer');
  assert.deepEqual(listedPages(), []);
  assert.deepEqual(emotePages(), []);
  let asked = 0;
  const pages = await resolveEmotePages(() => { asked++; return { ok: true, json: async () => PAGE }; });
  assert.equal(asked, 0, 'no layer, no request');
  assert.deepEqual(pages, []);
});

test('a room layer that lists emotes.json: read once, at the hash-pinned URL, never asked for again', async () => {
  const v = await loadVisual();
  const hash = sha256Hex(jsonText(PAGE));
  const ops = [{ at: ['ui', 'emoticon/ciallo'], file: 'pic_ciallo_murasame_battle.png' }];
  const doc = setDoc(v, 'ciallo', { [EMOTE_PAGE_FILE]: hash, 'pic_ciallo_murasame_battle.png': sha256Hex('p') }, ops);
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, json: async () => PAGE }; };
  cosmetics.setRoom(doc);
  assert.deepEqual(listedPages(), [{ pluginId: 'ciallo', hash }], 'the file table is the channel');
  assert.deepEqual(emotePages(), [], 'listed is not yet read');
  const told = [];
  const off = subscribeEmotePages(() => told.push(emotePages().length));
  const pages = await resolveEmotePages(fetchImpl);
  assert.deepEqual(asked, [pluginFileUrl('ciallo', hash.slice(0, FILE_URL_DIGITS), EMOTE_PAGE_FILE)]);
  assert.deepEqual(pages.map((p) => p.themeId), ['emoticon_x_ciallo']);
  assert.deepEqual(pages.map((p) => p.name), ['表情套组：Ciallo'], 'the title is what the wheel shows for a page');
  assert.deepEqual(pages.map((p) => p.dir), ['emoticon/ciallo']);
  assert.deepEqual(told, [1], 'the wheel is told once, after the page arrives');
  off();
  await resolveEmotePages(fetchImpl);
  assert.equal(asked.length, 1, 'one request per URL, never asked again');
});

test('a page the file table lists but that is not a page: it keeps its title and is never asked for again', async () => {
  const v = await loadVisual();
  const badHash = sha256Hex(jsonText(NOT_A_PAGE));
  const doc = setDoc(v, 'broken', { [EMOTE_PAGE_FILE]: badHash }, []);
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, json: async () => NOT_A_PAGE }; };
  // the room page from the test above is still there: a personal layer applies after it
  cosmetics.setPersonal([{ id: 'broken', doc }]);
  assert.deepEqual(listedPages().map((l) => l.pluginId), ['ciallo', 'broken'], 'in the order the layers apply');
  const warn = console.warn;
  console.warn = () => {};
  try {
    const pages = await resolveEmotePages(fetchImpl);
    assert.deepEqual(pages.map((p) => p.pluginId), ['ciallo'], 'the broken page is not there, the room page still is');
    assert.equal(asked.length, 1);
    assert.equal(readEmotePage(NOT_A_PAGE, 'broken', { problem: () => {} }), null);
    await resolveEmotePages(fetchImpl);
    assert.equal(asked.length, 1, 'a URL that failed is never asked again');
  } finally { console.warn = warn; }
  cosmetics.setPersonal([]);
  cosmetics.setRoom(null);
  assert.deepEqual(listedPages(), [], 'layers taken away: nothing listed again');
});

test('the wheel stays in the core: the pager counts core + plugin pages, a missing picture says the page title', () => {
  assert.match(WHEEL, /const pages = wheelPages\(EMOTE_THEMES, useEmotePages\(\)\);/, 'the denominator is core pages + plugin pages');
  assert.match(WHEEL, /\$\{page \+ 1\}\/\$\{pages\.length\}/, 'the numeric count the fork kept, over core + plugin pages');
  assert.match(WHEEL, /role="status">\$\{t\(page\.name\)\}<\/div>/, 'the page title takes the icon place for a missing picture');
  assert.match(WHEEL, /import \{[^}]*useEmotePages[^}]*\} from '\.\/emotePages\.js'/);
});

test('a page can never shadow an official emote: the ids are namespaced, VISUAL_LIMITS.listFiles is the pages a room shows', () => {
  assert.equal(EMOTE_PAGE_FILE, 'emotes.json');
  assert.ok(VISUAL_LIMITS.listFiles >= 1);
  const list = { problems: [], problem: (code, text) => list.problems.push(code) };
  const page = readEmotePage(PAGE, 'ciallo', list);
  assert.deepEqual(list.problems, []);
  assert.equal(page.themeId, 'emoticon_x_ciallo');
  assert.ok(page.emotes.every((e) => e.id.startsWith('emote_ciallo_')), 'never an official id');
});
