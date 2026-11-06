// 设置 →「异形屏适配」→「界面大小」 (ui/screenFit.js, DESIGN §35.43; reworked from PR #838 by @zasx77771): one manual
// factor --sp-ui on <html>, default 100 %, no automatic shrink. What this file guards: the stored percentage (70–120 in
// 10 % steps, 100 when missing or invalid) next to the edge offsets; --sp-ui only while it is not 100 % (at 100 % the
// page is exactly the design); the layout root and the 异形屏适配 root multiplied by it; the 文字大小 floors of 中 / 大 /
// 特大 (64 / 76 / 88 px) carrying the factor at every step, as they have in this repo, while 小 (1rem, no floor) follows
// the layout; and
// the stylesheet guard: every max(<rem>, <N>px) floor in public/css carries the factor — a size floor (width, height,
// min-*, flex, grid tracks, custom properties) above 32 px as max(<rem>, 32px, calc(Npx * var(--sp-ui, 1))), so a touch
// target ≥ 32 px stays ≥ 32 px, one of 32 px or less stays bare px (it never shrinks), and a value that mirrors a size
// floor copies it exactly — or is a listed exemption (line-height, letter-spacing, and the text floors font-size / --t,
// which carry the factor in this repo and are checked for the form below).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const F = await import('../../public/js/ui/screenFit.js');
const css = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the stored size', () => {
  test('sanitizeFit: ui is a percentage 70–120 snapped to 10 %, 100 when missing or invalid; the edges as before', () => {
    assert.deepEqual(F.sanitizeFit(null), { l: 0, r: 0, t: 0, b: 0, ui: 100 });
    assert.equal(F.sanitizeFit({ ui: 90 }).ui, 90);
    assert.equal(F.sanitizeFit({ ui: 83 }).ui, 80);
    assert.equal(F.sanitizeFit({ ui: 40 }).ui, 70);
    assert.equal(F.sanitizeFit({ ui: 150 }).ui, 120, "120 % is the top of this repo's 界面大小 list (its steps ran 70–120)");
    assert.equal(F.sanitizeFit({ ui: 'x' }).ui, 100);
    assert.equal(F.sanitizeFit({ l: 4 }).ui, 100, 'a value stored before 0.3.2 reads as 100 %');
    assert.deepEqual([F.UI_MIN, F.UI_MAX, F.UI_STEP], [70, 120, 10]);
  });
});

describe('applyFit on <html>', () => {
  function withRoot(fn) {
    const g = globalThis;
    const saved = { document: g.document, dispatchEvent: g.dispatchEvent };
    const props = new Map();
    const el = { dataset: {}, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
    let resized = 0;
    g.document = { documentElement: el };
    g.dispatchEvent = (e) => { if (e?.type === 'resize') resized++; return true; };
    try { fn(el, props, () => resized); } finally { g.document = saved.document; g.dispatchEvent = saved.dispatchEvent; }
  }
  test('a size under 100 %: --sp-ui alone (no data-fit while no edge moved), then one resize for the board and the HUD', () => {
    withRoot((el, props, resized) => {
      F.applyFit({ l: 0, r: 0, t: 0, b: 0, ui: 80 });
      assert.ok(!('fit' in el.dataset));
      assert.deepEqual(Object.fromEntries(props), { '--sp-ui': '0.8' });
      assert.equal(resized(), 1);
    });
  });
  test('100 %: no property at all — the page is exactly the design; the edges keep working beside the size, and 110 % enlarges it', () => {
    withRoot((el, props) => {
      F.applyFit({ l: 0, r: 0, t: 0, b: 0, ui: 70 });
      F.applyFit({ l: 0, r: 0, t: 0, b: 0, ui: 100 });
      assert.equal(props.size, 0);
      F.applyFit({ l: 6, r: 0, t: 0, b: 0, ui: 110 });
      assert.ok('fit' in el.dataset);
      assert.equal(props.get('--sp-ui'), '1.1');
      assert.equal(props.get('--fit-l'), '6px');
    });
  });
});

describe('the size applies at every 文字大小 step', () => {
  test('effectiveUi takes only the stored size: no text step turns it off, because the text floors carry the factor here', () => {
    assert.equal(F.effectiveUi(80), 80);
    assert.equal(F.effectiveUi(83), 80, 'sanitized');
    assert.equal(F.effectiveUi(120), 120, "this repo's top step");
    assert.equal(F.effectiveUi('x'), 100);
  });
  test('applyFit writes --sp-ui whatever 文字大小 is (the settings modal no longer reads textSize)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/ui/screenFit.js'), 'utf8');
    assert.ok(!/textSize|settingsStore/.test(src), 'the size must not depend on the text step');
  });
});

