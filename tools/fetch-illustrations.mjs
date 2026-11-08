// Fetch the skin illustrations (立绘) that no community dump carries: the only source is the PRTS wiki API.
// Nothing here replaces an existing file — put() refuses different bytes, so a re-run only fills the gaps.
//
// Rate control (the wiki is a shared public source): the titles are looked up in batches of 50, so 276 skins
// cost 6 API requests, and the images themselves are fetched one at a time with a fixed gap. A 403/429 stops
// the run instead of retrying.
//
// Usage: node tools/fetch-illustrations.mjs [--gap=500] [--limit=N] [--dry-run]

import { readFile, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { OPERATOR_SKINS } from '../shared/skins.js';
import { download, put } from './prepare-operator-skins.mjs';
import { validateSkinPng } from './assets/skin-battle-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = join(root, 'public', 'assets');
const flag = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : Number(process.argv[i + 1]); };
const gapMs = Math.max(0, flag('--gap', 500));
const limit = Math.max(0, flag('--limit', 0));
const dryRun = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const manifest = JSON.parse(await readFile(join(root, 'data/assets.json'), 'utf8'));
const byId = new Map(OPERATOR_SKINS.map((s) => [s.id, s]));

const wanted = [];
for (const [id, rec] of Object.entries(manifest.skins || {})) {
  if (!rec?.illustration) continue;
  const rel = rec.illustration.replace('/assets/', '');
  if (await stat(join(assetRoot, rel)).catch(() => null)) continue; // already on disk
  const skin = byId.get(id);
  if (!skin) continue;
  wanted.push({ id, rel, title: `文件:立绘 ${skin.charName} skin${skin.wikiIndex}.png` });
}
console.log(`[illustrations] ${wanted.length} missing of ${Object.keys(manifest.skins || {}).length} manifest entries`);

// One API request per 50 titles.
const info = new Map();
for (let i = 0; i < wanted.length; i += 50) {
  const batch = wanted.slice(i, i + 50);
  const api = new URL('https://prts.wiki/api.php');
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', prop: 'imageinfo', titles: batch.map((w) => w.title).join('|'), iiprop: 'url|size|sha1', ilimit: 50 })) api.searchParams.set(k, v);
  const meta = JSON.parse((await download(api.href, 256 * 1024)).toString('utf8'));
  for (const page of Object.values(meta.query?.pages || {})) info.set(page.title, page.imageinfo?.[0]);
  console.log(`[illustrations] lookup ${Math.min(i + 50, wanted.length)}/${wanted.length}`);
  await sleep(gapMs);
}

let written = 0;
const failed = [];
for (const w of wanted) {
  if (limit && written >= limit) break;
  const rec = info.get(w.title);
  if (!rec?.url || !Number.isSafeInteger(rec.size) || rec.size > 16 * 1024 * 1024) { failed.push({ id: w.id, why: `Missing picture: ${w.title}` }); continue; }
  if (dryRun) { console.log(`[illustrations] ${w.id} → ${rec.url} (${rec.size} B)`); continue; }
  try {
    const bytes = await download(rec.url, 16 * 1024 * 1024);
    if (bytes.length !== rec.size || createHash('sha1').update(bytes).digest('hex') !== rec.sha1) throw new Error('Wiki picture integrity mismatch');
    validateSkinPng(bytes);
    await put(join(assetRoot, w.rel), bytes);
    written++;
    console.log(`[illustrations] ${written}/${wanted.length} ${w.id}`);
  } catch (error) {
    failed.push({ id: w.id, why: error.message });
    if ([403, 429].includes(error.status)) { console.log(`[illustrations] source blocked (${error.status}), stopping`); break; }
  }
  await sleep(gapMs);
}

console.log(`[illustrations] written=${written} failed=${failed.length}`);
for (const f of failed) console.log(`  ${f.id}: ${f.why}`);
