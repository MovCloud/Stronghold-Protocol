// ui/turnedLayout.js — the turned page's layout space (设置 →「显示方向」, ui/orientation.js + css/orientation.css).
// While <html data-rotate="1"> is on, .app-root is turned 90°: its layout x runs down the screen and its layout y runs
// right-to-left, so a screen point (x, y) is the app's layout point (y - appTop, appRight - x). Everything that is
// `position: fixed` inside the app (tooltips, panels, the frame overlays) is placed in that layout px, so a box measured
// with getBoundingClientRect must be mapped back before it is compared with them — the battle canvas' own pointer math
// lives in render/app.js (canvasPoint / pieceScreenRect / tileScreen) and ui/fieldHost.js's HUD bands use this.

/** Whether the page is turned. @returns {boolean} */
export function isTurned() {
  return globalThis.document?.documentElement?.dataset.rotate === '1';
}

/** The turned .app-root's screen box (the layout origin), or null while the page is upright. */
export function turnedBox() {
  if (!isTurned()) return null;
  const doc = globalThis.document;
  const app = doc?.querySelector?.('.app-root');
  return app?.getBoundingClientRect?.() || doc?.documentElement?.getBoundingClientRect?.() || null;
}

/**
 * A screen-space box as the turned layout box (axes swapped around the app's origin). A no-op while upright.
 * @param {{ left: number, top: number, right: number, bottom: number, width: number, height: number }} r
 * @param {DOMRect|{ top: number, right: number }} [ar] turnedBox()
 */
export function layoutBox(r, ar = turnedBox()) {
  if (!r || !ar) return r;
  const left = r.top - ar.top;
  const top = ar.right - r.right;
  return { left, top, right: left + r.height, bottom: top + r.width, width: r.height, height: r.width };
}

/** The layout viewport ({ width, height } of the turned box), or the window's while upright. */
export function layoutViewport(ar = turnedBox()) {
  if (!ar) return { width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 };
  return { width: ar.height, height: ar.width };
}
