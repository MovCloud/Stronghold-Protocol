// test/ui/orientation.e2e.test.js — 设置 →「显示方向」 and the top-bar pill geometry in a real browser (owner request
// 2026-11-07): the 版本 / 在线 pills must share one box at every window size (and with a coarse pointer), the dialog's
// three steps must turn the page (html[data-rotate], .app-root laid out in the swapped box), and the lobby must not
// scroll sideways at phone sizes. The interface is one landscape stage: 自动适应 turns a window taller than wide,
// 锁定竖屏 never turns, 锁定横屏 always turns.
// SP_E2E=1 node --test test/ui/orientation.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, startRealServer } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const SCREENS = [[1920, 1080], [1366, 768], [820, 1180], [390, 844], [844, 390]];

/** Geometry of the 版本 / 在线 pills and whether the lobby scrolls sideways. */
const pills = (c) => c.page.evaluate(() => {
  const v = document.querySelector('.verchip');
  const o = document.querySelector('.hub-online');
  if (!v || !o) return null;
  const rv = v.getBoundingClientRect(), ro = o.getBoundingClientRect();
  const sv = getComputedStyle(v), so = getComputedStyle(o);
  return {
    vh: rv.height, oh: ro.height, vtop: rv.top, otop: ro.top,
    vf: sv.fontSize, of: so.fontSize,
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
  };
});

const settle = (c) => c.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('显示方向: three steps reach <html>, and the 版本 / 在线 pills match from 1920 to a phone (portrait, landscape, coarse)', {
  skip: !enabled, timeout: 3 * 60 * 1000,
}, async () => {
  const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'orientation');
  try {
    await c.open();
    await c.enter('方向验收');
    await c.page.waitForSelector('.verchip', { visible: true });
    const bad = [];
    for (const [w, h] of SCREENS) {
      await c.page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await settle(c);
      const p = await pills(c);
      assert.ok(p, `${w}×${h}: both pills are on screen`);
      if (Math.abs(p.vh - p.oh) > 0.5 || Math.abs(p.vtop - p.otop) > 0.5 || p.vf !== p.of) bad.push({ at: `${w}×${h}`, p });
      if (p.overflow > 1) bad.push({ at: `${w}×${h}`, overflow: p.overflow });
    }
    assert.deepEqual(bad, []);

    // a coarse pointer (the DevTools touch emulation of the screenshots): the same boxes, not the .sp-coarse bump
    await c.page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await c.page.reload({ waitUntil: 'domcontentloaded' });
    await c.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
    await c.page.waitForSelector('.verchip', { visible: true });
    await settle(c);
    const touch = await pills(c);
    assert.ok(await c.page.evaluate(() => document.documentElement.classList.contains('sp-coarse')), 'the page took the coarse branch');
    assert.ok(touch, 'both pills are on screen (touch)');
    assert.ok(Math.abs(touch.vh - touch.oh) <= 0.5, `coarse pills: version ${touch.vh} vs online ${touch.oh}`);
    assert.equal(touch.vf, touch.of, 'coarse pills share the font size');

    // the three steps: 锁定竖屏 is the stored default, then each click rewrites the turn. The row sits far down the
    // scrollable settings list, so the step button is clicked after scrolling it into view.
    await c.click('[data-testid="settings-btn"]');
    await c.page.waitForSelector('[data-testid="orientation"]', { visible: true });
    // the 390×844 window: the turned .app-root is laid out 844 wide and 390 tall (css/orientation.css)
    const branch = () => c.page.evaluate(() => {
      const el = document.documentElement;
      const app = document.querySelector('.app-root');
      const st = app ? getComputedStyle(app) : null;
      return {
        orient: el.dataset.orient, rotate: el.dataset.rotate,
        turnedW: st ? Math.round(parseFloat(st.width)) : 0, turnedH: st ? Math.round(parseFloat(st.height)) : 0,
      };
    });
    const step = (text) => c.page.evaluate((label) => {
      const row = document.querySelector('[data-testid="orientation"]');
      row.scrollIntoView({ block: 'center' });
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      if (!btn) throw new Error(`no step button "${label}"`);
      btn.click();
    }, text);
    assert.deepEqual(await branch(), { orient: 'portrait', rotate: '0', turnedW: 390, turnedH: 844 }, '锁定竖屏 is the upright default');
    await step('锁定横屏');
    await settle(c);
    const wide = await branch();
    assert.deepEqual(wide, { orient: 'landscape', rotate: '1', turnedW: 844, turnedH: 390 }, '锁定横屏 turns the whole page');
    await step('自动适应');
    await settle(c);
    const auto = await branch();
    assert.equal(auto.rotate, '1', 'a 390×844 window turns under 自动适应');
    assert.equal(auto.turnedW, 844, 'the turned box takes the physical height as its width');
    assert.equal(auto.turnedH, 390);
    await step('锁定竖屏');
    await settle(c);
    assert.deepEqual(await branch(), { orient: 'portrait', rotate: '0', turnedW: 390, turnedH: 844 }, '锁定竖屏 turns back');

    // 皮肤工坊: the 归属干员 select and the two TextFields share one box inside .set-workshop (owner screenshot)
    const shop = await c.page.evaluate(() => {
      const row = document.querySelector('[data-testid="skin-workshop"] .set-workshop__row');
      const sel = row?.querySelector('select');
      const boxes = row ? [...row.querySelectorAll('.field__box')] : [];
      if (!sel || !boxes.length) return null;
      const rect = (e) => e.getBoundingClientRect();
      return { select: rect(sel).height, fields: boxes.map((b) => rect(b).height), widths: [rect(sel).width, ...boxes.map((b) => rect(b).width)] };
    });
    assert.ok(shop, 'the workshop row is mounted');
    assert.ok(Math.abs(shop.select - shop.fields[0]) <= 0.5, `select ${shop.select} vs input ${shop.fields[0]}`);
    assert.ok(shop.fields.every((h) => Math.abs(h - shop.select) <= 0.5), 'both inputs match the select');
    assert.ok(shop.widths.every((w) => Math.abs(w - shop.widths[0]) <= 0.5), `the three columns share one width: ${shop.widths.join('/')}`);
    // this worktree has no public/fonts/fonts.css (the upstream font package is not vendored here): that 404 is the
    // environment's, not the page's — every other console / request problem counts
    assert.deepEqual(problemsOf([c]).filter((p) => !/fonts\/fonts\.css/.test(p)), []);
  } finally { await c.close(); await srv.stop(); }
});
