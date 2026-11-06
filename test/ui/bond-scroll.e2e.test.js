import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, hasChrome } from '../e2e/client.mjs';
test('all bonds remain reachable by arrows, keyboard and native scrolling', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    for (const [width, height, touch] of [[1920, 1080, false], [844, 390, true]]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.evaluateOnNewDocument(() => {
        globalThis.__bondResizeErrors = [];
        // Native observer delivery errors reach window.error, rather than Puppeteer's pageerror event.
        addEventListener('error', e => { if (e.message.includes('ResizeObserver')) globalThis.__bondResizeErrors.push(e.message); });
      });
      await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
      await page.goto(srv.url + '/dev/game-mock.html?shot=1&render=fallback&phase=PREP');
      await page.waitForSelector('.bstrip .bond');
      const count = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const mock = globalThis.__MOCK__, state = mock.store.get();
        const bonds = data.list('bonds').map((b, i) => ({ bondId: b.bondId, count: 1, tier: 0, active: false, layers: i }));
        mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
        return bonds.length;
      });
      await page.waitForFunction(n => document.querySelectorAll('.bslot').length === n, {}, count);
      const bounds = await page.$eval('.bstrip', el => ({ width: el.clientWidth, all: el.scrollWidth }));
      assert.ok(bounds.all > bounds.width);
      // The arrows are drawn only for a tape wider than its band, one frame after the resize is measured.
      await page.waitForSelector('.bstrip-scroll__arrow:last-child');
      await page.click('.bstrip-scroll__arrow:last-child');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      await page.$eval('.bstrip', el => { el.scrollLeft = el.scrollWidth; });
      await page.waitForFunction(() => document.querySelector('.bstrip-scroll__arrow:last-child').disabled);
      const last = '.bslot:last-child .bond';
      await page.click(last); await page.waitForSelector('.bpop');
      await page.click('.bpop__close');
      // Reset native scroll separately; only ArrowRight below is a keyboard assertion.
      await page.$eval('.bstrip', el => { el.scrollLeft = 0; });
      await page.waitForFunction(() => document.querySelector('.bstrip-scroll__arrow:first-child').disabled);
      await page.focus('.bstrip');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      await page.click('.bonds-toggle');
      assert.equal(await page.$eval('.gm__bond-list', el => el.hidden), true);
      const frozen = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const { render } = await import('/vendor/preact.module.js');
        const { html } = await import('/js/ui/components.js');
        const { BondStrip } = await import('/js/ui/bondStrip.js');
        const host = document.createElement('div'); host.id = 'frozen-bonds';
        host.className = 'gm__bonds'; host.style.width = '300px'; document.body.appendChild(host);
        const bonds = data.list('bonds').map(b => ({ bondId: b.bondId, count: 1, tier: 0, layers: 0 }));
        const NativeObserver = globalThis.ResizeObserver;
        let created = 0, disconnected = 0;
        globalThis.ResizeObserver = class extends NativeObserver {
          constructor(callback) { super(callback); created++; }
          disconnect() { disconnected++; super.disconnect(); }
        };
        try {
          const draw = async entries => {
            render(html`<div class="gm__bond-list"><${BondStrip} bonds=${entries} layersDisabled=${true} onOpen=${() => {}} /></div>`, host);
            await new Promise(r => setTimeout(r, 100));
          };
          await draw(bonds);
          const initial = created;
          await draw(bonds.map(b => ({ ...b, layers: b.layers + 1 })));
          const afterUpdate = { created, disconnected };
          const strip = host.querySelector('.bstrip');
          // The band is centred (align-items:center), so a fixed-width host no longer bounds the strip — the clamp the
          // layout really applies is the viewport one on .gm__bond-list. Assert that clamp: the point of this block is
          // that a bounded, scrollable strip disconnects its observer.
          const clamp = window.innerWidth - 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
          const result = { all: strip.querySelectorAll('.bslot').length, width: strip.clientWidth, scroll: strip.scrollWidth, clamp,
            initial, afterUpdate };
          render(null, host);
          const afterUnmount = disconnected;
          // A strip that fits its container gets no arrows at all: a disabled arrow still takes its 44 px and reads as
          // a control the user can press (user report 2026-11-05).
          render(html`<div class="gm__bond-list"><${BondStrip} bonds=${bonds.slice(0, 2)} layersDisabled=${true} onOpen=${() => {}} /></div>`, host);
          await new Promise(r => setTimeout(r, 100));
          const fitStrip = host.querySelector('.bstrip');
          // The room the tape may occupy: the same limit the scroller measures (the list's max-width, the band's
          // width). A few px of overflow can come from inside the discs themselves, so compare with the room, not
          // with the tape's own box.
          const fitRoom = Math.min(clamp, host.clientWidth);
          const fit = { arrows: host.querySelectorAll('.bstrip-scroll__arrow').length, content: fitStrip.scrollWidth, room: fitRoom };
          return { ...result, afterUnmount, fit };
        } finally {
          globalThis.ResizeObserver = NativeObserver;
          render(null, host); host.remove();
        }
      });
      assert.equal(frozen.all, count); assert.ok(frozen.width <= frozen.clamp && frozen.scroll > frozen.width);
      assert.ok(frozen.fit.content <= frozen.fit.room && frozen.fit.arrows === 0, 'a strip that fits its container shows no arrows at all');
      assert.equal(frozen.initial, 1);
      assert.deepEqual(frozen.afterUpdate, { created: 1, disconnected: 0 }, 'layer updates reuse the observer');
      assert.equal(frozen.afterUnmount, 1, 'unmount disconnects the observer');
      assert.deepEqual(await page.evaluate(() => globalThis.__bondResizeErrors), [], 'resizing the strip must not loop during observer delivery');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await srv.close(); }
});
