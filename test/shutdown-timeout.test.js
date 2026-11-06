// test/shutdown-timeout.test.js — 本分支的关停窗口由 SP_SHUTDOWN_TIMEOUT_MS 控制：默认 60 秒，接受 1000–300000 毫秒。
// 上游的 test/shutdown-timeout.test.js 按 boot.js 的 shutdownHandler 导出与 5 秒默认值编写，不适用于本分支的实现，
// 已归档在 deferred-tests/；这里只测本分支实际导出的 shutdownTimeoutMs()。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shutdownTimeoutMs } from '../server/http/boot.js';

test('未设置 SP_SHUTDOWN_TIMEOUT_MS 时默认 60 秒', () => {
  const saved = process.env.SP_SHUTDOWN_TIMEOUT_MS;
  try {
    delete process.env.SP_SHUTDOWN_TIMEOUT_MS;
    assert.equal(shutdownTimeoutMs(), 60_000);
  } finally {
    if (saved === undefined) delete process.env.SP_SHUTDOWN_TIMEOUT_MS;
    else process.env.SP_SHUTDOWN_TIMEOUT_MS = saved;
  }
});

test('显式参数优先于环境变量，1000 与 300000 毫秒都接受', () => {
  const saved = process.env.SP_SHUTDOWN_TIMEOUT_MS;
  try {
    process.env.SP_SHUTDOWN_TIMEOUT_MS = '45000';
    assert.equal(shutdownTimeoutMs(), 45_000, '环境变量生效');
    assert.equal(shutdownTimeoutMs('120000'), 120_000, '显式值优先');
    assert.equal(shutdownTimeoutMs('1000'), 1_000, '下界本身接受');
    assert.equal(shutdownTimeoutMs('300000'), 300_000, '上界本身接受');
  } finally {
    if (saved === undefined) delete process.env.SP_SHUTDOWN_TIMEOUT_MS;
    else process.env.SP_SHUTDOWN_TIMEOUT_MS = saved;
  }
});

test('不可用的窗口回落 60 秒，而不是去掉兜底', () => {
  for (const bad of ['0', '999', '300001', '-1', 'abc', '', '60000.5', 'Infinity', 'NaN', undefined]) {
    assert.equal(shutdownTimeoutMs(bad), 60_000, `${String(bad)} -> 60000`);
  }
});
