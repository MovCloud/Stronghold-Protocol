#!/usr/bin/env node
// i18n-ignore-file: owner CLI intentionally reports operational results in Chinese.
// 本地素材库：游戏素材不进 git，统一放在仓库之外的目录；后续工具先从库里取，缺失再下载。
// 路径默认 <仓库>/../../asset-library，可用 --root 或环境变量 SP_ASSET_LIBRARY 覆盖。
//
//   node tools/asset-library.mjs status   [--root <dir>]
//   node tools/asset-library.mjs sync:avatars [--root <dir>] [--force]
//   node tools/asset-library.mjs sync:art     [--root <dir>] [--limit N] [--gap ms] [--concurrency N]
//   node tools/asset-library.mjs sync:models  [--root <dir>] [--limit N] [--gap ms] [--concurrency N]
//   node tools/asset-library.mjs verify   [--root <dir>]
//   node tools/asset-library.mjs install  [--root <dir>] [--dest <public 目录>]
//
// 下载限速：默认每个请求间隔 800ms、并发 3；遇到 429/403/503 会退避重试，连续 3 次被限流则整体停止，
// 并在输出里给出停止时的 URL、主机与状态码。已入库的文件按 sha256 跳过，可反复续跑。
//
// 库内布局与 public 下的 URL 空间一致，安装时按路径直接映射：
//   asset-library/files/assets/char/skin_avatar/<skinId>.png
//   asset-library/index.json   { entries: { "assets/…": { sha256, bytes, source, fetchedAt, verified } } }
// 头像来源优先顺序：库 → 仓库 public → GitHub 镜像；有 data/cdn-resource-config.json 哈希时强校验。
import { readFile, writeFile, mkdir, rename, rm, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.resolve(REPO, '..', '..', 'asset-library');
const MIRROR = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/';
const ART_MIRROR = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/';
const SPINE_MIRROR = 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/spine/';
const AVATAR_PREFIX = 'assets/char/skin_avatar/';
const UA = 'Mozilla/5.0 Stronghold-Assets-Sync';
const RATE_STATUS = new Set([403, 429, 503]);

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) || 'status';
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : null;
};
const root = path.resolve(value('root') || process.env.SP_ASSET_LIBRARY || DEFAULT_ROOT);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isPng = (bytes) => bytes.length > 1000 && bytes.subarray(0, 4).toString('hex') === '89504e47';
const fileOf = (logical) => path.join(root, 'files', ...logical.split('/'));

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

async function loadIndex() {
  const raw = readJson(path.join(root, 'index.json'), null);
  if (!raw || raw.version !== 1 || typeof raw.entries !== 'object') return { version: 1, updatedAt: null, entries: {} };
  return raw;
}

async function saveIndex(index) {
  await mkdir(root, { recursive: true });
  index.updatedAt = new Date().toISOString();
  await writeFile(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}

async function place(logical, bytes) {
  const file = fileOf(logical);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, bytes);
  await rm(file, { force: true });
  await rename(tmp, file);
}

