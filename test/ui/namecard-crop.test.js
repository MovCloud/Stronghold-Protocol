// test/ui/namecard-crop.test.js — 立绘截取 (the owner's decision of 2026-11-08): the anchor of the band a 名片底图 plate
// shows. The plate is a wide band, so a portrait illustration is always scaled width-fit and the horizontal framing is
// fixed: the only thing the player can choose is the vertical anchor, and NameCardCrop is the window that chooses it
// (pointer drag or the arrow keys). The anchor travels with the card (room.card bgShift) so teammates see the same crop;
// the default 24 — the anchor the layer had before the window existed — is never sent, so an unadjusted card keeps the
// room.state shape it had. (The wire check: test/lobby-card.test.js; the seat cards: test/ui/room-cards.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BG_SHIFT_DEFAULT, BG_SHIFT_MAX, isCardShift } from '../../shared/playerCard.js';
import { cardMessage, seatCardMatches } from '../../public/js/ui/playerCard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('the anchor: an integer percent 0–100, the default 24 (the anchor the layer had before the window existed)', () => {
  assert.equal(BG_SHIFT_DEFAULT, 24);
  assert.equal(BG_SHIFT_MAX, 100);
  for (const v of [0, 24, 100, 61]) assert.ok(isCardShift(v), String(v));
  for (const v of [101, -1, 24.5, '24', null, undefined, NaN]) assert.ok(!isCardShift(v), String(v));
});

test('an unadjusted card sends nothing so room.state stays as it was; an adjusted one sends the anchor', () => {
  const base = { charId: 'char_498_inside', avatar: '', bg: 'camp:rhodes', trophies: 0, look: '', avatarLook: '' };
  assert.ok(!('bgShift' in cardMessage({ ...base })), 'the default is not on the wire');
  assert.equal(cardMessage({ ...base, bgShift: 61 }).bgShift, 61);
  assert.ok(!('bgShift' in cardMessage({ ...base, bgShift: '24' })), 'junk falls back to the default');
  assert.ok(seatCardMatches({ ...base }, cardMessage({ ...base })), 'the default matches a seat card without the key');
  assert.ok(!seatCardMatches({ ...base, bgShift: 61 }, cardMessage({ ...base })), 'a seat with another crop is not already the same');
  assert.ok(seatCardMatches({ ...base, bgShift: 61 }, cardMessage({ ...base, bgShift: 61 })));
});

test('the layer writes the anchor as --nc-y, the CSS keeps 24% as the fallback', () => {
  assert.match(read('public/js/ui/namecards.js'), /; --nc-y:\$\{p\}%/);
  const rule = read('public/css/screens/lobby.css').match(/\.nc-layer--skin \{[^}]*\}/);
  assert.ok(rule, 'the skin layer has its own rule');
  assert.match(rule[0], /var\(--nc-y, 24%\) \/ cover/, 'the anchor falls back to the pre-window value');
});

test('the crop window: horizontal fixed, only vertical, the plate shape, the plate itself below', () => {
  const src = read('public/js/ui/namecards.js');
  const css = read('public/css/screens/lobby.css');
  assert.match(src, /role="slider"[\s\S]{0,200}aria-valuemin="0" aria-valuemax="100" aria-valuenow=\$\{p\} style=\$\{`top:\$\{p\}%`\}/,
    'a slider that only reports a vertical position');
  assert.match(src, /onPointerDown=\$\{\(e\) => \{ e\.currentTarget\.setPointerCapture\?\.\(e\.pointerId\); setDrag\(true\); move\(e\.clientY\); \}\}/);
  assert.match(src, /if \(drag\) move\(e\.clientY\)/, 'only the Y coordinate moves the window');
  assert.match(src, /const step = e\.shiftKey \? 5 : 1/, 'the arrow keys step 1, Shift 5');
  assert.match(src, /data-testid="namecard-crop-confirm"/);
  const win = css.match(/\.nc-crop__win \{[^}]*\}/);
  assert.ok(win, 'the crop window has its own rule');
  assert.match(win[0], /left: 0; right: 0;/, 'it spans the picture horizontally: nothing to move sideways');
  assert.match(win[0], /aspect-ratio: 600 \/ 186/, 'the shape of the plate it plans');
  assert.match(win[0], /transform: translateY\(-50%\)/, 'the anchor is the centre of the window');
  assert.match(win[0], /touch-action: none/, 'the drag does not scroll the page');
  const stage = css.match(/\.nc-crop__stage \{[^}]*\}/);
  assert.ok(stage, 'the stage is the picture box the drag is measured on');
  assert.match(stage[0], /position: relative/);
  const result = css.match(/\.nc-crop__result \{[^}]*\}/);
  assert.ok(result, 'the plate preview has its own rule');
  assert.match(result[0], /aspect-ratio: 600 \/ 186/);
});

test('the lobby opens the window after a 立绘 pick and 保存 writes the anchor back', () => {
  const src = read('public/js/screens/lobby.js');
  assert.match(src, /const \[cropping, setCropping\] = useState\(false\)/);
  assert.match(src, /if \(namecardOf\(id\)\?\.kind === 'skin'\) setCropping\(true\)/, 'only a 立绘 card can be cropped');
  assert.match(src, /onApply=\$\{\(p\) => \{ pick\(\{ bgShift: p \}\); setCropping\(false\); \}\}/);
  assert.match(src, /setCardShift\(draft\.bgShift\)/, '保存 writes the anchor to the store the seat card reads');
  assert.match(src, /<\$\{NameCardLayer\} card=\$\{draft\.bg\} shift=\$\{draft\.bgShift\}/);
  assert.match(src, /nc \? t\(nc\.name\) : t\('不使用底图'\)/, 'the row shows the name only: the anchor is stored, not displayed');
  const css = read('public/css/screens/lobby.css');
  assert.ok(!/nc-crop__val/.test(css), 'no percentage read-out in the window');
  assert.ok(!/nc-crop__foot small/.test(css), 'no descriptive text under the window');
  assert.match(read('public/js/screens/room.js'), /<\$\{NameCardLayer\} card=\$\{card\.bg\} shift=\$\{card\.bgShift\}/,
    'the room seat card uses the same anchor');
  assert.match(read('public/js/ui/achievements.js'), /<\$\{NameCardLayer\} card=\$\{card\.bg\} shift=\$\{card\.bgShift\}/);
});
