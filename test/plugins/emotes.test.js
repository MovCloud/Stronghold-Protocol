// test/plugins/emotes.test.js — the `emotes` part of PLUGIN API v2 (shared/plugins/emoteCatalog.js, docs/PLUGINS.md §10c):
// one file is one page of the emote wheel, so a 表情包组 occupies a page exactly as an official theme does. The part is
// data only — no plugin code runs and there is no interface slot for the wheel (shared/plugins/manifest.js UI_SLOT_IDS),
// so a plugin contributes a page of data and no widget. Three things hold the design up and are what these tests lock:
// the page file is always named emotes.json and a plugin declares exactly one (the number of files a visual set may
// list), its ids are namespaced with the plugin id so a page can never shadow one of the official 36, and the page
// rides in the visual set's file table — the channel the client reads — although it is not art. The client side
// (public/js/ui/emotePages.js) is covered by test/ui/emotePages.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMOTE_PART, EMOTE_PAGE_FILE, EMOTE_PAGE_VERSION, EMOTE_PAGE_LIMIT, EMOTE_PAGE_MAX_EMOTES,
  EMOTE_PAGE_NAME_MAX, EMOTE_LABEL_MAX, EMOTE_PIC_MAX, EMOTE_SORT_MAX,
  isPluginEmoteId, emotePageDir, emotePageId, readEmotePage, wheelPages, pageOf,
} from '../../shared/plugins/emoteCatalog.js';
import { VISUAL_LIMITS, FILE_URL_DIGITS, PLUGIN_FILES_URL, pluginFileUrl } from '../../shared/plugins/visual.js';
import { EMOTES, EMOTE_THEMES, PLUGIN_API } from '../../shared/constants.js';
import { MANIFEST_FIELDS, readPluginManifest } from '../../shared/plugins/manifest.js';
import { validateC2S } from '../../shared/protocol.js';
import { sha256Hex } from '../../shared/sha256.js';
import { readPluginFolder, readVanillaAssets } from '../../server/plugins/registry.js';
import { schemaValidator } from '../helpers/jsonSchema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-emotes-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** One well-formed page (the shape of PLUGINS.md §10c): 6 cells, ids namespaced with the plugin id. */
const PAGE = {
  version: 1, name: '表情套组：Ciallo', sortId: 100003,
  emotes: [
    { id: 'emote_ciallo_murasame', sortId: 20001, picId: 'pic_ciallo_murasame_battle', label: '丛雨 Ciallo' },
    { id: 'emote_ciallo_yoshino', sortId: 20002, picId: 'pic_ciallo_yoshino_battle', label: '芳乃 Ciallo' },
  ],
};
/** readEmotePage takes an issue list, or anything with a problem(code, text) method (the client has no errors.js). */
const list = () => { const problems = []; return { problems, problem: (code, text) => problems.push({ code, text }) }; };
const read = (page, pluginId = 'ciallo') => { const l = list(); return [readEmotePage(page, pluginId, l), l.problems.map((p) => p.code)]; };

test('the part is one page of the wheel: its name, its cell count, and the file table it rides in', () => {
  assert.equal(EMOTE_PART, 'emotes');
  assert.equal(EMOTE_PAGE_FILE, 'emotes.json');
  assert.equal(EMOTE_PAGE_VERSION, 1);
  // a page is the 3×2 cells of a core page, and a room can show as many plugin pages as its set lists files
  assert.equal(EMOTE_PAGE_MAX_EMOTES, EMOTE_THEMES[0].emotes.length, 'the cells of one wheel page');
  assert.equal(EMOTE_PAGE_LIMIT, VISUAL_LIMITS.listFiles, 'the pages a room can show = the files a visual set may list');
  assert.equal(EMOTE_SORT_MAX, 1000000, 'the range of the official theme table');
  // PARTS is not exported, so the part's shape is locked to the source: one file, always named emotes.json
  const src = fs.readFileSync(path.join(ROOT, 'shared/plugins/manifest.js'), 'utf8');
  assert.match(src, /emotes: \{ classes: \['cosmetic', 'content'\], shape: 'list', needs: \[\], maxFiles: 1, name: 'emotes\.json' \},/);
  assert.ok(MANIFEST_FIELDS.includes('emotes'), 'the field is a manifest field');
  assert.ok(MANIFEST_FIELDS.indexOf('dsl') < MANIFEST_FIELDS.indexOf('emotes')
    && MANIFEST_FIELDS.indexOf('emotes') < MANIFEST_FIELDS.indexOf('enemies'), 'alphabetical, as the surface table is built');
});

