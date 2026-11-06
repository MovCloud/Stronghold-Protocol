import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Hex } from '../../public/js/sha256.js';

function expected(data) {
  return createHash('sha256').update(data).digest('hex');
}

test('SHA-256 fallback agrees with standard vectors and native crypto at block boundaries', async () => {
  for (const text of ['', 'abc', 'The quick brown fox jumps over the lazy dog', '飞边和毛刺']) {
    assert.equal(await sha256Hex(text, null), expected(text));
  }
  for (const length of [1, 55, 56, 63, 64, 65, 127, 128, 129, 4096, 1_048_577]) {
    const bytes = randomBytes(length);
    const want = expected(bytes);
    assert.equal(await sha256Hex(bytes, null), want, `fallback ${length}`);
    assert.equal(await sha256Hex(bytes), want, `native ${length}`);
  }
});

test('SHA-256 hashes only the requested typed-array view and falls back after digest failure', async () => {
  const container = new Uint8Array([99, 1, 2, 3, 88]);
  const view = container.subarray(1, 4);
  assert.equal(await sha256Hex(view, null), expected(view));
  assert.equal(await sha256Hex(view.buffer, null), expected(container));
  const denied = { digest: async () => { throw new Error('unavailable'); } };
  assert.equal(await sha256Hex(view, denied), expected(view));
  await assert.rejects(sha256Hex({}), TypeError);
});
