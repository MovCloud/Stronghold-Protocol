// test/ui/orientation.test.js — 设置 →「显示方向」 (orientation, owner request 2026-11-07): the profile value
// (gameLogic/settings.js), the module that turns the page (`<html data-rotate>`, ui/orientation.js), the CSS that turns
// .app-root and the wiring the settings dialog / language packs / pointer math need. The interface is always laid out
// landscape; 自动适应 turns a window taller than wide, 锁定竖屏 never turns (the default), 锁定横屏 always turns.
// Run: node --test test/ui/orientation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, ORIENTATIONS, sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { rotatedOrientation, setOrientationPreference, syncOrientation, installOrientation } from '../../public/js/ui/orientation.js';
import { layoutBox, layoutViewport } from '../../public/js/ui/turnedLayout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const MODES = ['auto', 'portrait', 'landscape'];
const LABELS = ['自动适应', '锁定竖屏', '锁定横屏'];
const HINT = '界面始终按横屏布局设计：自动适应在窗口高于宽时把整个画面旋转 90°，锁定竖屏始终保持正向，锁定横屏始终保持旋转 90°。棋盘的画面始终按自己的比例适配。';

/** Run `fn` with a fake <html> element (dataset is what css/orientation.css reads). */
function withDom(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = globalThis.document;
  const el = { dataset: {} };
  globalThis.document = { documentElement: el };
  try {
    return fn(el);
  } finally {
    if (had) globalThis.document = prev; else delete globalThis.document;
  }
}

/** Run `fn` with a fake viewport (ui/orientation.js reads innerWidth / innerHeight). */
function withViewport(w, h, fn) {
  for (const [k, v] of [['innerWidth', w], ['innerHeight', h]]) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    delete globalThis.innerWidth;
    delete globalThis.innerHeight;
  }
}

test('[ORIENTATION] 锁定竖屏 is the default; only the three steps are kept', () => {
  assert.equal(DEFAULT_SETTINGS.orientation, 'portrait', 'the owner default is 锁定竖屏');
  assert.deepEqual(ORIENTATIONS, MODES);
  assert.equal(sanitizeSettings(null).orientation, 'portrait');
  assert.equal(sanitizeSettings({ bgm: 0.4 }).orientation, 'portrait', 'a profile saved before the setting existed');
  for (const id of MODES) assert.equal(sanitizeSettings({ orientation: id }).orientation, id);
  for (const bad of ['portrait ', 'landscape2', 'vertical', '', 1, null, {}, true]) {
    assert.equal(sanitizeSettings({ orientation: bad }).orientation, 'portrait', String(bad));
  }
  assert.equal(sanitizeSettings(sanitizeSettings({ orientation: 'landscape' })).orientation, 'landscape', 'round trip');
});

test('[ORIENTATION] 锁定竖屏 never turns, 锁定横屏 always turns, 自动适应 turns a window taller than wide', () => {
  withDom((el) => {
    withViewport(1920, 1080, () => {
      assert.equal(rotatedOrientation('portrait'), false, 'locked portrait ignores the wide window');
      assert.equal(rotatedOrientation('landscape'), true, 'locked landscape turns even a wide window');
      assert.equal(rotatedOrientation('auto'), false, 'auto leaves a wide window upright');

      assert.equal(setOrientationPreference('portrait'), false);
      assert.equal(el.dataset.rotate, '0');
      assert.equal(el.dataset.orient, 'portrait');
      assert.equal(setOrientationPreference('landscape'), true);
      assert.equal(el.dataset.rotate, '1');
      assert.equal(el.dataset.orient, 'landscape');
      assert.equal(setOrientationPreference('auto'), false);
      assert.equal(el.dataset.rotate, '0', 'a wide window stays upright under auto');
    });
    withViewport(390, 844, () => {
      assert.equal(rotatedOrientation('auto'), true, 'a phone held upright turns under auto');
      assert.equal(syncOrientation(), true);
      assert.equal(el.dataset.rotate, '1');
      assert.equal(el.dataset.orient, 'auto');
      assert.equal(rotatedOrientation('portrait'), false, '锁定竖屏 stays upright on that phone');
    });
    withViewport(844, 390, () => {
      assert.equal(rotatedOrientation('auto'), false, 'a landscape window stays upright under auto');
    });
    withViewport(600, 600, () => {
      assert.equal(rotatedOrientation('auto'), false, 'a square window does not turn');
    });
    // junk falls back to the locked portrait default, like sanitizeSettings
    assert.equal(setOrientationPreference('sideways'), false);
    assert.equal(el.dataset.orient, 'portrait');
    assert.equal(el.dataset.rotate, '0');
  });
});

