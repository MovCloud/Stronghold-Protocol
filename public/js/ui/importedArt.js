// Resolve imported, content-hashed art before assigning it to an intrinsic element.
// This keeps the browser from requesting an absent server file while IndexedDB is checked.
import { h } from '../../vendor/preact.module.js';
import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { acquireImportedUrl, isImportedAssetUrl } from '../importedAssets.js';

const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/gi;

function urlsIn(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(CSS_URL)].map((match) => match[2]).filter(isImportedAssetUrl);
}

function styleUrls(style) {
  if (typeof style === 'string') return urlsIn(style);
  if (!style || typeof style !== 'object') return [];
  return Object.values(style).flatMap(urlsIn);
}

/** Whether hFresh should interpose on an intrinsic DOM element. */
export function hasImportedArt(type, props) {
  if (typeof type !== 'string' || !props) return false;
  return (type.toLowerCase() === 'img' && isImportedAssetUrl(props.src)) || styleUrls(props.style).length > 0;
}

function resolvedStyle(style, resolved) {
  const replace = (value) => typeof value === 'string'
    ? value.replace(CSS_URL, (match, quote, url) => isImportedAssetUrl(url)
      ? (resolved.has(url) ? `url(${quote}${resolved.get(url)}${quote})` : 'none') : match)
    : value;
  if (typeof style === 'string') return replace(style);
  if (!style || typeof style !== 'object') return style;
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [key, replace(value)]));
}

/** Intrinsic-element wrapper; hFresh uses h() directly here to avoid wrapping itself. */
export function ImportedArtElement({ elementType, forwardedRef, children, ...props }) {
  const src = elementType.toLowerCase() === 'img' && isImportedAssetUrl(props.src) ? props.src : null;
  const urls = [...new Set([src, ...styleUrls(props.style)].filter(Boolean))];
  const signature = JSON.stringify(urls);
  const [ready, setReady] = useState({ signature: '', urls: new Map() });
  const domRef = useRef(null);

  useLayoutEffect(() => {
    if (typeof forwardedRef === 'function') forwardedRef(domRef.current);
    else if (forwardedRef) forwardedRef.current = domRef.current;
    return () => {
      if (typeof forwardedRef === 'function') forwardedRef(null);
      else if (forwardedRef) forwardedRef.current = null;
    };
  }, [forwardedRef]);

  useEffect(() => {
    let active = true;
    const leases = [];
    Promise.all(urls.map(async (url) => {
      const lease = await acquireImportedUrl(url).catch(() => ({ url, release() {} }));
      if (!active) { lease.release(); return [url, null]; }
      leases.push(lease);
      return [url, lease.url];
    })).then((pairs) => {
      if (active) setReady({ signature, urls: new Map(pairs) });
    });
    return () => { active = false; leases.forEach((lease) => lease.release()); };
  }, [signature]);

  const resolved = ready.signature === signature ? ready.urls : new Map();
  const actual = { ...props, ref: domRef };
  if (src) actual.src = resolved.has(src) ? resolved.get(src) : undefined;
  if (props.style != null) actual.style = resolvedStyle(props.style, resolved);
  return h(elementType, actual, children);
}
