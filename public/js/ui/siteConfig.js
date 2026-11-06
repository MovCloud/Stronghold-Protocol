// ui/siteConfig.js — the installation's own switches (下放配置项).
//
// The feedback QQ group, the 反馈板 page and the battlefield terrain hint layer belong to whoever runs this
// installation, not to the code, so they live in a config file the operator edits instead of being baked into the
// client: /data/site.json, served by the same server as the game (static.js mounts /data/). Keys:
//   feedbackGroup  lobbyFeedback.js  the QQ group the 反馈 button copies
//   feedbackBoard  siteBoards.js     the 反馈板 page
//   tileHints      render/tiles.js   the blocked-ground outline / high-ground lift on the board (default off)
// A missing, unreadable or partial file keeps the shipped defaults. Applied once at boot; the link modules expose a
// setter because they keep the values as live module bindings, so the components that render them pick up the override.
import { setFeedbackGroup } from './lobbyFeedback.js';
import { setSiteBoards } from './siteBoards.js';
import { setTileClassHints } from '../render/tiles.js';

/** The config file, same origin as the game. */
export const SITE_CONFIG_URL = '/data/site.json';

/** Merge a parsed config object over the shipped defaults; unknown or blank fields are ignored. @param {any} raw */
export function applySiteConfig(raw) {
  if (!raw || typeof raw !== 'object') return;
  // feedbackGroup is a three-state key: a missing key keeps the shipped default, an explicit empty value hides the
  // entry (空值隐藏，ui/lobbyFeedback.js), a non-empty string points the button at the installation's own group.
  if (typeof raw.feedbackGroup === 'string') setFeedbackGroup(raw.feedbackGroup.trim() || null);
  // The boards are three-state too, so the raw string is passed through: a blank value hides that link instead of
  // being dropped as "no override".
  const boards = {};
  if (typeof raw.feedbackBoard === 'string') boards.feedbackBoard = raw.feedbackBoard;
  if (Object.keys(boards).length) setSiteBoards(boards);
  if (typeof raw.tileHints === 'boolean') setTileClassHints(raw.tileHints);
}

let loaded = null;

/** Fetch and apply /data/site.json once. Never rejects: an absent file simply keeps the defaults. */
export function loadSiteConfig(fetchImpl = (...a) => globalThis.fetch(...a)) {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const res = await fetchImpl(SITE_CONFIG_URL, { cache: 'no-cache' });
      if (!res || !res.ok) return;
      applySiteConfig(await res.json());
    } catch { /* keep the defaults */ }
  })();
  return loaded;
}
