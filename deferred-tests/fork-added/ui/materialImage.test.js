// materialImage's resource-pack gate (P5): a pack the manager has proven absent is never requested — the <img>
// renders empty and the owner's placeholder handler runs at once; a first failure is verified with one silent
// fetch (an img error event carries no HTTP status, so a transient outage must not poison the table) before the
// root is remembered as missing. The component itself is browser-bound; these are the pure decisions it makes.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { noteImageFailure } from '../../public/js/ui/materialImage.js';
import { markPackInstalled, markPackMissing, packRootOf, resolve, resetPackState } from '../../public/js/resourcePacks.js';

const body = (calls) => ({
  getReader: () => ({
    read: async () => { calls.push('read'); return { done: true, value: undefined }; },
    cancel: () => { calls.push('cancel'); },
  }),
});

describe('materialImage resource-pack gate', () => {
  beforeEach(() => resetPackState());

  test('a verified 404 marks the whole pack root missing — every other view of that root skips its request', async () => {
    let calls = 0;
    await noteImageFailure('/assets/char/avatar/char_1012_skadi2.png', { fetch: async () => { calls++; return { status: 404, body: body([]) }; } });
    assert.equal(calls, 1);
    assert.equal(resolve('/assets/char/avatar/char_1012_skadi2.png').state, 'missing');
    assert.equal(resolve('/assets/char/avatar/char_245_cello.png').state, 'missing', 'same root /assets/char');
    assert.equal(resolve('/assets/bond/yanShip.png').state, 'unknown', 'a different root stays untouched');
  });

  test('a transient failure is not evidence of absence', async () => {
    await noteImageFailure('/assets/bond/yanShip.png', { fetch: async () => ({ status: 503, body: body([]) }) });
    assert.equal(resolve('/assets/bond/yanShip.png').state, 'unknown');
    await noteImageFailure('/assets/bond/yanShip.png', { fetch: async () => { throw new Error('offline'); } });
    assert.equal(resolve('/assets/bond/yanShip.png').state, 'unknown', 'a network error is not a 404');
  });

  test('a decided root is never probed again', async () => {
    let calls = 0;
    markPackMissing('/assets/bond/yanShip.png');
    await noteImageFailure('/assets/bond/yanShip.png', { fetch: async () => { calls++; return { status: 404, body: body([]) }; } });
    assert.equal(calls, 0, 'missing needs no probe');
    markPackInstalled('/assets/bond');
    await noteImageFailure('/assets/bond/yanShip.png', { fetch: async () => { calls++; return { status: 404, body: body([]) }; } });
    assert.equal(calls, 0, 'an installed pack needs no probe either');
  });

  test('the probed body is drained, never cancelled (cancel logs net::ERR_ABORTED)', async () => {
    const calls = [];
    await noteImageFailure('/assets/ui/modeIcon/mode_funny_icon.png', { fetch: async () => ({ status: 404, body: body(calls) }) });
    assert.deepEqual(calls, ['read']);
    assert.equal(resolve('/assets/ui/modeIcon/mode_funny_icon.png').state, 'missing');
  });

  test('an OpenI URL resolves to the same clean pack root (its query rides in the second segment)', () => {
    assert.equal(packRootOf('/assets/bond/yanShip.png?sp_source=openi'), '/assets/bond');
    assert.equal(packRootOf('/assets/bond/yanShip.png?sp_source=openi'), packRootOf('/assets/bond/yanShip.png'),
      'the fail() gate reads the fallback with the same pack verdict as the original URL');
  });
});
