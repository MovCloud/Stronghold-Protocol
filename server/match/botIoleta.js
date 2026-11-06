// Registered procurement only; placement remains independently selectable.
import { botPickBand, botPrepBeginSteps, botPrepEndSteps, createBotPrepSteps } from './bot.js';
import { ioletaBuyBonus, ioletaCore, ioletaCanLevel as policyCanLevel, ioletaTarget, ioletaSearchTargets,
  refreshIoletaPlan } from './botIoletaPolicy.js';

export const IOLETA_POLICY = Object.freeze({
  buyBonus: ioletaBuyBonus, core: ioletaCore, canLevel: policyCanLevel,
  target: ioletaTarget, searchTargets: ioletaSearchTargets,
});

/** Explicit actions allow pairing the same procurement with contact placement in local comparisons. */
export function createIoletaPrepSteps(actions = {}) {
  const prep = createBotPrepSteps(actions, IOLETA_POLICY);
  const fallback = Object.keys(actions).length ? createBotPrepSteps(actions) : {
    prepBegin: botPrepBeginSteps, prepEnd: botPrepEndSteps,
  };
  return Object.freeze({
    *prepBegin(m, ps, opts) {
      if (ps.bandId !== 'band_ioleta') return yield* fallback.prepBegin(m, ps, opts);
      if (!ps.alive || ps.ready) return null;
      refreshIoletaPlan(m, ps);
      return yield* prep.prepBegin(m, ps, opts);
    },
    *prepEnd(m, ps, job) {
      return yield* (ps.bandId === 'band_ioleta' ? prep : fallback).prepEnd(m, ps, job);
    },
  });
}

// bot.js imports this module for the fork's Ioleta heuristics, so this body runs before bot.js's constants are
// initialized (a top-level createIoletaPrepSteps() there would hit a TDZ). The strategy is built on first use instead.
let prep = null;
const prepOf = () => (prep ||= createIoletaPrepSteps());
export const IOLETA_BOT = Object.freeze({
  id: 'ioleta',
  pickBand(m, ps) {
    // [ASSUMED] Prefer Russell when offered and free; all other choices use the legacy picker.
    const id = 'band_ioleta';
    if (m.gd.bandIds().includes(id) && !m.bandTaken(id, ps.playerId)
      && !m.gd.bandBondIds(id).some(b => m.gd.modeInactiveBonds.has(b))) return id;
    return botPickBand(m, ps);
  },
  prepBegin: (m, ps, opts) => prepOf().prepBegin(m, ps, opts),
  prepEnd: (m, ps, job) => prepOf().prepEnd(m, ps, job),
});

// The fork's own Ioleta heuristics (2026-10-15, merged from TempesTKF): three deployed elites before L2, six before
// L3; preserve elites, with small independent preferences for 坚守 / 精准 / 奥术. Decisions only — 统御号令 and the
// game's upgrade / bond rules are the mainline's, and the registered policy above is what the strategy uses. These
// are the fork's comparisons for the legacy path and for test/match/bot-ioleta.test.js.
export const isIoleta = (ps) => ps.bandId === 'band_ioleta';
export const eliteCount = (gd, pieces) => pieces.filter((p) => p.kind === 'chess' && gd.isGolden(p.id)).length;

// [ASSUMED] Heuristic weights: a deployed elite outweighs a normal bond improvement;
// bond preferences only break close comparisons, with no extra reward for a fourth member.
export const IOLETA_ELITE_VALUE = 120;
const BONDS = [['steadShip', 0.3], ['preciShip', 0.2], ['arcaneShip', 0.1]];

export function ioletaBuyBondBonus(gd, rec, owned) {
  return BONDS.reduce((score, [id, weight]) => score + (!gd.modeInactiveBonds.has(id)
    && rec.bonds.includes(id) && (owned.counts.get(id) || 0) < 3 ? weight : 0), 0);
}

export function ioletaBondScore(gd, bonds) {
  let score = 0;
  for (const [id, weight] of BONDS) {
    if (gd.modeInactiveBonds.has(id)) continue;
    const n = Math.min(3, bonds[id]?.count || 0);
    score += weight * n;
  }
  return score;
}

export function ioletaCanLevel(ps) {
  if (!isIoleta(ps) || ps.shop.level >= 3) return true;
  const required = ps.shop.level === 1 ? 3 : 6;
  return eliteCount(ps.gd, [...ps.board.values()]) >= required;
}