test('readEmotePage: a well-formed page, and every rule §10c states', () => {
  const [page, problems] = read(PAGE);
  assert.deepEqual(problems, []);
  assert.deepEqual([page.pluginId, page.themeId, page.name, page.sortId, page.dir],
    ['ciallo', 'emoticon_x_ciallo', '表情套组：Ciallo', 100003, 'emoticon/ciallo']);
  assert.deepEqual(page.emotes.map((e) => e.id), ['emote_ciallo_murasame', 'emote_ciallo_yoshino']);

  const bad = (extra, code) => {
    const [r, codes] = read({ ...PAGE, ...extra });
    assert.equal(r, null, JSON.stringify(codes));
    assert.deepEqual(codes, [code], JSON.stringify(codes));
  };
  bad({ version: 2 }, 'PLUGIN_DATA_TYPE');
  bad({ name: '  ' }, 'PLUGIN_EMPTY');
  bad({ name: 'x'.repeat(EMOTE_PAGE_NAME_MAX + 1) }, 'PLUGIN_DATA_LIMIT');
  bad({ sortId: 0 }, 'PLUGIN_DATA_NUMBER');
  bad({ sortId: EMOTE_SORT_MAX + 1 }, 'PLUGIN_DATA_NUMBER');
  bad({ emotes: [] }, 'PLUGIN_DATA_LIMIT');
  bad({ emotes: Array.from({ length: EMOTE_PAGE_MAX_EMOTES + 1 }, (_, i) => ({ ...PAGE.emotes[0], id: `emote_ciallo_${i}` })) }, 'PLUGIN_DATA_LIMIT');

  // one cell broken: the rest of the page is still read, so a page is never lost to one bad line
  const one = read({ ...PAGE, emotes: [PAGE.emotes[0], { ...PAGE.emotes[1], id: 'emote_other_yoshino' }] });
  assert.deepEqual(one[1], ['PLUGIN_RECORD_ID']);
  assert.deepEqual(one[0].emotes.map((e) => e.id), ['emote_ciallo_murasame']);
  for (const [cell, code] of [
    [{ id: 'emote_ciallo_x', sortId: 1, picId: 'pic_ciallo_x', label: 'x' }, null],
    [{ id: 'emote_ciallo_x', sortId: 1, picId: 'pic ciallo x', label: 'x' }, 'PLUGIN_DATA_PATH'],
    [{ id: 'emote_ciallo_x', sortId: 1, picId: 'pic_ciallo_x', label: ' ' }, 'PLUGIN_DATA_TYPE'],
    [{ id: 'emote_ciallo_x', sortId: 0, picId: 'pic_ciallo_x', label: 'x' }, 'PLUGIN_DATA_NUMBER'],
  ]) {
    const [r, codes] = read({ ...PAGE, emotes: [cell] });
    assert.deepEqual(codes, code ? [code] : [], JSON.stringify(codes));
    if (code) assert.equal(r, null);
  }
  // a duplicate id is the one thing a cell cannot fix by itself
  const dup = read({ ...PAGE, emotes: [PAGE.emotes[0], { ...PAGE.emotes[0], sortId: 20009 }] });
  assert.deepEqual(dup[1], ['PLUGIN_RECORD_ID']);
  // cells come out in sortId order, whatever the file says
  const sorted = read({ ...PAGE, emotes: [PAGE.emotes[1], PAGE.emotes[0]] })[0];
  assert.deepEqual(sorted.emotes.map((e) => e.sortId), [20001, 20002]);
});

test('ids are namespaced with the plugin id: a page can never shadow one of the official 36', () => {
  assert.ok(isPluginEmoteId('emote_ciallo_murasame'));
  for (const id of EMOTES) assert.ok(!isPluginEmoteId(id), id);
  assert.ok(!isPluginEmoteId('emote_ciallo'), 'no slug');
  assert.ok(!isPluginEmoteId('__proto__'));
  // the namespace is the plugin id with '-' turned into '_'; another plugin's page is not this one's
  assert.equal(emotePageDir('my-plugin'), 'emoticon/my_plugin');
  assert.equal(emotePageId('my-plugin'), 'emoticon_x_my_plugin');
  assert.deepEqual(read({ ...PAGE, emotes: [{ id: 'emote_other_x', sortId: 1, picId: 'pic_x', label: 'x' }] }, 'my-plugin')[1], ['PLUGIN_RECORD_ID']);
  assert.deepEqual(read({ ...PAGE, emotes: [{ id: 'emote_my_plugin_x', sortId: 1, picId: 'pic_x', label: 'x' }] }, 'my-plugin')[1], []);
});

