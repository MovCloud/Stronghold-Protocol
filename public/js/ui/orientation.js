// ui/orientation.js — 设置 →「显示方向」 (orientation). Every screen is one landscape stage (theme.css derives the root
// scale from a 19.2 × 10.8 box). 显示方向 decides whether the whole app is turned 90° so the stage's long side lies
// along the screen's long side:
//   · 自动适应 (auto): turn while the viewport is taller than wide (a phone held upright — mobile gameplay in landscape);
//   · 锁定竖屏 (portrait): never turn (the default: a desktop window that is already wider than tall);
//   · 锁定横屏 (landscape): always turn.
// 'auto' re-reads the viewport on resize / orientationchange; a locked value keeps its answer whatever the window does.
//
// The turned states sit on <html data-rotate="1">: css/orientation.css turns .app-root, re-derives the root scale from
// the swapped box and restores the landscape layout branch a narrow physical window would otherwise drop. The chosen
// value stays on <html data-orient> for the settings dialog and the tests. render/app.js maps canvas pointer
// coordinates through the turn (canvasPoint / pieceScreenRect / tileScreen), and ui/device.js keeps --sp-vh at the
// turned box's visible height.
//
// Values: ui/gameLogic/settings.js ORIENTATIONS ('auto' | 'portrait' | 'landscape'); DEFAULT_SETTINGS.orientation is
// 锁定竖屏.
import { ORIENTATIONS } from './gameLogic/settings.js';
import { updateManagementViewport } from './managementScale.js';

/** Locked when a browser profile has no value yet (the same default as DEFAULT_SETTINGS.orientation). */
let preference = 'portrait';
let watched = null;

/** Whether the viewport is taller than wide (a square window does not turn). @returns {boolean} */
function viewportIsTall() {
  const w = Number(globalThis.innerWidth);
  const h = Number(globalThis.innerHeight);
  if (!(Number.isFinite(w) && Number.isFinite(h)) || w <= 0 || h <= 0) return false;
  return h > w;
}

/** The stored value (a value outside ORIENTATIONS already fell back when it was sanitised). @returns {'auto'|'portrait'|'landscape'} */
export function orientationPreference() {
  return preference;
}

/**
 * Whether the whole stage is turned 90° right now: 锁定横屏 always, 锁定竖屏 never, 自动适应 while the viewport is taller
 * than wide.
 * @param {'auto'|'portrait'|'landscape'} [pref]
 * @returns {boolean}
 */
export function rotatedOrientation(pref = preference) {
  if (pref === 'landscape') return true;
  if (pref === 'portrait') return false;
  return viewportIsTall();
}

/**
 * Write the turn onto <html>: `data-rotate` ('1' | '0'), the chosen value in `data-orient`, and --sp-vh at the turned
 * box's visible height. Also called on every resize / orientationchange while 'auto' is selected. Also called when a
 * locked value is re-applied, so a window change that keeps it locked costs nothing but still refreshes the height.
 * @returns {boolean|null} whether the stage is turned, null without a DOM
 */
export function syncOrientation() {
  const el = globalThis.document?.documentElement;
  if (!el) return null;
  const rotate = rotatedOrientation(preference);
  const was = el.dataset.rotate;
  el.dataset.rotate = rotate ? '1' : '0';
  el.dataset.orient = preference;
  // --sp-vh is the turned box's visible height: the physical width while turned (ui/device.js keeps it on resize).
  const win = globalThis;
  const vv = win.visualViewport;
  const h = rotate ? (vv?.width || win.innerWidth || 0) : (vv?.height || win.innerHeight || 0);
  try {
    if (h > 0 && typeof el.style?.setProperty === 'function') el.style.setProperty('--sp-vh', `${h / 100}px`);
  } catch { /* an element without a style (tests) */ }
  // the management screens' --sp-ui-unit reads the same swapped box (ui/managementScale.js); only a change needs it
  if (was !== el.dataset.rotate) {
    try { updateManagementViewport(win); } catch { /* no getComputedStyle (tests) */ }
  }
  return rotate;
}

/**
 * 设置 →「显示方向」: store the step (junk falls back to the locked portrait default) and apply it at once.
 * @param {'auto'|'portrait'|'landscape'} v
 */
export function setOrientationPreference(v) {
  preference = ORIENTATIONS.includes(v) ? v : 'portrait';
  return syncOrientation();
}

/**
 * Watch the window so 'auto' keeps up with resizes and device rotation. A locked value re-applies the same answer (the
 * refresh is harmless and keeps --sp-vh right). settings.js calls this once at boot, before the first render.
 * @param {{addEventListener?: Function}} [win]
 */
export function installOrientation(win = globalThis) {
  const add = win?.addEventListener;
  if (typeof add !== 'function' || watched === win) return;
  watched = win;
  syncOrientation();
  const onResize = () => syncOrientation();
  add.call(win, 'resize', onResize);
  add.call(win, 'orientationchange', onResize);
}