test('[ORIENTATION] installOrientation keeps auto up to date; a locked step keeps its answer', () => {
  withDom((el) => {
    const handlers = {};
    const win = { addEventListener: (name, fn) => { handlers[name] = fn; } };
    setOrientationPreference('auto');
    withViewport(1280, 720, () => {
      assert.equal(installOrientation(win), undefined);
      assert.ok(handlers.resize && handlers.orientationchange, 'both window events are watched');
      assert.equal(el.dataset.rotate, '0');
    });
    withViewport(720, 1280, () => {
      handlers.orientationchange();
      assert.equal(el.dataset.rotate, '1', 'a tall window turns under auto');
    });
    setOrientationPreference('landscape');
    withViewport(1280, 720, () => {
      handlers.resize();
      assert.equal(el.dataset.rotate, '1', '锁定横屏 keeps turning whatever the window does');
    });
    setOrientationPreference('portrait');
    withViewport(720, 1280, () => {
      handlers.resize();
      assert.equal(el.dataset.rotate, '0', '锁定竖屏 keeps the page upright');
    });
  });
});

test('[ORIENTATION] the turned layout space swaps the canvas / app axes', () => {
  // the turned .app-root's screen box; its layout x runs down the screen and its layout y right-to-left
  const app = { top: 6, right: 390, width: 390, height: 844 };
  const box = { left: 10, top: 26, right: 110, bottom: 226, width: 100, height: 200 };
  const out = layoutBox(box, app);
  assert.deepEqual(out, { left: 20, top: 280, right: 220, bottom: 380, width: 200, height: 100 });
  assert.deepEqual(layoutViewport(app), { width: 844, height: 390 });
  // upright: the box passes through untouched
  const plain = { left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200 };
  assert.deepEqual(layoutBox(plain, null), plain);
});