describe('the stylesheet side', () => {
  test('theme.css / devices.css: both layout roots multiply the design rule by --sp-ui (100vh and 100svh lines)', () => {
    const theme = css('public/css/theme.css');
    const html = theme.slice(theme.indexOf('\nhtml {'), theme.indexOf('}', theme.indexOf('\nhtml {')));
    const roots = html.match(/font-size:[^;]+;/g);
    assert.equal(roots.length, 2);
    for (const r of roots) assert.match(r, /^font-size: calc\(clamp\(40px, .*, 240px\) \* var\(--sp-ui, 1\)\);$/);
    const dev = css('public/css/devices.css');
    const fit = dev.slice(dev.indexOf('html[data-fit] {'), dev.indexOf('}', dev.indexOf('html[data-fit] {')));
    const fitRoots = fit.match(/font-size:[^;]+;/g);
    assert.equal(fitRoots.length, 2);
    for (const r of fitRoots) assert.match(r, /\* var\(--sp-ui, 1\)\);$/);
  });
  test('theme.css: the 文字大小 floors carry the factor at every step; 小 has none and follows the layout', () => {
    const theme = css('public/css/theme.css');
    assert.match(theme, /:root \{ --t: 1rem; \}/, '小: the design\'s own sizes, following 界面大小 (no clipped label at 70 %)');
    for (const [k, n, mul] of [['md', 64, ''], ['lg', 76, 'calc\\(1rem \\* 1\\.15\\)'], ['xl', 88, 'calc\\(1rem \\* 1\\.3\\)']]) {
      const one = mul || '1rem';
      // the px floor scales with the factor, as it has in this repo since the factor existed
      assert.match(theme, new RegExp(`:root\\[data-text="${k}"\\] \\{ --t: max\\(${one}, calc\\(${n}px \\* var\\(--sp-ui, 1\\)\\)\\); \\}`));
    }
  });

  // ---- the guard ----------------------------------------------------------------------------------------------------
  const EXEMPT = new Set(['font-size', 'line-height', 'letter-spacing', '--t']);
  const SIZE = new Set(['width', 'height', 'min-width', 'min-height', 'flex', 'flex-basis', 'grid-template-columns', 'grid-template-rows',
    'grid-auto-rows', 'grid-auto-columns', 'inline-size', 'block-size', 'min-inline-size', 'min-block-size']);
  // Listed exemptions beyond the readability properties. Add `file:property:argument` with a reason.
  const LISTED = new Set([
    // --utility-text is the utility dialogs' own text-size variable (the fork's css/utility-mobile.css): it carries the
    // factor through --t, and its own 64 px floor is the fork's value (it holds there at every size).
    'public/css/utility-mobile.css:--utility-text:64px',
    // a font shorthand whose only value is the size of a 9 px monospace label: readability, same as font-size
    'public/css/screens/lobby.css:font:9px',
  ]);
  function* cssFiles(dir) {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) yield* cssFiles(p); else if (f.endsWith('.css')) yield p;
    }
  }
  const closeOf = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === '(') d++; else if (s[j] === ')' && --d === 0) return j + 1; } return -1; };
  const argsOf = (inner) => {
    const out = []; let d = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') d++; else if (inner[i] === ')') d--;
      else if (inner[i] === ',' && d === 0) { out.push(inner.slice(start, i).trim()); start = i + 1; }
    }
    out.push(inner.slice(start).trim());
    return out;
  };
  /** Every max() with a rem / --t argument and a px length: { file, line, prop, args }. */
  function floors() {
    const out = [];
    for (const file of cssFiles(path.join(ROOT, 'public/css'))) {
      const raw = readFileSync(file, 'utf8');
      const s = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
      for (const m of s.matchAll(/\bmax\(/g)) {
        const open = m.index + 3, close = closeOf(s, open);
        const args = argsOf(s.slice(open + 1, close - 1));
        if (!args.some((a) => /rem|var\(--t\b|\dem\b/.test(a))) continue;
        if (!args.some((a) => /(^|[^\w.-])[1-9][\d.]*px|0?\.\d*[1-9]\d*px/.test(a))) continue;
        const k = Math.max(s.lastIndexOf(';', m.index), s.lastIndexOf('{', m.index));
        const prop = s.slice(k + 1, m.index).split(':')[0].trim();
        out.push({ file: path.relative(ROOT, file), line: s.slice(0, m.index).split('\n').length, prop, args });
      }
    }
    return out;
  }
  const isSize = (prop) => SIZE.has(prop) || prop.startsWith('--');
  const SCALED = /^calc\((\d*\.?\d+)px \* var\(--sp-ui, 1\)\)$/;
  const remArg = (args) => args.find((a) => /rem|var\(--t\b|\dem\b/.test(a));
  /** `file|rem|N` and `rem|N` of every scaled size floor N > 32 px (which keeps 32 px): another property repeating it mirrors that size. */
  function sizeSignatures(all) {
    const out = new Set();
    for (const f of all) {
      if (!isSize(f.prop) || EXEMPT.has(f.prop)) continue;
      for (const a of f.args) {
        const m = SCALED.exec(a);
        if (m && Number(m[1]) > 32) { out.add(`${f.file}|${remArg(f.args)}|${Number(m[1])}`); out.add(`${remArg(f.args)}|${Number(m[1])}`); }
      }
    }
    return out;
  }
  test('guard: every max(<rem>, <N>px) floor in public/css carries --sp-ui or is a listed exemption', () => {
    const all = floors();
    assert.ok(all.length > 400, `the scan finds the floors (${all.length})`);
    const sigs = sizeSignatures(all);
    const bad = [];
    for (const f of all) {
      if (EXEMPT.has(f.prop)) continue;
      for (const a of f.args) {
        if (/rem|var\(--t\b|--sp-ui/.test(a) || !/[1-9][\d.]*px/.test(a)) continue;
        const bare = /^(\d*\.?\d+)px$/.exec(a);
        // a size floor of 32 px or less never shrinks: it stays bare px (the touch minimum, checked below for larger ones)
        if (bare && isSize(f.prop) && Number(bare[1]) <= 32) continue;
        // a non-size value mirroring a scaled size floor (any file: the 交流 width is emotes.css's) copies it exactly,
        // its 32 px included (same-file mirrors are enforced below)
        if (a === '32px' && !isSize(f.prop) && f.args.some((b) => {
          const m = SCALED.exec(b); return m && sigs.has(`${remArg(f.args)}|${Number(m[1])}`);
        })) continue;
        if (LISTED.has(`${f.file.replace(/\\/g, '/')}:${f.prop}:${a}`)) continue;
        bad.push(`${f.file}:${f.line} ${f.prop}: max(${f.args.join(', ')})`);
      }
    }
    assert.deepEqual(bad, [], 'scale the px floor by var(--sp-ui, 1), or list the exemption with its reason');
  });
  test('guard: a size floor above 32 px scales and keeps 32 px unscaled — touch targets ≥ 32 px stay ≥ 32 px; one of 32 px or less stays bare px', () => {
    const bad = [];
    for (const f of floors()) {
      if (!isSize(f.prop) || EXEMPT.has(f.prop)) continue;
      for (const a of f.args) {
        const m = SCALED.exec(a);
        if (!m) continue;
        if (Number(m[1]) <= 32) bad.push(`${f.file}:${f.line} ${f.prop}: max(${f.args.join(', ')}) — ${m[1]}px never shrinks: write it bare`);
        else if (!f.args.includes('32px')) bad.push(`${f.file}:${f.line} ${f.prop}: max(${f.args.join(', ')}) lacks 32px`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test('guard: a value mirroring a scaled size floor of its file (same rem, same N) copies it exactly, 32 px included', () => {
    // devices.css's narrow-touch .dpanel bottom mirrors the 交流 / ⚙ heights, sweep.css's header band the header: without
    // the 32 px the card ended 6.5 px below the ⚙ row at 75 % (the merge review of 2026-10-23)
    const all = floors();
    const sigs = sizeSignatures(all);
    const bad = [];
    for (const f of all) {
      if (isSize(f.prop) || EXEMPT.has(f.prop)) continue;
      for (const a of f.args) {
        const m = SCALED.exec(a);
        if (m && sigs.has(`${f.file}|${remArg(f.args)}|${Number(m[1])}`) && !f.args.includes('32px')) bad.push(`${f.file}:${f.line} ${f.prop}: max(${f.args.join(', ')})`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test('guard: a text floor (font-size, --t) that carries the factor writes it as calc(Npx * var(--sp-ui, 1)) — this repo scales the text floors too', () => {
    const bad = floors().filter((f) => (f.prop === 'font-size' || f.prop === '--t') &&
      f.args.some((a) => /var\(--sp-ui/.test(a) && !SCALED.test(a)));
    assert.deepEqual(bad.map((f) => `${f.file}:${f.line}`), []);
  });
});