/** 期望哈希：data/cdn-resource-config.json 里 /assets/… 路径对应的 sha256（有才校验）。 */
function expectedHashes() {
  const cfg = readJson(path.join(REPO, 'data', 'cdn-resource-config.json'), null);
  const out = new Map();
  for (const [key, val] of Object.entries((cfg && cfg.files) || {})) {
    const sha = (val || []).find((x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x));
    if (sha) out.set(key.replace(/^\//, ''), sha);
  }
  return out;
}

function manifestIds() {
  const m = readJson(path.join(REPO, 'data', 'assets.json'), {});
  return Object.keys(m.skins || {});
}

/** GitHub 镜像的皮肤头像文件名：官方 id 的最后一段 `_n` 在文件名里写作 `%23n`。 */
const mirrorName = (id) => {
  const i = id.lastIndexOf('_');
  return `${id.slice(0, i)}%23${id.slice(i + 1)}.png`;
};

async function attempt(publicFile) {
  if (existsSync(publicFile)) {
    const bytes = Buffer.from(await readFile(publicFile));
    if (isPng(bytes)) return { bytes, source: 'local:public' };
  }
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(MIRROR + mirrorName(path.basename(publicFile, '.png')), {
        headers: { 'User-Agent': 'Mozilla/5.0 Stronghold-Assets-Sync' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (isPng(bytes)) return { bytes, source: 'github:ArknightsGameResource' };
    } catch { /* 重试 */ }
  }
  return null;
}

async function syncAvatars() {
  const index = await loadIndex();
  const expected = expectedHashes();
  const ids = manifestIds();
  const force = flag('force');
  let i = 0;
  const out = { total: ids.length, adopt: 0, download: 0, failed: [], skipped: 0, hashChecked: 0 };

  const one = async (id) => {
    const logical = `${AVATAR_PREFIX}${id}.png`;
    const entry = index.entries[logical];
    const dest = fileOf(logical);
    if (!force && entry && existsSync(dest)) {
      const bytes = Buffer.from(await readFile(dest));
      if (sha256(bytes) === entry.sha256) { out.skipped++; return; }
    }
    const publicFile = path.join(REPO, 'public', ...logical.split('/'));
    const got = await attempt(publicFile);
    if (!got) { out.failed.push(id); return; }
    const hash = sha256(got.bytes);
    const want = expected.get(logical);
    if (want && want !== hash) { out.failed.push(`${id}:sha`); return; }
    await place(logical, got.bytes);
    index.entries[logical] = {
      sha256: hash, bytes: got.bytes.length, fetchedAt: new Date().toISOString(),
      source: got.source, verified: !!want,
    };
    if (got.source === 'local:public') out.adopt++; else out.download++;
    if (want) out.hashChecked++;
  };

  const worker = async () => { while (i < ids.length) await one(ids[i++]); };
  await Promise.all([1, 2, 3, 4].map(worker));
  await saveIndex(index);
  return out;
}

// ---- 限速下载：sync:art（立绘/头像）与 sync:models（战斗 Spine）共用 ------------------------------
const GAP = Math.max(200, Number(value('gap') || 800));
const CONCURRENCY = Math.max(1, Math.min(6, Number(value('concurrency') || 3)));
const LIMIT = Math.max(0, Number(value('limit') || 0));
let nextSlot = 0;
let stop = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 全局请求间隔：并发 worker 也按 GAP 排队，避免瞬间并发过高。 */
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP;
  if (at > now) await sleep(at - now);
}

/** 单请求：限速 + 限流退避；连续 3 次 429/403/503 时置 stop，所有 worker 一并停下。 */
async function fetchLimited(url, consecutive) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (stop) return { stop };
    await slot();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (RATE_STATUS.has(res.status)) {
        consecutive.n += 1;
        if (consecutive.n >= 3) {
          stop = { reason: 'rate-limit', url, host: new URL(url).host, status: res.status, at: new Date().toISOString() };
          return { stop };
        }
        await sleep(8000 * (attempt + 1));
        continue;
      }
      consecutive.n = 0;
      if (!res.ok) return { status: res.status };
      return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
    } catch (error) {
      consecutive.n = 0;
      if (attempt === 2) return { error: error.cause?.code || error.message };
      await sleep(2500 * (attempt + 1));
    }
  }
  return { error: 'retries' };
}

/** 官方 id → 镜像文件名：最后一段 `_n` 在文件名里写作 `%23n`。 */
function encodedName(id) {
  const i = id.lastIndexOf('_');
  return i < 0 ? id : `${id.slice(0, i)}%23${id.slice(i + 1)}`;
}

/** assets/skins/<id>/{avatar,portrait}.png ← ArknightsGameResource（同一套镜像）。 */
function artTasks() {
  const m = readJson(path.join(REPO, 'data', 'assets.json'), {});
  const out = [];
  for (const id of Object.keys(m.skins || {})) {
    const enc = encodedName(id);
    out.push({ logical: `assets/skins/${id}/portrait.png`, remote: `${ART_MIRROR}portrait/${enc}.png` });
    out.push({ logical: `assets/skins/${id}/avatar.png`, remote: `${ART_MIRROR}avatar/${enc}.png` });
  }
  return out;
}