test('the wheel is the core pages first, then the plugin pages; pageOf finds the page an id belongs to', () => {
  const [page] = read(PAGE);
  const pages = wheelPages(EMOTE_THEMES, [page]);
  assert.equal(pages.length, EMOTE_THEMES.length + 1, 'the pager counts core pages plus plugin pages');
  assert.deepEqual(pages.map((p) => p.themeId), [...EMOTE_THEMES.map((t) => t.themeId), 'emoticon_x_ciallo']);
  // a room without plugins gets the core pages and nothing else
  assert.equal(wheelPages(EMOTE_THEMES, undefined).length, EMOTE_THEMES.length);
  assert.equal(pageOf(pages, 'emote_ciallo_murasame'), page);
  // an official emote still resolves to its core page — a plugin page can never take it
  assert.equal(pageOf(pages, 'autochess_battle_dying'), EMOTE_THEMES.find((t) => t.emotes.some((e) => e.id === 'autochess_battle_dying')));
  assert.equal(pageOf(pages, '__proto__'), null);
  assert.equal(pageOf(pages, null), null);
  assert.equal(pageOf(null, 'emote_ciallo_murasame'), null);
});

test('manifest: cosmetic and content may carry a page, it needs no permission, and API 2 is required', async () => {
  const { readPluginManifest } = await import('../../shared/plugins/manifest.js');
  const ctx = (id) => ({ id, app: '0.3.0' });
  const base = { manifest: 2, version: '1.0.0', app: '*', api: 2, scope: ['room', 'personal'], emotes: 'emotes.json' };
  // needs: [] (like i18n): a page is data, so no permission is asked for
  const ok = readPluginManifest({ ...base, class: 'cosmetic' }, ctx('demo'));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manifest.parts.emotes.files, ['emotes.json']);
  assert.deepEqual(readPluginManifest({ ...base, class: 'content', scope: ['room'], permissions: ['data.add'] }, ctx('demo')).problems, []);
  assert.ok(readPluginManifest({ ...base, class: 'ui' }, ctx('demo')).problems.some((p) => /emotes/.test(p)), 'a ui plugin carries no page');
  assert.ok(readPluginManifest({ ...base, class: 'cosmetic', api: 1 }, ctx('demo')).problems.some((p) => /requires plugin API 2/.test(p)), 'the part is API 2');
  assert.ok(readPluginManifest({ ...base, class: 'cosmetic', emotes: ['page.json'] }, ctx('demo')).problems.some((p) => /emotes\.json/.test(p)), 'always named emotes.json');
  assert.ok(readPluginManifest({ ...base, class: 'cosmetic', emotes: ['emotes.json', 'more.json'] }, ctx('demo')).problems.some((p) => /more than 1 file/.test(p)), 'one page per plugin');
  assert.ok(!Object.keys(await import('../../shared/plugins/manifest.js')).includes('PARTS'), 'PARTS is not exported: the shape is locked to the source above');
});

