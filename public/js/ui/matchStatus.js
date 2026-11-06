// Pure match-status helpers of the in-match HUD (no DOM, no Preact — unit-tested in test/ui/leftovers.test.js):
//
//   * Boss-round clock (最终攻势 / 隐秘核心, research 00-INDEX §5, 01 §10): m.public.deadline is the level's
//     maxPlayTime countdown (120 real s, config modes[…].rounds[r].levelMaxPlayTime) — "计时结束后战斗仍然会继续" —
//     and m.public.overtimeAt is when the overtime drain starts (bossTurnHpReduceTime, 150 real s): from then on the
//     merged team LP loses config.bossOvertimeDrainPerSec (1) per whole real second (server gamedata.js
//     bossOvertimeDue: the first point at overtimeAt + 1 s). `overtimeState` says what the red DOT warning shows.
//   * Match control (server/match/match/matchControl.js): 暂停 / 快进 / 跳过 are C2S g.matchControl requests the connected
//     humans must all agree to (`pauseAvailable` is the gate for all three), and the answer is g.matchControlBallot. When
//     the match has no other connected human the server applies the request at once, so a solo run feels immediate.
//     m.public.paused (optionally m.public.pausedAt, ms epoch) and m.public.speed carry the outcome; while paused every
//     HUD clock is frozen at the pause moment (`frozenNow`).

import { PHASE, PLAYBACK } from '../../../shared/constants.js';

const isObj = (v) => !!v && typeof v === 'object';
const BOSS_PHASES = new Set([PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);
/** Battle phases a match control request is accepted in (server matchControl.js CONTROL_PHASES). */
const CONTROL_PHASES = new Set([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

/** Level time of a boss round when the config does not say (research 01 §3: maxPlayTime 120 s). */
export const BOSS_LEVEL_SECONDS = 120;
/** The pending overtime warning shows this many seconds before the drain even while the level countdown still runs. */
export const OVERTIME_WARN_BEFORE = 30;

/**
 * The level's countdown length (s) of a boss round — the gauge total of the 120 s countdown.
 * @param {any} pub m.public
 * @param {any} config data/config.json
 * @returns {number|null} null outside boss rounds
 */
export function bossLevelSeconds(pub, config) {
  if (!isObj(pub) || !BOSS_PHASES.has(pub.phase)) return null;
  const mode = isObj(config?.modes) ? config.modes[pub.modeId] : null;
  const v = mode?.rounds?.[String(pub.round)]?.levelMaxPlayTime;
  return Number.isFinite(v) && v > 0 ? v : BOSS_LEVEL_SECONDS;
}

/** Team LP lost per real second of overtime (config.bossOvertimeDrainPerSec, default 1). */
export function overtimeDrainPerSec(config) {
  const v = config?.bossOvertimeDrainPerSec;
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/**
 * What the red overtime (DOT) warning of a boss round shows at `now` (server-corrected ms epoch):
 *   null                                  nothing (not a boss round, no overtimeAt, or the drain is still far away)
 *   { state: 'pending', secs }            the drain starts in `secs` s (shown once the level countdown ran out, or
 *                                         within OVERTIME_WARN_BEFORE s of the drain)
 *   { state: 'drain', secs, lost, perSec } draining for `secs` whole seconds: `lost` LP so far, `perSec` LP/s
 * @param {any} pub m.public
 * @param {number} now
 * @param {{ perSec?: number, warnBefore?: number }} [o]
 */
export function overtimeState(pub, now, { perSec = 1, warnBefore = OVERTIME_WARN_BEFORE } = {}) {
  if (!isObj(pub) || !BOSS_PHASES.has(pub.phase) || !Number.isFinite(now)) return null;
  const at = Number(pub.overtimeAt);
  if (!(Number.isFinite(at) && at > 0)) return null;
  if (now < at) {
    const secs = Math.ceil((at - now) / 1000);
    const levelOver = Number.isFinite(pub.deadline) && pub.deadline > 0 && now >= pub.deadline;
    if (!levelOver && secs > warnBefore) return null;
    return { state: 'pending', secs };
  }
  const secs = Math.floor((now - at) / 1000);
  const rate = Number.isFinite(perSec) && perSec >= 0 ? perSec : 1;
  return { state: 'drain', secs, lost: secs * rate, perSec: rate };
}

/**
 * Whether the match controls (暂停 / 快进 / 跳过) are offered: both battle modes, while the player's own battle runs
 * (server matchControl.js: WRONG_PHASE once no battle is live). Every control is a request the connected humans must
 * all agree to, so a co-op room is no longer excluded the way the old solo-only pause was. While paused the control
 * stays (to resume).
 * @param {any} pub m.public
 * @param {{ alive?: boolean, done?: boolean }} [o] done: the own battle is over
 */
export function pauseAvailable(pub, { alive = true, done = false } = {}) {
  if (!isObj(pub) || alive === false) return false;
  if (done && !pub.paused) return false;
  return CONTROL_PHASES.has(pub.phase);
}

/** Whether the 快进 toggle is on: the battle runs faster than the 1× base (m.public.speed). */
export const fastActive = (pub) => isObj(pub) && Number(pub.speed) > PLAYBACK.NORMAL;

/** The one-shot 跳过 can be requested while the controls are offered and the battle is not already at 60×. */
export function skipAvailable(pub, o = {}) {
  return pauseAvailable(pub, o) && Number(pub.speed) !== PLAYBACK.SKIP;
}

/** Whether m.public says the match is paused. */
export const isPaused = (pub) => isObj(pub) && !!pub.paused;

/** The pause intent (C2S g.pause {on}). */
export const pauseIntent = (on) => ({ t: 'g.pause', fields: { on: !!on } });

/** A match control request (C2S g.matchControl {action}): 'pause' | 'resume' | 'fast' | 'skip'. */
export const matchControlIntent = (action) => ({ t: 'g.matchControl', fields: { action } });

/**
 * The clock every HUD countdown reads: the live server time, or — while paused — the moment the pause began
 * (m.public.pausedAt when the server sends it, else the first time this client saw `paused`).
 * @param {any} pub m.public
 * @param {number} now live server-corrected ms epoch
 * @param {number|null} seenAt when this client first saw the pause (ms epoch), or null
 */
export function frozenNow(pub, now, seenAt = null) {
  if (!isPaused(pub)) return now;
  const at = Number(pub.pausedAt);
  if (Number.isFinite(at) && at > 0) return Math.min(now, at);
  return Number.isFinite(seenAt) ? Math.min(now, seenAt) : now;
}

/**
 * Seconds left on a deadline at `now` (ceil, ≥ 0), or null without a deadline.
 * @param {number|null|undefined} deadline ms epoch
 * @param {number} now ms epoch
 */
export function remainAt(deadline, now) {
  if (!(Number.isFinite(deadline) && deadline > 0) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
