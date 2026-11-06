// [BOARDVIEW] 设置「棋盘样式」 (boardView: 3d / 2d, owner request 2026-10-25): the settings defaults and sanitising
// (ui/gameLogic/settings.js), the settings → board preference mapping (render/app/view.js boardPreference, an explicit
// setting beats a leftover URL ?board=), and the field view keeping the unit models with the board — both styles draw
// the skeletal models, and the mode must never reframe the view (owner correction 2026-10-25).
// 3d = 官方贴图 (the official three.js scene, the verified default), 2d = 3D (the procedural map, mobile).
// The removed 'auto' / 'board' (the unofficial PNG board art) migrate to '3d'. Pure / unit: no DOM, no GPU.
// Run: node --test test/ui/board-view.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, BOARD_VIEWS, sanitizeSettings } from '../../public/js/ui/gameLogic.js';
import { boardPreference } from '../../public/js/render/app/view.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LABEL = '棋盘样式';
const HINT = '官方贴图：使用官方三维场景与棋盘素材。3D：视角与官方贴图相同，棋盘改用程序化地块、不加载官方场景，适合移动设备。两档的干员、召唤物和敌人均使用骨骼模型，缺少资源时回退为头像菱形标记。切换立即生效。';

/** Run `fn` with `location.search` faked (the only URL input of boardPreference). */
function withSearch(search, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'location');
  const prev = globalThis.location;
  try {
    globalThis.location = { search };
    return fn();
  } finally {
    if (had) globalThis.location = prev; else delete globalThis.location;
  }
}

test('[BOARDVIEW] settings: 官方贴图 by default, 3D chosen; the removed choices migrate to 3d', () => {
  assert.equal(DEFAULT_SETTINGS.boardView, '3d', 'the verified official textures are the default');
  assert.deepEqual(BOARD_VIEWS, ['3d', '2d'], '只有官方贴图与 3D');
  assert.equal(sanitizeSettings(null).boardView, '3d');
  assert.equal(sanitizeSettings({ bgm: 0.4 }).boardView, '3d', 'a profile saved before the setting existed');
  assert.equal(sanitizeSettings({ boardView: '3d' }).boardView, '3d');
  assert.equal(sanitizeSettings({ boardView: '2d' }).boardView, '2d');
  for (const old of ['auto', 'board', '3D', '2D', 'flat', 'on', 1, null, {}, true]) {
    assert.equal(sanitizeSettings({ boardView: old }).boardView, '3d', String(old));
  }
  // the setting survives a round trip (updateSettings sanitises the merged profile again)
  assert.equal(sanitizeSettings(sanitizeSettings({ boardView: '2d' })).boardView, '2d');
});

test('[BOARDVIEW] boardPreference: an explicit setting wins, a URL ?board= only fills in when none is given', () => {
  withSearch('', () => {
    assert.equal(boardPreference(undefined), '3d', 'no setting at all reads as 官方贴图');
    assert.equal(boardPreference(DEFAULT_SETTINGS.boardView), '3d');
    assert.equal(boardPreference('3d'), '3d');
    assert.equal(boardPreference('2d'), '2d');
    assert.equal(boardPreference('board'), '3d', 'the removed choice never comes back');
    assert.equal(boardPreference('auto'), '3d', 'the removed choice never comes back');
    assert.equal(boardPreference('flat'), '3d', 'the old DOM-plane value has no engine equivalent');
  });
  withSearch('?board=2d', () => {
    assert.equal(boardPreference(undefined), '2d', 'the URL fills in for a dev caller with no setting');
    assert.equal(boardPreference('flat'), '2d', 'a caller passing no setting lets the URL pick');
  });
  withSearch('?board=3d', () => assert.equal(boardPreference(undefined), '3d', 'the URL fills in for a dev caller'));
  withSearch('?board=board', () => assert.equal(boardPreference(undefined), '3d', 'the removed URL value reads as 3d'));
  // owner report 2026-10-25: a leftover `?board=3d` bookmark kept the 3D board after 2D was picked in 设置
  withSearch('?board=2d', () => assert.equal(boardPreference('3d'), '3d', 'an explicit 3D setting beats the URL'));
  withSearch('?board=3d', () => assert.equal(boardPreference('2d'), '2d', 'an explicit 2D setting beats the URL'));
});

test('[BOARDVIEW] 3D keeps the official camera: the view option cannot change it', () => {
  const view = { width: 1920, height: 1080 };
  const rect = { r0: 6, r1: 12, c0: 1, c1: 10 };
  const cam = presetCamera('normal', view, { rect });
  assert.ok(cam.tilt > 0, 'the official tilt');
  // the removed flat option no longer has any effect on the camera
  const same = presetCamera('normal', view, { rect, flat: true });
  assert.equal(same.tilt, cam.tilt);
  assert.equal(same.scale, cam.scale);
  assert.equal(same.cx, cam.cx);
  assert.equal(same.cy, cam.cy);
});

test('[BOARDVIEW] the field view keeps the skeletal models on both board styles', () => {
  const app = read('public/js/render/app.js');
  assert.match(app, /let boardPref = boardPreference\(opts\.board != null \? opts\.board : settings\.boardView\);/);
  // [UNITMODELS] the setting decides whether models load at all; the board style never forces them off (owner decision
  // 2026-10-25) — a unit whose model is missing falls back to its avatar diamond inside render/units.js
  assert.match(app, /if \(settings\.unitModels == null\) settings\.unitModels = unitSetting\(settings\);/);
  assert.ok(!app.includes('syncUnitModels'), 'no board-driven model switch');
  assert.ok(!/unitModels = boardPref/.test(app), 'the board style never forces the models off');
  // 官方贴图 turns the three.js scene on; 3D stays on the Pixi board — with the same camera (no reframing)
  assert.match(app, /const want3d = boardPref === '3d' && webgl2Available\(true\);/);
  assert.match(app, /if \(\(s\.boardView === '3d' \|\| s\.boardView === '2d'\) && s\.boardView !== settings\.boardView\)/);
  assert.match(app, /void setBoardLayer\(next\);\n\s*applyBoardMode\(\);\n\s*\}/);
  assert.match(app, /function applyBoardMode\(\) \{\n[\s\S]*?tiles\.setArt\(null\);/);
  assert.ok(!/flat:\s*boardPref/.test(app), 'the board mode never reframes the camera');
  assert.ok(!app.includes('setCamera(camKind, { ...camOpts, instant: true })'), 'no camera reset on a board switch');
  // the removed unofficial board art is never loaded
  assert.ok(!app.includes('loadBoardArt'), 'no PNG board art load');
});

test('[BOARDVIEW] the settings dialog offers 棋盘样式 in every language pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.ok(src.includes(`t('${LABEL}')`), 'the row label');
  assert.ok(src.includes(`t('${HINT}')`), 'the hint under it');
  assert.match(src, /BOARD_VIEWS\.map\(\(id\) => html`<button/);
  for (const id of ['官方贴图', '3D']) assert.ok(src.includes(`N_('${id}')`), `the option ${id}`);
  assert.ok(!src.includes("N_('3D 棋盘')") && !src.includes("N_('自动')"), 'the removed choices are gone');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of [LABEL, HINT, '官方贴图', '3D']) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
  }
});