test('[ORIENTATION] the dialog offers the step, the CSS turns the page, and every pack has the strings', () => {
  const settings = read('public/js/ui/settings.js');
  assert.match(settings, /data-testid="orientation"/);
  assert.ok(settings.includes(`t('显示方向')`), 'the row label');
  assert.ok(settings.includes(`t('${HINT}')`), 'the hint under it');
  assert.match(settings, /const ORIENTATION_STEPS = \[\['auto', N_\('自动适应'\)\], \['portrait', N_\('锁定竖屏'\)\], \['landscape', N_\('锁定横屏'\)\]\];/);
  assert.match(settings, /installOrientation\(\);\nsetOrientationPreference\(settingsStore\.get\(\)\.orientation\);/);

  const css = read('public/css/orientation.css');
  // the turn: .app-root is rotated and fills the swapped box; the root scale is re-derived from that box
  assert.match(css, /html\[data-rotate="1"\] \.app-root \{/, 'the .app-root turn');
  assert.match(css, /width: 100vh;\n  height: 100vw;/);
  assert.match(css, /transform: translateX\(100vw\) rotate\(90deg\);/);
  assert.match(css, /html\[data-rotate="1"\] \{\n  font-size: calc\(clamp\(40px, min\(calc\(100vh \/ 19\.2\), calc\(100vw \/ 10\.8\)\), 240px\) \* var\(--sp-ui, 1\)\);/, 'swapped root scale');
  assert.match(css, /html\[data-fit\]\[data-rotate="1"\] \.app-root \{/, '异形屏 bands swap with the turn');
  assert.match(css, /html\[data-rotate="1"\]\[data-fit\] \{/, 'and so does its scale');
  assert.match(css, /html\[data-rotate="1"\] \.arcade \{ min-height: 100vw; \}/, '100dvh pages follow the turned height');
  // the physical media queries stay portrait → the landscape branch must be restored
  assert.match(css, /html\[data-rotate="1"\] \.proto-body/);
  assert.match(css, /@media \(min-height: 521px\)/, 'short-landscape windows keep owning themselves');
  assert.match(css, /@media \(max-aspect-ratio: 1\/1\) \{\n    html\[data-rotate="1"\] \.pcard__name \{ font-size: min\(calc\(\.28 \* var\(--t\)\), \.36rem\); \}/);
  assert.match(css, /html\[data-rotate="1"\] \.proto-foot \.proto-start__label \{ font-size: min\(calc\(\.4 \* var\(--t\)\), \.46rem\); \}/);
  assert.match(css, /html\[data-rotate="1"\] \.proto-foot \.proto-start__rook \{ font-size: min\(calc\(\.36 \* var\(--t\)\), \.4rem\); \}/);
  assert.ok(!css.includes('[data-orient'), 'no layout branch keyed on the setting any more');
  assert.match(css, /@media \(max-width: 640px\) \{\n  html\[data-rotate="1"\] \.arcade \{/, 'a turned phone keeps the arcade cards in a row');

  const index = read('public/index.html');
  assert.ok(index.indexOf('/css/orientation.css') > index.indexOf('/css/utility-mobile.css'), 'loaded after the screens');
  assert.ok(index.indexOf('/css/orientation.css') < index.indexOf('/css/devices.css'), 'devices.css stays last');

  const theme = read('public/css/theme.css');
  assert.ok(!theme.includes('sp-orient-landscape'), 'the old rotation hint rule is gone');
  assert.ok(!theme.includes('rotate-hint { display: grid'), 'the page turns itself instead of asking the player to');

  const device = read('public/js/ui/device.js');
  assert.ok(!device.includes('orientationPreference'), 'no OS orientation lock next to the CSS turn');
  assert.ok(!device.includes('screen?.orientation?.lock'), 'that lock would turn the page twice');
  assert.match(device, /const turned = root\.dataset\?\.rotate === '1';/, '--sp-vh follows the turned height');

  const app = read('public/js/render/app.js');
  assert.match(app, /if \(turned\(\)\) return \{ x: e\.clientY - r\.top, y: r\.right - e\.clientX \};/, 'pointer coordinates undo the turn');
  assert.match(app, /if \(turned\(\)\) \{\n        const left = r\.right - b\.y - b\.height/, 'pieceScreenRect swaps its axes');
  assert.ok(app.includes('const centre = clientOf(c.x, c.y, r);'), 'tileScreen maps through the turn');
  const host = read('public/js/ui/fieldHost.js');
  assert.ok(host.includes('layoutBox(document.querySelector(\'.gm__hud\')') && host.includes("from './turnedLayout.js'"), 'HUD bands use the turned box');
  const tips = read('public/js/ui/components.js');
  assert.ok(tips.includes("from './turnedLayout.js'"), 'tooltips are placed in the layout space');
  assert.ok(read('public/js/ui/termTip.js').includes("from './turnedLayout.js'"), 'term tips too');

  // the arcade page's labels had no pixel floor: at 1rem = 40 px the back key was 6.9 px (owner report 2026-11-07)
  const arcade = read('public/css/screens/arcade.css');
  // the back key is the hub's plate (ui/components.js BackPlate), styled once in lobby.css so the screens cannot drift
  assert.match(arcade, /\.arcade__back \{ cursor: pointer; \}/);
  assert.match(read('public/css/screens/lobby.css'), /\.proto-back > \.icon \{ width: max\(\.4rem, 22px\); height: max\(\.4rem, 22px\)/, 'the plate keeps its pixel floor there');
  assert.match(arcade, /\.sp-coarse \.arcade__back \{ min-height: max\(32px, calc\(40px \* var\(--sp-ui, 1\)\)\); \}/);
  assert.match(arcade, /\.arcade__title \{ margin: 0; font-size: max\(calc\(\.42 \* var\(--t\)\), 20px\);/);
  assert.match(arcade, /font-size: max\(calc\(\.16 \* var\(--t\)\), 12px\);/);
  assert.match(arcade, /font-size: max\(calc\(\.26 \* var\(--t\)\), 15px\);/);
  assert.match(arcade, /font-size: max\(calc\(\.13 \* var\(--t\)\), 11px\);/);

  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of ['显示方向', ...LABELS, HINT]) {
      assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
    }
  }
});

test('[ORIENTATION] the top bar pills share one size, and the 皮肤工坊 boxes share one height', () => {
  const lobby = read('public/css/screens/lobby.css');
  assert.match(lobby, /--hub-pill-h: max\(\.42rem, 28px\)/);
  assert.match(lobby, /\.lobby-hub \.topbar__right \.verchip,[\s\S]*?\.lobby-hub \.topbar__right \.hub-online \{[\s\S]*?height: var\(--hub-pill-h\); min-height: var\(--hub-pill-h\);[\s\S]*?font-size: calc\(\.14 \* var\(--t\)\);/);
  assert.match(lobby, /\.sp-coarse \.lobby-hub \.topbar__right \.verchip,[\s\S]*?height: max\(32px, calc\(40px \* var\(--sp-ui, 1\)\)\); min-height: max\(32px, calc\(40px \* var\(--sp-ui, 1\)\)\);/);

  const game = read('public/css/screens/game.css');
  assert.match(game, /\.set-workshop \.field__box \{ height: \.36rem;/);
  assert.match(game, /\.set-workshop select \{ width: 100%; \}/);
  assert.match(game, /\.set-workshop__field \{[\s\S]*?flex: 1 1 1\.4rem;/);
});