/** manifest 里 skin.spine.{front,back} 的本地路径 ← ArknightsResource 的同名骨架。 */
function modelTasks() {
  const m = readJson(path.join(REPO, 'data', 'assets.json'), {});
  const out = [];
  for (const skin of Object.values(m.skins || {})) {
    for (const [side, sp] of Object.entries(skin.spine || {})) {
      if (!sp || typeof sp !== 'object' || !sp.skel) continue;
      const stem = path.basename(String(sp.skel), '.skel');
      const dir = side === 'back' ? 'Back' : 'Front';
      const files = [sp.skel, sp.atlas, ...(Array.isArray(sp.textures) ? sp.textures : sp.textures ? [sp.textures] : [])];
      for (const local of files) {
        const base = path.basename(String(local));
        out.push({
          logical: String(local).replace(/^\//, ''),
          remote: `${SPINE_MIRROR}${skin.charId}/${stem}/${dir}/${base}`,
        });
      }
    }
  }
  return out;
}

async function runSync(tasks, label) {
  const index = await loadIndex();
  const seen = new Set();
  const pending = [];
  for (const task of tasks) {
    if (seen.has(task.logical)) continue;
    seen.add(task.logical);
    const entry = index.entries[task.logical];
    if (!flag('force') && entry && existsSync(fileOf(task.logical))) {
      if (sha256(Buffer.from(await readFile(fileOf(task.logical)))) === entry.sha256) continue;
    }
    pending.push(task);
  }
  const run = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  stop = null;
  nextSlot = 0;
  const out = { kind: label, planned: seen.size, pending: pending.length, thisRun: run.length, fetched: 0, bytes: 0, missing: [], failed: [] };
  let i = 0;
  const consecutive = { n: 0 };
  const keep = (list, value) => { if (list.length < 20) list.push(value); };
  const worker = async () => {
    while (i < run.length && !stop) {
      const task = run[i++];
      const result = await fetchLimited(task.remote, consecutive);
      if (result.stop) break;
      if (result.status === 404) { keep(out.missing, task.logical); continue; }
      if (!result.bytes) { keep(out.failed, `${task.logical}:${result.status || result.error}`); continue; }
      const text = task.logical.endsWith('.skel') || task.logical.endsWith('.atlas');
      if (!text && !isPng(result.bytes)) { keep(out.failed, `${task.logical}:notpng`); continue; }
      await place(task.logical, result.bytes);
      index.entries[task.logical] = {
        sha256: sha256(result.bytes), bytes: result.bytes.length, fetchedAt: new Date().toISOString(),
        source: new URL(task.remote).host, verified: false, kind: label,
      };
      out.fetched += 1;
      out.bytes += result.bytes.length;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await saveIndex(index);
  if (stop) out.stopped = stop;
  return out;
}

async function verify() {
  const index = await loadIndex();
  const missing = [], mismatched = [];
  for (const [logical, entry] of Object.entries(index.entries)) {
    const file = fileOf(logical);
    if (!existsSync(file)) { missing.push(logical); continue; }
    const hash = sha256(Buffer.from(await readFile(file)));
    if (hash !== entry.sha256) mismatched.push(logical);
  }
  return { entries: Object.keys(index.entries).length, missing, mismatched };
}

async function install() {
  const index = await loadIndex();
  const dest = path.resolve(value('dest') || path.join(REPO, 'public'));
  const copied = [];
  for (const [logical, entry] of Object.entries(index.entries)) {
    const target = path.join(dest, ...logical.split('/'));
    if (existsSync(target)) {
      const hash = sha256(Buffer.from(await readFile(target)));
      if (hash === entry.sha256) continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(fileOf(logical), target);
    copied.push(logical);
  }
  return { dest, copied: copied.length };
}

function status() {
  const index = readJson(path.join(root, 'index.json'), { entries: {} });
  const entries = index.entries || {};
  const ids = manifestIds();
  const groups = {};
  let bytes = 0;
  for (const [logical, entry] of Object.entries(entries)) {
    const group = logical.split('/').slice(0, 3).join('/');
    groups[group] = (groups[group] || 0) + 1;
    bytes += entry.bytes || 0;
  }
  const covered = ids.filter((id) => entries[`${AVATAR_PREFIX}${id}.png`]).length;
  return { root, entries: Object.keys(entries).length, bytes, groups, avatarCovered: `${covered}/${ids.length}` };
}

const run = {
  status,
  'sync:avatars': syncAvatars,
  'sync:art': () => runSync(artTasks(), 'art'),
  'sync:models': () => runSync(modelTasks(), 'models'),
  verify,
  install,
}[command];
if (!run) {
  console.log('用法：node tools/asset-library.mjs [status|sync:avatars|sync:art|sync:models|verify|install] [--root <dir>] [--dest <public 目录>] [--limit N] [--gap ms] [--concurrency N]');
  process.exitCode = 2;
} else {
  Promise.resolve(run()).then((r) => console.log(JSON.stringify(r, null, 1))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
