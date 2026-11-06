import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEEDBACK_GROUP, copyFeedbackGroup, setFeedbackGroup, LobbyFeedback } from '../../public/js/ui/lobbyFeedback.js';
import { FEEDBACK_BOARD, STATUS_BOARD } from '../../public/js/ui/siteBoards.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('lobby feedback copies only the existing public group number', async () => {
  const copied = [], messages = [];
  assert.equal(FEEDBACK_GROUP, '243859707');
  assert.equal(await copyFeedbackGroup(async text => { copied.push(text); return true; }, (...args) => messages.push(args)), true);
  assert.deepEqual(copied, ['243859707']);
  assert.deepEqual(messages, [['已复制反馈群号 243859707', 'success']]);
});

for (const mode of ['unavailable', 'denied']) test(`lobby feedback ${mode} does not claim successful copying`, async () => {
  const messages = [];
  const copy = async text => { assert.equal(text, '243859707'); if (mode === 'denied') throw new Error('denied'); return false; };
  assert.equal(await copyFeedbackGroup(copy, (...args) => messages.push(args)), false);
  assert.deepEqual(messages, [['复制失败，请手动复制', 'warn']]);
});

test('feedback remains visible outside optional announcements, with a number-only accessible button', () => {
  const lobby = source('../../public/js/screens/lobby.js'), feedback = source('../../public/js/ui/lobbyFeedback.js');
  assert.match(lobby, /<div class="hub-contact"><div class="hub-contact__row"><\$\{LobbyFeedback\} \/><\$\{SiteBoards\} \/><\/div>/);
  assert.match(feedback, /aria-label=\$\{t\('反馈 QQ 群：\{group\}，点击复制群号'/);
  assert.match(feedback, />\$\{FEEDBACK_GROUP\}<\/\/>/);
  assert.doesNotMatch(feedback, /href=|window\.open|2225664821|net\.request|localStorage/);
  assert.match(feedback, /copied \? 'success' : 'warn'/);
  const css = source('../../public/css/screens/lobby.css');
  assert.match(css, /\.lobby-feedback \{[^}]*min-height: 40px/);
});

test('the feedback board and the status page are same-origin links that open in a new tab', () => {
  assert.equal(FEEDBACK_BOARD, '/feedback/');
  assert.equal(STATUS_BOARD, '/monitor/');
  const boards = source('../../public/js/ui/siteBoards.js');
  assert.equal(boards.match(/<a class="btn btn--secondary btn--sm hub-board(?: hub-board--status)?" href=\$\{(FEEDBACK_BOARD|STATUS_BOARD)\} target="_blank" rel="noopener"/g).length, 2);
  assert.doesNotMatch(boards, /https?:|window\.open|net\.request|localStorage/);
  const en = JSON.parse(source('../../public/i18n/en.json'));
  for (const key of boards.match(/t\('[^']+'\)/g).map(call => call.slice(3, -2))) assert.ok(Object.hasOwn(en, key), key);
  assert.match(source('../../public/css/screens/lobby.css'), /\.hub-board \{[^}]*min-height: 40px/);
});

test('an empty site.json feedbackGroup hides the entry, a missing one keeps the default', async () => {
  const config = source('../../public/js/ui/siteConfig.js');
  // three-state key: a missing key keeps the default, an explicit empty value passes null (hide), a value overrides
  assert.match(config, /if \(typeof raw\.feedbackGroup === 'string'\) setFeedbackGroup\(raw\.feedbackGroup\.trim\(\) \|\| null\);/);
  const feedback = source('../../public/js/ui/lobbyFeedback.js');
  assert.match(feedback, /if \(group === null\) FEEDBACK_GROUP = null;/);
  assert.match(feedback, /if \(!FEEDBACK_GROUP\) return null; \/\/ an installation may opt out/);
  // behaviour: an explicit null hides the button and blocks copying; a value replaces; the default survives it all
  const hidden = LobbyFeedback();
  assert.equal(setFeedbackGroup(null), undefined);
  assert.equal(FEEDBACK_GROUP, null);
  assert.equal(LobbyFeedback(), null);
  assert.equal(await copyFeedbackGroup(async () => true, () => {}), false, 'no copy attempt while hidden');
  setFeedbackGroup('123456789');
  assert.equal(FEEDBACK_GROUP, '123456789');
  const shown = LobbyFeedback();
  assert.notEqual(shown, null);
  assert.match(JSON.stringify(shown.props), /123456789/);
  setFeedbackGroup('   '); // blank-but-string keeps what is set (only the exact empty config value hides)
  assert.equal(FEEDBACK_GROUP, '123456789');
  setFeedbackGroup('243859707'); // restore the shipped default for the other tests' module state
  assert.equal(FEEDBACK_GROUP, '243859707');
  assert.notEqual(hidden, null);
});
