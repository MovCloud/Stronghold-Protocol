// test/ui/avatar-sources.test.js — the avatar source registry (shared/avatarSources.js, 2026-11-08): what a 头像 can be.
// The id form (`<kind>:<key>`, a bare charId stays the operator form so every existing save keeps working), the picture
// from the art manifest, the name (the game data's own, or the table's msgid — the caller translates it), what the
// server accepts, and the picker's entries: an entry whose file is not in the manifest is not offered at all, never as
// a "not installed" tile. `pack` is the reserved form for a later avatar pack. The picker's category tabs, its green
// 确认 button and the 个人名片 row that now shows the name are asserted from the source at the end. (The server side:
// test/lobby-card.test.js; the browser: test/ui/avatar-sources.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AVATAR_KINDS, CAMPS, LOADING, avatarKindName, parseAvatarId, avatarPath, avatarName, isAvatarId, avatarEntries,
} from '../../shared/avatarSources.js';
import { cardAvatarUrl } from '../../public/js/ui/seatArt.js';
import { isCardAvatarId, isCardPortraitId, cleanPlayerCard } from '../../shared/playerCard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const M = read('assets.json');
const D = { bonds: read('bonds.json'), bands: read('bands.json'), enemies: read('enemies.json') };

test('the id form: a bare charId is the operator form, <kind>:<key> a source form, anything else null', () => {
  assert.deepEqual(parseAvatarId('char_498_inside'), { kind: 'operator', key: 'char_498_inside' });
  for (const kind of AVATAR_KINDS.slice(1)) assert.deepEqual(parseAvatarId(`${kind}:x`), { kind, key: 'x' });
  assert.deepEqual(parseAvatarId('bond:yanShip'), { kind: 'bond', key: 'yanShip' }, "the game data's keys keep their capitals");
  assert.deepEqual(parseAvatarId('pack:ark/rockr'), { kind: 'pack', key: 'ark/rockr' }, 'one segment separator per key');
  assert.deepEqual(parseAvatarId('bond'), { kind: 'operator', key: 'bond' }, 'a bare id is the operator form, even when it reads like a kind');
  for (const bad of ['', null, 7, 'bond:', 'bond:x:y', 'bond:../assets', 'bond:x;y', 'bond:x y', 'nope:x', 'bond:' + 'x'.repeat(70), 'x'.repeat(161)]) {
    assert.equal(parseAvatarId(bad), null, String(bad));
  }
});

test('the picture: the manifest path per kind; a key the tables do not have, or a file not on disk, is null', () => {
  assert.equal(avatarPath('bond:yanShip', M), '/assets/bond/yanShip.png');
  assert.equal(avatarPath('band:band_bldsk', M), '/assets/band/band_bldsk.png');
  assert.equal(avatarPath('enemy:enemy_1000_gopro_2', M), '/assets/enemy/icon/enemy_1000_gopro_2.png');
  assert.equal(avatarPath('camp:rhodes', M), '/assets/ui/campLogo/logo_rhodes.png');
  assert.equal(avatarPath('loading:core', M), '/assets/ui/loading/loading_ac_core.png');
  assert.equal(avatarPath('pack:ark/rockr', M), null, 'nothing is registered in the pack form yet');
  assert.equal(avatarPath('camp:notafaction', M), null);
  assert.equal(avatarPath('bond:nope', M), null);
  assert.equal(avatarPath('char_498_inside', M), null, "an operator's avatar is cardAvatarUrl, not the registry");
  const thin = { ...M, bonds: { ...M.bonds }, enemies: { ...M.enemies } };
  delete thin.bonds.yanShip;
  delete thin.enemies['enemy_1000_gopro_2'];
  assert.equal(avatarPath('bond:yanShip', thin), null, 'the manifest has no file for that key');
  assert.equal(avatarPath('enemy:enemy_1000_gopro_2', thin), null);
  assert.equal(avatarPath('bond:yanShip', null), null, 'before the data loads');
});

test('the name: the game data\'s own for a data source, the table\'s msgid for the static ones, the fallback for an operator', () => {
  assert.equal(avatarName('bond:yanShip', D), '炎');
  assert.equal(avatarName('band:band_bldsk', D), '华法琳');
  assert.equal(avatarName('enemy:enemy_1000_gopro_2', D), '猎狗pro');
  assert.equal(avatarName('camp:rhodes', D), '罗德岛');
  assert.equal(avatarName('loading:core', D), '模拟·核心');
  assert.equal(avatarName('char_498_inside', D, '隐现'), '隐现', 'the caller passes the operator\'s name');
  for (const bad of ['bond:nope', '', 'pack:ark/rockr', null]) assert.equal(avatarName(bad, D, 'X'), 'X');
  // the static tables hold msgids (N_), so the caller translates them
  assert.equal(avatarKindName('bond'), '盟约标识');
  assert.equal(avatarKindName('camp'), '阵营徽记');
  assert.equal(avatarKindName('pack'), '头像包');
  assert.equal(avatarKindName('nope'), 'nope');
});

