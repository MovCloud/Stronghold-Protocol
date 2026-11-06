// Native img with one per-URL OpenI retry, gated by the resource-pack manager (resourcePacks.js): a pack proven
// absent is never requested — the manager answers BEFORE the <img> spends the request (P5, the owner's call: a
// doomed request is pure console noise and wasted latency; the mainline's request-anyway default is only because
// it has no manager), and the owner's placeholder handler runs at once. An image that has already loaded never
// times out: a lazy image's observer can report it in view only after its load event (busy phones entering a
// match, the browser's own wider lazy-load margin), and the timer then checks the element itself before swapping
// to OpenI. A timer that ends while the page is hidden waits for it to be shown again.
import { h } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { MATERIAL_IMAGE_TIMEOUT_MS, drainMaterialBody, openiFallbackUrl } from '../materialFallback.js';
import { markPackMissing, resolve } from '../resourcePacks.js';

/**
 * A failed <img> load may be the pack's first proof of absence. An img error event carries no HTTP status, so the
 * failure is verified with one silent fetch (fetch 404s log nothing to the console; a transient outage must not be
 * remembered as a missing pack) before markPackMissing records the root — after that, every other view of that
 * pack mounts with no request at all. Never call this with an `?sp_source=openi` URL: the query rides inside the
 * first path segment, so packRootOf would invent a per-file root.
 * @param {string} source @param {{ fetch?: typeof fetch }} [deps] @returns {Promise<void>}
 */
export function noteImageFailure(source, { fetch: doFetch = (...a) => globalThis.fetch(...a) } = {}) {
  if (resolve(source).state !== 'unknown') return Promise.resolve(); // already decided: 'missing' needs no probe, 'ok' needs none either
  return Promise.resolve(doFetch(source, { credentials: 'omit', cache: 'no-store' })).then(
    async (res) => {
      await drainMaterialBody(res);
      if (res?.status === 404) markPackMissing(source);
    },
    () => { /* a network error is not evidence of absence */ },
  );
}

export function MaterialImage({ src, onLoad, onError, loading, timeoutMs = MATERIAL_IMAGE_TIMEOUT_MS, ...props }) {
  const [retry, setRetry] = useState(null);
  const source = retry?.original === src ? retry.source : src;
  const missing = resolve(source).state === 'missing';
  const node = useRef(null);
  const timer = useRef(null);
  const current = useRef(null);
  const failed = useRef(null);
  const loaded = useRef(null);
  const watch = useRef(null);
  current.current = source;
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  const done = (img) => loaded.current === source || !!(img?.complete && img.naturalWidth > 0);
  const fail = (event) => {
    if (current.current !== source || failed.current === source) return;
    clear();
    failed.current = source;
    if (!retry) noteImageFailure(src); // the first source failed: let the manager learn the pack's state (verified 404 only)
    const fallback = openiFallbackUrl(source);
    if (fallback && resolve(fallback).state !== 'missing') setRetry({ original: src, source: fallback });
    else onError?.(event);
  };
  useEffect(() => {
    const img = node.current;
    let observer;
    if (missing || !openiFallbackUrl(src) || !img || done(img)) return;
    const expire = () => {
      timer.current = null;
      if (current.current !== source || done(img)) return;
      if (globalThis.document?.hidden) { arm(); return; } // a backgrounded tab: no verdict on a frozen load
      fail({ type: 'error', target: img, currentTarget: img });
    };
    const arm = () => { timer.current = setTimeout(expire, timeoutMs); };
    const start = () => {
      if (current.current !== source || failed.current === source || timer.current != null || done(img)) return;
      arm();
    };
    // Do not time out an offscreen lazy image that the browser has not even requested yet.
    if (loading === 'lazy') {
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)) { observer.disconnect(); start(); }
        }, { rootMargin: '300px' });
        observer.observe(img);
        watch.current = observer;
      }
    } else start();
    return () => { clear(); observer?.disconnect(); if (watch.current === observer) watch.current = null; };
  }, [src, source, loading, timeoutMs, missing]);
  // A proven-absent pack: no request at all (the img renders empty) and the owner's placeholder runs immediately.
  useEffect(() => {
    if (!missing || loaded.current === source) return;
    failed.current = source;
    onError?.({ type: 'error' });
  }, [src, source, missing]);
  return h('img', { ...props, key: source, src: missing ? undefined : source, loading, ref: node, crossOrigin: openiFallbackUrl(src) ? 'anonymous' : props.crossOrigin,
    onLoad: event => {
      if (current.current !== source) return;
      clear(); watch.current?.disconnect(); loaded.current = source; failed.current = null; onLoad?.(event);
    }, onError: fail });
}
