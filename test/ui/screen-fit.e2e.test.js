// Browser check of 设置 →「异形屏适配」 (opt-in, needs Chrome, ~30 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/screen-fit.e2e.test.js
//
// With stored offsets the screens' box (.app-root) is inset by them, the board's host and canvas fill that box, and the
// layout root 1rem is computed from it; the settings section moves an edge live and 重置 returns the page to exactly the
// unmoved one (no <html data-fit>). Static counterpart: test/ui/screen-fit.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('异形屏适配 (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** A page watching for console / page errors, with `sp.pref.screenFit` seeded before the first script runs. */
  async function open(query, viewport, fit = null) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    if (fit) await page.evaluateOnNewDocument((f) => { try { localStorage.setItem('sp.pref.screenFit', JSON.stringify(f)); } catch { /* ignore */ } }, fit);
    await page.goto(`${base}/dev/game-mock.html?shot=1&${query}`, { waitUntil: 'networkidle0', timeout: 60000 });
    return { page, problems };
  }

  const boxes = (page) => page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null;
    };
    return {
      fit: document.documentElement.hasAttribute('data-fit'),
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      app: r('.app-root'),
      field: r('.gm__field'),
      canvas: r('.gm__field canvas'),
    };
  });

  test('stored offsets: the screens, the board and the layout root inside the inset box (844×390 and 1920×1080)', async () => {
    const phone = await open('phase=PREP', { width: 844, height: 390 }, { l: 40, r: 20, t: 30, b: 0 });
    await phone.page.waitForSelector('.gm__field canvas', { timeout: 60000 });
    await sleep(500);
    const p = await boxes(phone.page);
    assert.equal(p.fit, true);
    assert.deepEqual(p.app, [40, 30, 824, 390]);
    assert.deepEqual(p.field, p.app, 'the board\'s host fills the box');
    assert.deepEqual(p.canvas, p.app, 'the canvas is sized from its host');
    assert.equal(p.rem, 40, 'the phone\'s clamp still holds');
    assert.deepEqual(phone.problems, []);
    await phone.page.close();

    const desk = await open('phase=PREP', { width: 1920, height: 1080 }, { l: 100, r: 0, t: 0, b: 0 });
    await desk.page.waitForSelector('.gm__field canvas', { timeout: 60000 });
    await sleep(500);
    const d = await boxes(desk.page);
    assert.deepEqual(d.app, [100, 0, 1920, 1080]);
    assert.ok(Math.abs(d.rem - 1820 / 19.2) < 0.01, `1rem from the box's width: ${d.rem}`);
    assert.deepEqual(desk.problems, []);
    await desk.page.close();
  });

  /** Open the folded section (Feedback #16: it starts closed, so nothing inside it is in the DOM until then). */
  const openSection = async (page) => {
    await page.waitForSelector('[data-testid="screen-fit"]', { timeout: 10000 });
    assert.equal(await page.$eval('[data-testid="fit-toggle"]', (b) => b.getAttribute('aria-expanded')), 'false', 'folded by default');
    await page.click('[data-testid="fit-toggle"]');
  };

  test('the settings section: folded, + moves an edge live, 重置 returns the unmoved page', async () => {
    // the earlier pages stored offsets in this browser: start from none
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0 });
    await openSection(page);
    const vals = () => page.$$eval('.set-fit__row .set-row__val', (els) => els.map((e) => e.textContent));
    assert.deepEqual(await vals(), ['0', '0', '0', '0', '100%'], 'the four edges as ±N px, then 界面大小');
    assert.equal(await page.$eval('[data-testid="fit-toggle"]', (b) => !b.textContent.includes('已调整')), true, 'nothing adjusted: no 已调整 badge');
    assert.equal(await page.$eval('[data-testid="fit-reset"]', () => null), null, 'nothing adjusted: no 重置 in the head');
    // 顶部 +1 step = 2 px in
    await page.evaluate(() => document.querySelectorAll('.set-fit__row')[2].querySelectorAll('.set-fit__step')[1].click());
    await sleep(200);
    let b = await boxes(page);
    assert.deepEqual([b.fit, b.app?.[1]], [true, 2]);
    assert.deepEqual(await vals(), ['0', '0', '+2 px', '0', '100%']);
    assert.equal(await page.$eval('[data-testid="fit-badge"]', (e) => e.textContent), '已调整', 'the head shows 已调整 once an edge moves');
    assert.equal(await page.$eval('[data-testid="fit-reset"]', (e) => !!e), true, 'and offers 重置');
    await page.click('[data-testid="fit-reset"]');
    await sleep(200);
    b = await boxes(page);
    assert.deepEqual([b.fit, b.app], [false, [0, 0, 1280, 720]]);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.screenFit'))), { l: 0, r: 0, t: 0, b: 0, ui: 100 });
    assert.deepEqual(problems, []);
    await page.close();
  });

  /** The layout root, the text root --t in px, the ready button's height and --sp-ui on <html>. */
  const sizes = (page) => page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.fontSize = 'var(--t)';
    document.body.append(probe);
    const t = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    const ready = document.querySelector('.readybtn')?.getBoundingClientRect();
    return { rem: parseFloat(getComputedStyle(document.documentElement).fontSize), t, ready: ready ? Math.round(ready.height) : null,
      k: document.documentElement.style.getPropertyValue('--sp-ui') };
  });

  test('界面大小: a stored 70 % shrinks the layout root and 小\'s text with it and keeps the 32 px touch floor; 中 keeps its 64 px floor scaled by the same factor; the board fills its host', async () => {
    const phone = await open('phase=PREP', { width: 844, height: 390, hasTouch: true, isMobile: true }, { l: 0, r: 0, t: 0, b: 0, ui: 70 });
    await phone.page.waitForSelector('.gm__field canvas', { timeout: 60000 });
    await sleep(500);
    const p = await sizes(phone.page);
    assert.equal(p.k, '0.7');
    assert.equal(p.rem, 28, 'the 40 px clamp × 0.7');
    assert.equal(p.t, 28, '小\'s text root follows the layout');
    assert.ok(p.ready >= 32, `the ready button keeps a 32 px touch target (${p.ready})`);
    await phone.page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ textSize: 'md' }));
    await sleep(200);
    const md = await sizes(phone.page);
    assert.equal(md.k, '0.7', 'the size applies at every 文字大小 step here, since the text floors carry the factor');
    assert.equal(md.rem, 28, 'the design root × the factor');
    assert.ok(Math.abs(md.t - 44.8) < 0.01, `中 keeps its 64 px floor scaled by the factor (${md.t})`);
    await phone.page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ textSize: 'sm' }));
    await sleep(200);
    assert.equal((await sizes(phone.page)).k, '0.7', 'the same factor at 小');
    const b = await boxes(phone.page);
    assert.deepEqual(b.field, b.app, 'the board\'s host fills the screen box');
    assert.deepEqual(b.canvas, b.app);
    assert.deepEqual(phone.problems, []);
    await phone.page.close();
  });

  // DESIGN §35.47: on a short phone 选择同盟方式's and 选择模拟协议's right column and the protocol brief keep their unscaled
  // widths (÷ --sp-ui) — the names' 16 px and the brief's 11 px floors and the px paddings do not shrink, and at 75 % a
  // 222 px column cut the English difficulty names ('Perilous Simulation…') and the brief broke a Korean word
  for (const lang of ['en', 'ko']) {
    test(`界面大小 70 % on a 640×360 phone (${lang}): 选择同盟方式 and 选择模拟协议 keep their columns; no difficulty name is cut`, async () => {
      const ctx = await browser.createBrowserContext(); // its own storage: a fresh player, not the other language's room
      const page = await ctx.newPage();
      await page.setViewport({ width: 640, height: 360, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      await page.evaluateOnNewDocument((l) => {
        localStorage.setItem('sp.name', '界面测试'); sessionStorage.setItem('sp.entered', '1');
        localStorage.setItem('sp.pref.lang', JSON.stringify(l));
        localStorage.setItem('sp.pref.screenFit', JSON.stringify({ l: 0, r: 0, t: 0, b: 0, ui: 70 }));
      }, lang);
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen .hub-entries'), { timeout: 30000 });
      const track = (sel) => page.$eval(sel, (el) => parseFloat(getComputedStyle(el).gridTemplateColumns.split(' ').pop()));
      await page.click('.mode-card[data-mode="coop"]');
      await page.waitForSelector('.modal__box.ally .ally-body', { visible: true });
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sp-ui')), '0.7');
      assert.ok(Math.abs(await track('.modal__box.ally .ally-body') - 296) < 1, '选择同盟方式: 7.4 × the unscaled 40 px root');
      await page.click('[data-testid="alliance-create"]');
      await page.waitForSelector('.room-screen', { timeout: 15000 });
      await page.click('.rs-pill__diff');
      await page.waitForSelector('.modal__box.proto .pcard__name', { visible: true });
      await page.evaluate(() => document.fonts.ready);
      await sleep(600);
      assert.ok(Math.abs(await track('.modal__box.proto .proto-body') - 296) < 1, '选择模拟协议: the same column');
      assert.equal(await page.$eval('.modal__box.proto .proto-brief', (el) => getComputedStyle(el).maxWidth), 'min(256px, 100%)', 'the brief: 6.4 × 40 px');
      const cut = await page.$$eval('.modal__box.proto .pcard:not(.is-on) .pcard__name', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      assert.deepEqual(cut, [], 'no unselected difficulty name ends in an ellipsis');
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  test('界面大小: − steps 10 % live (--sp-ui on <html>), 重置 returns the design size with no property', async () => {
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0 });
    await openSection(page);
    await page.waitForSelector('[data-testid="ui-size"]', { timeout: 10000 });
    const before = await sizes(page);
    assert.equal(before.k, '');
    assert.ok(Math.abs(before.rem - 1280 / 19.2) < 0.01);
    assert.equal(await page.$eval('[data-testid="ui-size"] .set-fit__step:last-of-type', (b) => b.disabled), false, '+ is open at 100 %: this repo\'s 界面大小 list runs to 120 %');
    await page.evaluate(() => document.querySelector('[data-testid="ui-size"] .set-fit__step').click());
    await sleep(200);
    const less = await sizes(page);
    assert.equal(less.k, '0.9');
    assert.ok(Math.abs(less.rem - (1280 / 19.2) * 0.9) < 0.01, `the root follows (${less.rem})`);
    assert.equal(await page.$eval('[data-testid="ui-size-pct"]', (e) => e.textContent), '90%');
    await page.click('.set-fit__reset');
    await sleep(200);
    const back = await sizes(page);
    assert.equal(back.k, '');
    assert.ok(Math.abs(back.rem - 1280 / 19.2) < 0.01);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('界面大小 applies at every 文字大小 step: no text step disables the row, and a drag shows the reading and applies on release', async () => {
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0, ui: 80 });
    await openSection(page);
    await page.waitForSelector('[data-testid="ui-size"]', { timeout: 10000 });
    assert.equal((await sizes(page)).k, '0.8');
    await page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ textSize: 'md' }));
    await sleep(200);
    const row = () => page.evaluate(() => ({
      range: document.querySelector('[data-testid="ui-size-range"]').disabled,
      steps: [...document.querySelectorAll('[data-testid="ui-size"] .set-fit__step')].map((b) => b.disabled),
      pct: document.querySelector('[data-testid="ui-size-pct"]').textContent,
      k: document.documentElement.style.getPropertyValue('--sp-ui'),
    }));
    assert.deepEqual(await row(), { range: false, steps: [false, false], pct: '80%', k: '0.8' },
      'no text step turns the size off here: the text floors carry the factor too');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.screenFit')).ui), 80, 'the stored size is kept');
    // a drag: `input` moves the reading only, `change` (the release) applies it
    await page.evaluate(() => {
      const r = document.querySelector('[data-testid="ui-size-range"]');
      r.value = '70';
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(150);
    assert.deepEqual([(await row()).pct, (await row()).k], ['70%', '0.8'], 'while dragging the interface keeps its size');
    await page.evaluate(() => document.querySelector('[data-testid="ui-size-range"]').dispatchEvent(new Event('change', { bubbles: true })));
    await sleep(200);
    assert.deepEqual([(await row()).pct, (await row()).k], ['70%', '0.7']);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('界面大小: a real drag that ends where it began leaves no stale reading (Chrome fires no change); − and 重置 show the new size', async () => {
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0, ui: 80 });
    await openSection(page);
    await page.waitForSelector('[data-testid="ui-size-range"]', { timeout: 10000 });
    const row = () => page.evaluate(() => ({
      pct: document.querySelector('[data-testid="ui-size-pct"]').textContent,
      value: document.querySelector('[data-testid="ui-size-range"]').value,
      k: document.documentElement.style.getPropertyValue('--sp-ui'),
    }));
    // the range's box, measured again after each size change (the whole interface scales with it)
    let box;
    const measure = async () => {
      box = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="ui-size-range"]');
        r.scrollIntoView({ block: 'center' });
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top + b.height / 2, w: b.width };
      });
    };
    await measure();
    const xAt = (v) => box.x + ((v - 70) / 50) * box.w;
    await page.mouse.move(xAt(80), box.y);
    await page.mouse.down();
    for (const v of [70, 80, 90, 80]) { await page.mouse.move(xAt(v), box.y, { steps: 3 }); await sleep(30); }
    await page.mouse.up();
    await sleep(200);
    assert.deepEqual(await row(), { pct: '80%', value: '80', k: '0.8' });
    await page.evaluate(() => document.querySelector('[data-testid="ui-size"] .set-fit__step').click());
    await sleep(200);
    assert.deepEqual(await row(), { pct: '70%', value: '70', k: '0.7' }, '− moves the reading with the size');
    // a drag to another value applies on release
    await measure();
    await page.mouse.move(xAt(70), box.y);
    await page.mouse.down();
    await page.mouse.move(xAt(90), box.y, { steps: 5 });
    await page.mouse.up();
    await sleep(200);
    assert.deepEqual(await row(), { pct: '90%', value: '90', k: '0.9' });
    await page.click('.set-fit__reset');
    await sleep(200);
    assert.deepEqual(await row(), { pct: '100%', value: '100', k: '' }, '重置 shows 100 %');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('界面大小: each way out of a drag — pointerup alone applies, pointercancel and blur drop the reading, a size changed elsewhere replaces it', async () => {
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0, ui: 80 });
    await openSection(page);
    await page.waitForSelector('[data-testid="ui-size-range"]', { timeout: 10000 });
    const row = () => page.evaluate(() => ({
      pct: document.querySelector('[data-testid="ui-size-pct"]').textContent,
      k: document.documentElement.style.getPropertyValue('--sp-ui'),
      stored: JSON.parse(localStorage.getItem('sp.pref.screenFit') || 'null')?.ui ?? null,
    }));
    /** A drag's reading: the range's value plus `input`, with no release. */
    const drag = (v) => page.evaluate((val) => {
      const r = document.querySelector('[data-testid="ui-size-range"]');
      r.value = String(val);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const fire = (type) => page.evaluate((ty) => {
      document.querySelector('[data-testid="ui-size-range"]').dispatchEvent(new PointerEvent(ty, { bubbles: true, pointerId: 1 }));
    }, type);
    // pointerup with no `change` (Chrome's drag that ends on its start value, then moved by script) applies the reading
    await drag(90);
    await sleep(150);
    assert.deepEqual(await row(), { pct: '90%', k: '0.8', stored: 80 }, 'the reading moves, the size does not');
    await fire('pointerup');
    await sleep(200);
    assert.deepEqual(await row(), { pct: '90%', k: '0.9', stored: 90 }, 'pointerup applies it');
    // a touch drag turned into a scroll: pointercancel, no pointerup / change — the row goes back to the stored size
    await drag(70);
    await sleep(150);
    assert.equal((await row()).pct, '70%');
    await fire('pointercancel');
    await sleep(200);
    assert.deepEqual(await row(), { pct: '90%', k: '0.9', stored: 90 }, 'pointercancel drops the reading');
    // focus leaves the range mid-drag (no pointerup / change): blur drops the reading too
    await drag(80);
    await sleep(150);
    assert.equal((await row()).pct, '80%');
    await page.evaluate(() => document.querySelector('[data-testid="ui-size-range"]').dispatchEvent(new FocusEvent('blur')));
    await sleep(200);
    assert.deepEqual(await row(), { pct: '90%', k: '0.9', stored: 90 }, 'blur drops the reading');
    // a reading left behind (no release event at all) yields to a size stored by anything else
    await drag(80);
    await sleep(150);
    assert.equal((await row()).pct, '80%');
    await page.evaluate(async () => (await import('/js/ui/screenFit.js')).updateFit({ ui: 120 }));
    await sleep(200);
    assert.deepEqual(await row(), { pct: '120%', k: '1.2', stored: 120 }, 'the row follows the stored size, not the stale reading');
    // a plain click on the thumb (pointerup on the stored value) stores nothing
    await page.evaluate(() => localStorage.removeItem('sp.pref.screenFit'));
    await fire('pointerup');
    await sleep(200);
    assert.deepEqual(await row(), { pct: '120%', k: '1.2', stored: null }, 'an unchanged value is not saved again');
    assert.deepEqual(problems, []);
    await page.close();
  });
});