test('what the server accepts: the operator whitelist, a well-formed <kind>:<key> of a registered kind; never a URL', () => {
  const known = new Set(['char_498_inside']);
  assert.ok(isAvatarId('char_498_inside', known));
  assert.ok(!isAvatarId('char_999_nobody', known), 'an operator the server does not know');
  for (const id of ['bond:yanShip', 'band:band_bldsk', 'enemy:enemy_1000_gopro_2', 'camp:rhodes', 'loading:core', 'pack:ark/rockr']) {
    assert.ok(isAvatarId(id, known), id);
  }
  assert.ok(isAvatarId('camp:notafaction', known), 'shape only: the client resolves the picture, so an unknown key is not refused here');
  for (const bad of ['bond', 'bond:../assets', 'loading:core;drop', 'https://example.com/a.png', 'nope:x', 7, null]) {
    assert.ok(!isAvatarId(bad, known), String(bad));
  }
  assert.ok(isAvatarId('bond:yanShip', null), 'no whitelist: the sources still pass on their shape');
  assert.ok(!isAvatarId('char_498_inside', null));
});

test('the picker\'s entries: every kind, only what the manifest has, no operator entries (the picker keeps its own operator list)', () => {
  const all = avatarEntries(D, M);
  assert.deepEqual([...new Set(all.map((e) => e.kind))], ['bond', 'band', 'enemy', 'camp', 'loading']);
  assert.equal(all.length, Object.keys(D.bonds).length + Object.keys(D.bands).length + Object.keys(D.enemies).length + CAMPS.length + LOADING.length);
  assert.ok(all.every((e) => e.kind && e.id === `${e.kind}:${parseAvatarId(e.id).key}` && e.name && e.src), 'every entry is a real, drawable tile');
  assert.ok(all.some((e) => e.kind === 'camp' && e.tint), 'the camps keep their tint for the tile');
  assert.ok(!all.some((e) => e.kind === 'operator'), 'the operators are not entries: cardOperators() still lists them');
  const thin = { ...M, bonds: {}, enemies: { ...M.enemies } };
  delete thin.enemies['enemy_1000_gopro_2'];
  const fewer = avatarEntries(D, thin);
  assert.equal(fewer.filter((e) => e.kind === 'bond').length, 0, 'no files: no entries at all, not a "not installed" tile');
  assert.ok(!fewer.some((e) => e.id === 'enemy:enemy_1000_gopro_2'), 'the one enemy without its icon is not offered');
  assert.deepEqual(avatarEntries(D, null), [], 'before the data loads');
  const onlyTables = avatarEntries(null, M);
  assert.deepEqual([...new Set(onlyTables.map((e) => e.kind))], ['camp', 'loading'], 'no game data: only the two tables');
  assert.equal(onlyTables.length, CAMPS.length + LOADING.length);
});

test('cardAvatarUrl: a source id resolves through the registry, an operator keeps its look/avatar path', () => {
  assert.equal(cardAvatarUrl('bond:yanShip', M), '/assets/bond/yanShip.png');
  assert.equal(cardAvatarUrl('camp:rhodes', M), '/assets/ui/campLogo/logo_rhodes.png');
  assert.equal(cardAvatarUrl('char_498_inside', M), '/assets/char/avatar/char_498_inside_2.png');
  assert.equal(cardAvatarUrl('char_498_inside', M, 'e1'), '/assets/char/avatar/char_498_inside.png');
  assert.equal(cardAvatarUrl('char_498_inside', null), null);
  assert.equal(cardAvatarUrl('https://example.com/a.png', M), null);
});

test('playerCard: an avatar can be a source id, a portrait cannot; cleanPlayerCard keeps both', () => {
  assert.ok(isCardAvatarId('bond:yanShip'));
  assert.ok(isCardAvatarId('char_498_inside'));
  assert.ok(isCardAvatarId('char_498_inside@series#1'), 'an operator-owned skin id stays allowed');
  assert.ok(isCardAvatarId(''));
  assert.ok(!isCardAvatarId('bond:../assets'));
  assert.ok(!isCardPortraitId('bond:yanShip'), 'the portrait field keeps its operator-only meaning');
  assert.ok(isCardPortraitId('char_498_inside@series#1'));
  assert.deepEqual(cleanPlayerCard({ charId: 'char_498_inside', avatar: 'camp:rhodes' }), { charId: 'char_498_inside', avatar: 'camp:rhodes' });
  assert.deepEqual(cleanPlayerCard({ avatar: 'bond:../assets' }), { charId: '', avatar: '' });
  assert.deepEqual(cleanPlayerCard({ avatar: 'char_999_nobody' }, () => false), { charId: '', avatar: '' });
  assert.deepEqual(cleanPlayerCard({ avatar: 'char_498_inside' }, () => true), { charId: '', avatar: 'char_498_inside' });
});

