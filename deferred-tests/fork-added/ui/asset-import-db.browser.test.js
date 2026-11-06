// SP_E2E=1 CHROME_PATH=<browser> node --test test/ui/asset-import-db.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('HTTP IndexedDB adapter commits, survives reload, handles corrupt records, and clears imports', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 30000,
}, async (t) => {
  const moduleSource = await readFile(new URL('../../public/js/assetImportDb.js', import.meta.url));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/js/assetImportDb.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/js/assetImportDb.js' ? moduleSource : '<!doctype html><title>IndexedDB test</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  const first = await page.evaluate(async () => {
    const { createImportedAssetStorage } = await import('/js/assetImportDb.js');
    const storage = createImportedAssetStorage({ secure: false });
    const cache = await storage.open('sp-imported-assets-v1');
    const sameHandle = cache === await storage.open('sp-imported-assets-v1');
    const url = '/assets/~0123456789abcdef/test.png';
    const body = new Uint8Array(300_000).map((_, i) => i & 255);
    await cache.put(url, new Response(body, { headers: { 'Content-Type': 'image/png' } }));
    await cache.put('/sp-imported-index.json', Response.json([url]));
    const hit = await cache.match(url);
    const bytes = new Uint8Array(await hit.arrayBuffer());
    let blocked = false;
    try { await cache.put('http://elsewhere.test/a', new Response('bad')); } catch { blocked = true; }
    return {
      size: bytes.byteLength, first: bytes[0], last: bytes.at(-1),
      type: hit.headers.get('content-type'), blocked, sameHandle,
      paths: await (await cache.match('/sp-imported-index.json')).json(),
      names: await storage.keys(),
    };
  });
  assert.deepEqual(first, {
    size: 300_000, first: 0, last: 223, type: 'image/png', blocked: true, sameHandle: true,
    paths: ['/assets/~0123456789abcdef/test.png'], names: ['sp-imported-assets-v1'],
  });

  await page.reload();
  const second = await page.evaluate(async () => {
    const { createImportedAssetStorage } = await import('/js/assetImportDb.js');
    const storage = createImportedAssetStorage({ secure: false });
    const cache = await storage.open('sp-imported-assets-v1');
    const url = '/assets/~0123456789abcdef/test.png';
    const hit = await cache.match(url);
    const before = { size: (await hit.arrayBuffer()).byteLength, keys: (await cache.keys()).map((key) => new URL(key.url).pathname) };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sp-imported-assets', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').put({ cacheName: 'sp-imported-assets-v1', url: new URL(url, location.href).href, body: 'corrupt', status: 200, headers: [] });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const corruptIsMiss = (await cache.match(url)) === undefined;
    db.close();
    const deleted = await storage.delete('sp-imported-assets-v1');
    const missing = await storage.delete('sp-imported-assets-v1');
    const names = await storage.keys();
    const freshHandle = await storage.open('sp-imported-assets-v1') !== cache;
    await storage.delete('sp-imported-assets-v1');
    return { before, corruptIsMiss, deleted, missing, names, freshHandle };
  });
  assert.deepEqual(second, {
    before: { size: 300_000, keys: ['/assets/~0123456789abcdef/test.png', '/sp-imported-index.json'] },
    corruptIsMiss: true, deleted: true, missing: false, names: [], freshHandle: true,
  });

  await page.evaluate(async () => {
    const { createImportedAssetStorage } = await import('/js/assetImportDb.js');
    window.oldStorage = createImportedAssetStorage({ secure: false });
    window.oldCache = await window.oldStorage.open('sp-imported-assets-v1');
  });
  const other = await browser.newPage();
  await other.goto(`http://127.0.0.1:${server.address().port}/`);
  await other.evaluate(async () => {
    const { createImportedAssetStorage } = await import('/js/assetImportDb.js');
    await createImportedAssetStorage({ secure: false }).delete('sp-imported-assets-v1');
  });
  const restored = await page.evaluate(async () => {
    const url = '/assets/~0123456789abcdef/late.png';
    await window.oldCache.put(url, new Response('late write'));
    return { names: await window.oldStorage.keys(), body: await (await window.oldCache.match(url)).text() };
  });
  assert.deepEqual(restored, { names: ['sp-imported-assets-v1'], body: 'late write' });
  assert.deepEqual(await other.evaluate(async () => {
    const { createImportedAssetStorage } = await import('/js/assetImportDb.js');
    const storage = createImportedAssetStorage({ secure: false });
    const listed = await storage.keys();
    await storage.delete('sp-imported-assets-v1');
    return { listed, afterClear: await storage.keys() };
  }), { listed: ['sp-imported-assets-v1'], afterClear: [] });

  const denied = await browser.newPage();
  await denied.evaluateOnNewDocument(() => {
    for (const name of ['indexedDB', 'caches']) {
      Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    }
  });
  await denied.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(await denied.evaluate(async () => {
    const module = await import('/js/assetImportDb.js');
    return { singleton: module.importedAssetStorage, factory: module.createImportedAssetStorage() };
  }), { singleton: null, factory: null });
});
