// public/js/render/app/pixi.js — load PIXI and pixi-spine once (one module-level promise).
import { runtimeURL } from '../../runtime.js';

import { installPixiMaterialFallback } from '../materialLoader.js';
import { installPixiNoEval } from './pixiNoEval.js';

const VENDOR = { pixi: '/vendor/pixi.min.js', spine: '/vendor/pixi-spine.js' };

let pixiPromise = null;

/**
 * Keep a 2D canvas in CPU memory (`willReadFrequently`; its 2D context must not exist yet). Chrome keeps ordinary 2D
 * canvases on the GPU and blanks them when the GPU process restarts (Android Chrome / Brave after switching apps;
 * chrome://gpucrash reproduces it): PIXI then re-uploads empty pixels into every canvas-drawn texture — the HP bars
 * (Texture.WHITE), projectiles (the FX atlas), the redeploy rings — until a reload. A CPU canvas keeps its pixels, and
 * these canvases are drawn once and uploaded, never drawn to the screen, so nothing is lost by it.
 * @template {HTMLCanvasElement} C @param {C} canvas @returns {C}
 */
export function cpuCanvas(canvas) {
  /** @type {any} */
  const c = canvas;
  if (!c || c._spCpu || typeof c.getContext !== 'function') return canvas;
  const get = c.getContext.bind(c);
  c.getContext = (type, opts) => get(type, type === '2d' ? { willReadFrequently: true, ...opts } : opts);
  c._spCpu = true;
  return canvas;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = runtimeURL(src);
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Make sure PIXI and PIXI.spine exist (classic scripts; loaded once). */
export function ensurePixi() {
  if (globalThis.PIXI && globalThis.PIXI.spine) {
    installPixiNoEval(globalThis.PIXI);
    installPixiMaterialFallback(globalThis.PIXI);
    return Promise.resolve(globalThis.PIXI);
  }
  if (!pixiPromise) {
    pixiPromise = (async () => {
      if (!globalThis.PIXI) await loadScript(VENDOR.pixi);
      installPixiNoEval(globalThis.PIXI);
      if (!globalThis.PIXI?.spine) await loadScript(VENDOR.spine);
      if (!globalThis.PIXI || !globalThis.PIXI.spine) throw new Error('PIXI / pixi-spine unavailable');
      installPixiMaterialFallback(globalThis.PIXI);
      return globalThis.PIXI;
    })();
    pixiPromise.catch(() => { pixiPromise = null; });
  }
  return pixiPromise;
}