test('the picker: the category tabs, the green 确认 button, a tile per entry, the operator-only search and rarity', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/ui/opPicker.js'), 'utf8');
  assert.match(src, /actions=\$\{html`<\$\{Button\} variant="primary" onClick=\$\{onClose\} data-testid="avatar-confirm">\$\{t\('确认'\)}<\/\/>`\}/);
  assert.match(src, /data-testid="card-operator-confirm"/, '名片干员\'s footer button, the same green style');
  assert.match(src, /class="cardpick__cats" role="tablist" aria-label=\$\{t\('头像分类'\)\}/);
  assert.match(src, /\[\['operator', t\('干员'\)\], \.\.\.kinds\.map\(\(k\) => \[k, t\(avatarKindName\(k\)\)\]\)/);
  assert.match(src, /data-avatar=\$\{e\.id\}/, 'a tile per entry, its id on the tile');
  assert.match(src, /kind === 'operator' \? html`<div class="cardpick__stars"/, 'the rarity tabs only for operators');
  assert.match(src, /looks && kind === 'operator'/, 'the 外观 row only for operators');
  assert.match(src, /placeholder=\$\{kind === 'operator' \? t\('搜索干员'\) : t\('搜索'\)\}/);
  const css = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
  const cats = css.match(/\.cardpick__cats button\s*\{[^}]*\}/);
  assert.ok(cats, 'the category row has its own rule');
  assert.match(cats[0], /font-size: calc\(\.\d+ \* var\(--t\)\)/, 'follows 文字大小');
  assert.ok(!/\.cardpick__cats[^{]*\{[^}]*!important/.test(css), 'no !important');
});

test('the 个人名片 row shows the chosen avatar\'s name, and picking a tile applies at once', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
  assert.match(src, /row\(t\('头像'\), avatarLabel/);
  assert.match(src, /const avatarLabel = draft\.avatar\s*\n?\s*\? t\(avatarName\(/);
  assert.ok(!src.includes("t('已选择')"), 'no more 已选择');
  assert.match(src, /useData\('chess', 'assets', 'bonds', 'bands', 'enemies'\)/);
  // the tables can settle after 素材清单: they must be memo deps, else the picker keeps the empty group of the first render
  assert.match(src, /const avatarPick = useMemo\(\(\) => avatarEntries\(\{ bonds, bands, enemies \}, m\), \[m, bonds, bands, enemies\]\)/);
  assert.match(src, /entries=\$\{avatarPick\}/);
  assert.match(src, /onPick=\$\{\(id\) => pick\(\{ avatar: id, avatarLook: '' \}\)\}\n?\s*onClose/, 'a press applies and the picker stays open until 确认');
  assert.match(src, /<div class="prof__preview">/, 'the vertical preview shows the 立绘 alone: the 底图 only belongs to the card below it');
});

test('随机: a random 立绘, applied without closing the picker or scrolling its grid', () => {
  const seat = readFileSync(path.join(ROOT, 'public/js/ui/seatArt.js'), 'utf8');
  assert.match(seat, /for \(const o of lookOptions\(m, c\.charId, 'portrait'\)\) looks\.push/, 'every 立绘 is one entry of the pool, so each has the same chance');
  const lobby = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
  assert.match(lobby, /const picked = randomCardPick\(m, list\);\s*\n\s*pick\(\{ charId: picked\.charId, look: picked\.look \}\);\s*\n\s*return;/, 'the pick lands on the draft, the picker stays open for another roll');
  assert.match(lobby, /const seeded = useRef\(false\)/, 'a card with nothing picked yet rolls once');
  assert.match(lobby, /if \(seeded\.current \|\| card\.charId \|\| !list\.length\) return/, 'and only once: a card that already has one is never re-rolled');
  assert.match(lobby, /setCardOperator\(p\.charId\);\s*\n\s*setCardLook\(p\.look\);/, 'the first roll is written at once, so 随机 is a single choice rather than a mode');
  const picker = readFileSync(path.join(ROOT, 'public/js/ui/opPicker.js'), 'utf8');
  const components = readFileSync(path.join(ROOT, 'public/js/ui/components.js'), 'utf8');
  assert.ok(!/scrollIntoView/.test(picker), 'the picker never scrolls to the roll: it only highlights it');
  assert.ok(!/preventScroll/.test(components), 'the focus behaves as before, only at the moment the modal opens');
  assert.match(picker, /data-autofocus=\$\{known \? undefined : ''\}/, 'the 随机 tile is the focus target only when nothing is picked yet');
  assert.match(picker, /if \(!opts\.length\) return null/, 'the 外观 row is there even for an operator with a single look (UI consistency)');
  assert.ok(!/opts\.length < 2/.test(picker), 'no more "nothing when it has only one"');
});
