// 队友的策略(游玩记录 #2 item 2:「观战队友时看不到队友的策略详情」):观战队友的整备区棋盘时,
// 「本局信息」抽屉的策略块从自己的 priv.bandId 切换成被观看玩家的 m.public players[].bandId,标签
// 从「我的策略」变为「XX 的策略」(ui/enemyDrawer.js InfoTab 的 bandId / bandOwner 覆盖;game.js
// scoutPid / scoutBandId)。不进详情卡——策略和自己的查看位置一致。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

import { ownerBandId } from '../../public/js/ui/gameLogic.js';
import { flyOpRec } from '../../public/js/ui/teamPanel.js';

describe('flyOpRec — the record the 盟约 flyout draws an on-field operator with', () => {
  // data/chess.json is keyed by chess ids (`chess_char_*`); boardOps sends the field record's char id
  // (`char_*`, the operator it fights as). A chess id needs no composed record; a char id must get one, or the
  // thumbnail looks up nothing and every tile renders '?' (owner report 2026-10-25).
  const isChess = (id) => String(id).startsWith('chess_');
  test('a chess id: null (the thumbnail\'s own lookup resolves it)', () => {
    assert.equal(flyOpRec({ id: 'chess_char_1_01_a' }, isChess), null);
  });
  test('a char id: a record carrying that char id as its art key, plus the elite bit', () => {
    assert.deepEqual(flyOpRec({ id: 'char_498_inside', golden: 1 }, isChess),
      { charId: 'char_498_inside', assets: { avatar: 'char_498_inside' }, isGolden: true });
    assert.deepEqual(flyOpRec({ id: 'char_498_inside' }, isChess),
      { charId: 'char_498_inside', assets: { avatar: 'char_498_inside' }, isGolden: false });
  });
});

describe('ownerBandId — the picked 策略 of a player', () => {
  const pub = { players: [
    { playerId: 'p1', name: '博士一', bandId: 'band_bldsk' },
    { playerId: 'p2', name: '博士二' }, // not picked yet (draft running)
  ] };
  test('the bandId of the owner, null for anyone without one or an unknown id', () => {
    assert.equal(ownerBandId(pub, 'p1'), 'band_bldsk');
    assert.equal(ownerBandId(pub, 'p2'), null);
    assert.equal(ownerBandId(pub, 'pX'), null);
    assert.equal(ownerBandId(null, 'p1'), null);
    assert.equal(ownerBandId({ players: [] }, 'p1'), null);
  });
});

describe('the drawer shows the watched player\'s 策略 while scouting', () => {
  test('game.js derives the scouted player and hands bandId / bandOwner to the drawer (source)', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /const scoutPid = watchingOther && field\?\.prep && typeof field\.fieldId === 'string' && field\.fieldId\.startsWith\('n:'\) \? field\.fieldId\.slice\(2\) : null/);
    assert.match(game, /const scoutBandId = scoutPid \? ownerBandId\(pub, scoutPid\) : null/);
    assert.match(game, /bandId=\$\{scoutBandId\} bandOwner=\$\{scoutBandOwner\}/);
  });

  test('InfoTab overrides the band and labels it with the owner (source); the detail card has no 策略 section', () => {
    const drawer = read('public/js/ui/enemyDrawer.js');
    assert.match(drawer, /const band = \(bandId \|\| priv\?\.bandId\) \? data\.lookup\('bands', bandId \|\| priv\.bandId\) : null/);
    // The string is i18n-wrapped: the label goes through t() with the owner as an argument.
    assert.match(drawer, /bandOwner \? t\('\{0\} 的策略', \{ 0: \(bandOwner\) \?\? '' \}\) : t\('我的策略'\)/);
    const panel = read('public/js/ui/detailPanel.js');
    assert.doesNotMatch(panel, /key="band"/, 'no 策略 section on the detail card');
    assert.doesNotMatch(panel, /'band'/, "CHESS_SECTIONS has no 'band' block");
  });
});