test('the page file joins the file table of the visual set and is served, though it is not art', () => {
  // the plugin id comes from the folder name, so the temp folder is named like one
  const dir = path.join(tmpdir('folder'), 'ciallo');
  fs.mkdirSync(dir, { recursive: true });
  try {
    put(dir, 'plugin.json', { manifest: 2, id: 'ciallo', version: '1.0.0', app: '*', api: 2, class: 'cosmetic', emotes: 'emotes.json' });
    put(dir, 'emotes.json', PAGE);
    const r = readPluginFolder(dir, { app: '0.3.0' });
    assert.deepEqual(r.problems, []);
    const files = r.plugin.visual.composition.files;
    assert.deepEqual(Object.keys(files).sort(), ['emotes.json', 'plugin.json'], 'the file table the client reads');
    assert.equal(files['emotes.json'], sha256Hex(JSON.stringify(PAGE, null, 2)), 'the hash the URL is pinned to');
    assert.ok(r.plugin.visual.served.has('emotes.json'), 'and it is served at /p/');
    assert.equal(pluginFileUrl('ciallo', files['emotes.json'].slice(0, FILE_URL_DIGITS), EMOTE_PAGE_FILE),
      `${PLUGIN_FILES_URL}ciallo/${files['emotes.json'].slice(0, FILE_URL_DIGITS)}/emotes.json`);

    // a page that fails the check is not in the table at all
    put(dir, 'emotes.json', { ...PAGE, emotes: [{ id: 'emote_other_x', sortId: 1, picId: 'pic_x', label: 'x' }] });
    const bad = readPluginFolder(dir, { app: '0.3.0' });
    assert.equal(bad.plugin, null);
    assert.ok(bad.issues.some((i) => i.code === 'PLUGIN_RECORD_ID'), JSON.stringify(bad.issues.map((i) => i.code)));

    // a declared page that is not there
    put(dir, 'emotes.json', PAGE);
    const missing = readPluginFolder(dir, { app: '0.3.0', vanilla: { manifest: null, sha256: null } });
    assert.ok(missing.plugin, 'the folder is read again');
    fs.rmSync(path.join(dir, 'emotes.json'));
    const gone = readPluginFolder(dir, { app: '0.3.0' });
    assert.equal(gone.plugin, null);
    assert.ok(gone.problems.join(' ').includes('emotes.json is missing'), gone.problems.join(' '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the schema names the part (one file, a .json path) and the template is valid as it is', () => {
  const v = schemaValidator(path.join(ROOT, 'schemas'));
  const schema = readJson('schemas/plugin.schema.json');
  assert.ok(schema.properties.emotes, 'the field is in the schema');
  const M = (extra) => ({ manifest: 2, version: '1.0.0', app: '*', api: 2, class: 'cosmetic', emotes: 'emotes.json', ...extra });
  assert.deepEqual(v.validate('plugin.schema.json', M()), []);
  assert.ok(v.validate('plugin.schema.json', M({ emotes: ['emotes.json', 'more.json'] })).length, 'maxItems 1');
  assert.deepEqual(v.validate('plugin.schema.json', M({ api: 1 })), [], 'the schema allows API 1, the check is what gates the part');
  assert.ok(v.validate('plugin.schema.json', M({ class: 'lang', lang: 'qaa', files: { ui: 'ui.json' } })).length, 'a lang plugin carries no page');
  // the name is the checks' rule, not the schema's: a page called page.json passes the schema and fails the check
  assert.deepEqual(v.validate('plugin.schema.json', M({ emotes: 'page.json' })), []);
  assert.ok(readPluginManifest(M({ emotes: 'page.json' }), { id: 'demo', app: '0.3.0' }).problems.length);

  const tpl = 'plugins/_template/emotes';
  const m = readJson(`${tpl}/plugin.json`);
  assert.deepEqual(v.validate('plugin.schema.json', m), [], 'the emotes template');
  const [page, problems] = read(readJson(`${tpl}/emotes.json`), m.id);
  assert.deepEqual(problems, []);
  assert.equal(page.emotes.length, EMOTE_PAGE_MAX_EMOTES, 'a new page starts with the 6 cells of a wheel page');
  for (const e of page.emotes) assert.ok(isPluginEmoteId(e.id) && e.id.startsWith(`emote_${m.id.replace(/-/g, '_')}_`), e.id);
});

test('the protocol accepts the official 36 plus the namespaced shape (g.emote { id })', () => {
  for (const id of EMOTES) assert.equal(validateC2S({ t: 'g.emote', id }), null, id);
  assert.equal(validateC2S({ t: 'g.emote', id: 'emote_ciallo_murasame' }), null);
  for (const id of ['happy', 'autochess_room_hello', 'emote_ciallo', 'emote_x', 'multiv3_battle_thanks', '__proto__', '', 7, null]) {
    assert.notEqual(validateC2S({ t: 'g.emote', id }), null, String(id));
  }
});

test('the docs say what the code says: the surface row, the parts table and §10c', () => {
  const api = fs.readFileSync(path.join(ROOT, 'docs/PLUGIN-API.md'), 'utf8');
  assert.match(api, /^\| `manifest\.field\.emotes` \| stable \| 0\.3\.1 \| `shared\/plugins\/manifest\.js#MANIFEST_FIELDS` \|$/m);
  const doc = fs.readFileSync(path.join(ROOT, 'docs/PLUGINS.md'), 'utf8');
  assert.match(doc, /^## 10c\. Emote pages/m);
  assert.match(doc, /^\| parts \|.*`emotes` \(cosmetic, content\) one file always named `emotes\.json` \(§10c\) \|$/m);
  assert.match(doc, /`offers` §10b and `emotes` §10c/, 'the api row names the level-2 parts');
  const guide = fs.readFileSync(path.join(ROOT, 'docs/PLUGIN-GUIDE.md'), 'utf8');
  assert.match(guide, /^### emotes — 表情包页$/m);
  assert.match(guide, /没有图片时气泡显示页标题/, 'the fallback the maintainer decided');
});
