// TypeSafe Jev username screening. The API key and all model traffic stay on the server.
import { performance } from 'node:perf_hooks';
import { sanitizeName, TokenBucket } from './net.js';
import { NAME_MAX_LEN, ERR } from '../shared/constants.js';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
// One compact binary question instead of repeating instructions for four categories.
// The fixed backend policy is not UI text; input stays in its original language and is never truncated for billing.
const REVIEW_TASK = '涉及中国现实政治、政治人物、政党、政治事件、政治口号、分裂或颠覆的名字。普通地名、历史文化、游戏虚构阵营不因单个模糊字词被判定为现实政治。以及其他色情暴力有害内容。'; // i18n-ignore: server-only moderation instructions, never translated or sent to the browser
const failOpen = () => ({ allowed: true });

export function createJevNameModeration({ apiKey, model = 'jev-latest', threshold = 0.5,
  endpoint = JEV_ENDPOINT, timeoutMs = 4500, fetchFn = globalThis.fetch, now = () => performance.now(),
  cacheMs = 300000, cacheLimit = 512, maxConcurrent = 8 } = {}) {
  if (!apiKey || !String(apiKey).trim()) throw new Error('Jev moderation requires TYPESAFE_API_KEY');
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error('SP_NAME_MODERATION_THRESHOLD must be between 0 and 1');
  const cache = new Map(), pending = new Map(), buckets = new Map();
  const globalBudget = new TokenBucket(20, 40, now());
  let stopped = false;
  const controllers = new Set();
  async function evaluate(name) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const questions = { unsafe: {
        type: 'noul',
        instructions: { task: REVIEW_TASK },
        criteria: { true: 'unsafe', false: 'safe' },
      } };
      const response = await fetchFn(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state: { username: name }, questions }) });
      if (!response.ok) return failOpen();
      const data = await response.json();
      const verdict = data?.answers?.unsafe;
      if (controller.signal.aborted || stopped || verdict?.type !== 'noul'
        || !Number.isFinite(verdict.noul) || verdict.noul < 0 || verdict.noul > 1) return failOpen();
      const allowed = verdict.noul < threshold;
      const result = allowed ? { allowed: true } : { allowed: false, code: ERR.NAME_REJECTED };
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value);
      cache.set(name, { result, until: now() + cacheMs });
      return result;
    } catch { return failOpen(); }
    finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); }
  }
  return {
    async check(raw, address = '?') {
      if (typeof raw !== 'string' || raw.length > NAME_MAX_LEN) return { allowed: false, code: ERR.BAD_MSG };
      const name = sanitizeName(raw);
      if (!name) return { allowed: false, code: ERR.BAD_MSG };
      if (stopped) return failOpen();
      const at = now();
      const cached = cache.get(name);
      if (cached && cached.until > at) return { ...cached.result };
      cache.delete(name);
      for (const [key, entry] of buckets) if (at - entry.seen > 60000) buckets.delete(key);
      let entry = buckets.get(address);
      if (!entry) {
        if (buckets.size >= 2048) return failOpen();
        entry = { bucket: new TokenBucket(1, 5, at), seen: at }; buckets.set(address, entry);
      }
      entry.seen = at;
      if (!entry.bucket.take(at)) return failOpen();
      if (pending.has(name)) return { ...await pending.get(name) };
      if (pending.size >= maxConcurrent || !globalBudget.take(at)) return failOpen();
      const task = evaluate(name);
      pending.set(name, task);
      try { return { ...await task }; } finally { pending.delete(name); }
    },
    close() { stopped = true; for (const controller of controllers) controller.abort(); cache.clear(); buckets.clear(); },
  };
}
