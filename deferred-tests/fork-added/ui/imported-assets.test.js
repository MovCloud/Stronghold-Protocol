import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImportedAssetLoader } from '../../public/js/importedAssets.js';
import { installAssetFonts } from '../../public/js/assetFonts.js';

const origin = 'http://game.test:50069';
const asset = '/assets/~0123456789abcdef/a.png';
function fixture() {
  const calls = [], reads = [], revoked = [];
  const bodies = new Map([[origin + asset, 'imported']]);
  const loader = createImportedAssetLoader({ origin,
    storage: { async open() { return { async match(url) {
      reads.push(url); const body = bodies.get(new URL(url, origin).href);
      return body == null ? undefined : new Response(body);
    } }; } },
    fetch: async (...args) => { calls.push(args); return new Response('network'); },
    urls: { createObjectURL: () => 'blob:test', revokeObjectURL: u => revoked.push(u) },
  });
  return { ...loader, calls, reads, revoked, bodies };
}

test('only eligible GET art reads from imports; misses, foreign origins, range and code use network', async () => {
  const f = fixture();
  assert.equal(await (await f.assetFetch(asset)).text(), 'imported');
  for (const url of ['/data/assets.json', '/sim/a.js', '/p/mod/hash/a.png', '/assets/plain.png',
    'https://other.test' + asset, '/assets/~fedcba9876543210/new.png']) {
    assert.equal(await (await f.assetFetch(url)).text(), 'network');
  }
  await f.assetFetch(asset, { method: 'POST' });
  await f.assetFetch(asset, { headers: { Range: 'bytes=0-3' } });
  await f.assetFetch(new Request(origin + asset, { headers: { Range: 'bytes=0-' } }));
  assert.equal(f.calls.length, 9);
  assert.equal(f.reads.length, 2);
});

test('cache failures fall back, aborts do not serve stale imported responses', async () => {
  let called = false;
  const f = createImportedAssetLoader({ origin,
    storage: { open() { throw new Error('denied'); } },
    fetch: async () => { called = true; return new Response('fallback'); },
  });
  assert.equal(await (await f.assetFetch(asset)).text(), 'fallback');
  called = false;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.assetFetch(asset, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(called, false);
});

test('blob leases share concurrent reads and release only after their last consumer', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.acquireImportedUrl(asset), f.acquireImportedUrl(origin + asset)]);
  assert.equal(a.url, 'blob:test'); assert.equal(b.url, a.url);
  assert.equal(f.reads.length, 1);
  a.release(); a.release(); assert.deepEqual(f.revoked, []);
  b.release(); assert.deepEqual(f.revoked, ['blob:test']);
  f.bodies.clear();
  assert.equal((await f.acquireImportedUrl(asset)).url, asset, 'cleared data is not kept alive after release');
  f.bodies.set(origin + asset, 'new import');
  assert.equal((await f.acquireImportedUrl(asset)).url, 'blob:test', 'misses are not cached across later imports');
});

test('local fonts load manifest bytes through the import-aware reader and fall back by format', async () => {
  const loaded = [], added = [], reads = [];
  class Face {
    constructor(family, bytes, options) { loaded.push({ family, length: bytes.byteLength, options }); }
    async load() { return this; }
  }
  await installAssetFonts({ fonts: { faces: { a: { family: 'Bender', weight: 300,
    woff2: '/fonts/~0123456789abcdef/a.woff2', original: '/fonts/~0123456789abcdef/a.ttf' } } } }, {
    FontFace: Face, document: { fonts: { add: f => added.push(f) } },
    fetch: async url => { reads.push(url); return url.endsWith('.woff2') ? new Response(null, { status: 404 }) : new Response('font'); },
  });
  assert.equal(reads.length, 2); assert.equal(added.length, 1);
  assert.equal(loaded[0].options.weight, '300'); assert.equal(loaded[0].length, 4);
});
