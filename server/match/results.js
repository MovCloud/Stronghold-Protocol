// server/match/results.js — settlement (RESULT): per-player results, titles (评语), trophies and rewards
// (DESIGN §6.1, research 06 §10.4–§10.6, data/config.json titles/titleRule/trophies/rewards).
//
// roundsPassed (per player): eliminated in round k ⇒ k − 1; alive at the end ⇒ bossRound on a win (+1 when the
// Hidden Core was cleared), bossRound − 1 when the Final Assault was lost. Rewards and trophies follow each player's
// OWN rounds passed (research 06 §6 / §10.4): the Hidden-Core trophy row and a row's `victory` only for the players
// still in at the end — a teammate eliminated (or departed) earlier keeps the table value of its own rounds.
// Titles: every config.titles entry (with data/tuning.json `titles` overrides, gamedata.js) has { stat, rule:
// 'max'|'min', onlyOnWin? }. 'max' titles: candidates are the players with a positive stat, ranked high → low.
// 'min' titles (坚若磐石 "目标生命值损失最少" = least LP lost): every player still alive at the end is a candidate,
// ranked low → high (the eliminated lost everything). Candidates are ranked by the player's rank for that stat
// (0 = best), then by closeness to the best value, then title order, then seat; greedy assignment gives each player
// ≤ 1 title and uses each title ≤ once (config.titleRule [ASSUMED]).

import { bondList } from './bondsMeta.js';
import { boardOrder } from './board.js';

const STAT_OF = {
  bossDamage: (ps) => ps.stats.bossDamage,
  activatedLayers: (ps) => ps.activatedLayers(),
  lpRemaining: (ps) => (ps.alive ? Math.max(0, ps.lpAtFinal ?? ps.lp) : 0),
  lpLost: (ps) => Math.max(0, Number(ps.stats.lpLost) || 0),
  merges: (ps) => ps.stats.merges,
  itemsEquipped: (ps) => ps.stats.itemsEquipped,
  fundsSpent: (ps) => ps.stats.gold,
};

export function assignTitles(gd, players, victory) {
  const titles = Array.isArray(gd.titles) ? gd.titles : Array.isArray(gd.config.titles) ? gd.config.titles : [];
  const cands = [];
  titles.forEach((t, ti) => {
    if (!t || typeof t.stat !== 'string' || !Object.hasOwn(STAT_OF, t.stat)) return;
    if (t.onlyOnWin && !victory) return;
    if (t.rule === 'min') {
      const vals = players.filter((ps) => ps.alive).map((ps) => ({ ps, v: Math.max(0, Number(STAT_OF[t.stat](ps)) || 0) }));
      if (!vals.length) return;
      const best = Math.min(...vals.map((x) => x.v));
      const sorted = vals.slice().sort((a, b) => a.v - b.v);
      for (const { ps, v } of vals) cands.push({ ps, t, ti, rank: sorted.findIndex((x) => x.v === v), rel: (best + 1) / (v + 1) });
      return;
    }
    const vals = players.map((ps) => ({ ps, v: Number(STAT_OF[t.stat](ps)) || 0 }));
    const best = Math.max(0, ...vals.map((x) => x.v));
    if (best <= 0) return;
    const sorted = vals.slice().sort((a, b) => b.v - a.v);
    for (const { ps, v } of vals) {
      if (v <= 0) continue;
      const rank = sorted.findIndex((x) => x.v === v);
      cands.push({ ps, t, ti, rank, rel: v / best });
    }
  });
  cands.sort((a, b) => a.rank - b.rank || b.rel - a.rel || a.ti - b.ti || a.ps.seat - b.ps.seat);
  const out = new Map();
  const used = new Set();
  for (const c of cands) {
    if (out.has(c.ps.playerId) || used.has(c.t.id)) continue;
    out.set(c.ps.playerId, { id: c.t.id, name: c.t.name, picId: c.t.picId, text: c.t.text });
    used.add(c.t.id);
  }
  return out;
}

function trophiesFor(gd, roundsPassed, hiddenCleared) {
  const tr = gd.config.trophies;
  if (!tr || gd.isSolo) return 0;
  let n = 0;
  if (Array.isArray(tr.byRoundsPassed)) {
    for (const row of tr.byRoundsPassed) {
      if (roundsPassed <= row.maxRound) { n = Number(row[gd.difficulty]) || 0; break; }
    }
  }
  if (hiddenCleared && tr.hiddenCore && Number.isFinite(tr.hiddenCore[gd.difficulty])) n = tr.hiddenCore[gd.difficulty];
  return n;
}

/**
 * The 2V2 settlement's boss-time weights (user 2026-10-17): the 最终攻势 (R14) counts 4 and the 隐秘核心 (R15) 5 —
 * `score(team) = 4 × remain(R14)/limit(R14) + 5 × remain(R15)/limit(R15)`, in SHARES (the two rounds have their own
 * limits), a round a team never reached counting 0. `bossTimeScore` below is the one formula; the match records the
 * remainders (server/match/match/bossRounds.js _noteBossTime) and decides the winner with them first, the shared LP
 * second and the leader scoring of _versusDecide last.
 */
export const BOSS_TIME_WEIGHTS = Object.freeze({ boss: 4, hidden: 5 });

/**
 * The weighted remaining time of one team: `time` as its per-round records ({ r14 / r15: { remain, limit, reached } }).
 * A round without a limit, or one the team never reached, contributes 0 (and no weight to `max`).
 * @param {{ r14?: any, r15?: any } | null} time
 * @returns {{ score: number, max: number, pct: number | null }} the weighted score, the weights in play and score/max in %
 */
export function bossTimeScore(time) {
  let score = 0;
  let max = 0;
  for (const [key, weight] of [['r14', BOSS_TIME_WEIGHTS.boss], ['r15', BOSS_TIME_WEIGHTS.hidden]]) {
    const rec = time && typeof time === 'object' ? time[key] : null;
    const limit = rec && Number.isFinite(rec.limit) ? Math.max(0, rec.limit) : 0;
    if (!(limit > 0)) continue;
    const remain = rec && Number.isFinite(rec.remain) ? Math.max(0, Math.min(rec.remain, limit)) : 0;
    score += weight * (remain / limit);
    max += weight;
  }
  return { score, max, pct: max > 0 ? (100 * score) / max : null };
}

function rewardFor(gd, roundsPassed) {
  const rw = gd.config.rewards;
  if (!rw || !Array.isArray(rw.baseByRoundsPassed)) return 0;
  const row = rw.baseByRoundsPassed.filter((r) => r.round <= roundsPassed).pop();
  if (!row) return 0;
  const df = (rw.difficultyFactor && rw.difficultyFactor[gd.difficulty]) || 1;
  const mf = (rw.modeFactor && rw.modeFactor[gd.isSolo ? 'SINGLE' : 'MULTI']) || 1;
  return Math.round(row.count * df * mf);
}

/**
 * (fork) The alternate result background (m.result.altArt, cosmetic only): a match with the chance (every
 * ALT_ART_EVERY-th match this server process created, Match.serverMatchNo, or one in a room picked with
 * scripts/announce.mjs --pick, Match.altArtChance) that reached the Hidden Core, with ALT_ART_CHAR on a final board.
 */
export const ALT_ART_EVERY = 10;

/**
 * Why a match has the chance, or null (the lobby asks once, when the match starts).
 * @param {number} serverMatchNo @param {boolean} [picked] the room was picked with scripts/announce.mjs --pick
 * @returns {'picked' | 'every' | null}
 */
export function altArtChance(serverMatchNo, picked = false) {
  if (picked) return 'picked';
  return serverMatchNo > 0 && serverMatchNo % ALT_ART_EVERY === 0 ? 'every' : null;
}
const ALT_ART_CHAR = /^char_\d+_kalts\d*$/;

/** @param {any} gd @param {{ id: string, diy?: { charId: string } }} e a result lineup entry */
function isAltArtUnit(gd, e) {
  const charId = e.diy?.charId || gd.chess(e.id)?.charId || '';
  return ALT_ART_CHAR.test(charId);
}

/**
 * @param {import('./Match.js').Match} m
 * @param {boolean} hiddenReached
 * @param {{ lineup: any[] }[]} rows the result rows (lineup = the final board)
 */
export function altArtResult(m, hiddenReached, rows) {
  const chance = m.altArtChance !== undefined ? m.altArtChance : altArtChance(m.serverMatchNo);
  if (!hiddenReached || !chance) return false;
  return rows.some((row) => row.lineup.some((e) => isAltArtUnit(m.gd, e)));
}

/**
 * @param {import('./Match.js').Match} m
 * @param {{ victory: boolean, hiddenReached: boolean, hiddenCleared: boolean, reason: string }} outcome
 */
export function buildResult(m, outcome) {
  const gd = m.gd;
  const { victory, hiddenReached, hiddenCleared } = outcome;
  const versus = m.isVersus ? (m.versusOutcome || { winnerTeam: null, doubleLoss: false, teams: {} }) : null;
  const players = [...m.players.values()].sort((a, b) => a.seat - b.seat);
  const titles = assignTitles(gd, players.filter(ps => !Number.isInteger(ps.aiTakeoverRound)), victory);
  const teamRounds = victory ? gd.bossRound + (hiddenCleared ? 1 : 0) : Math.max(0, Math.min(m.round, gd.bossRound) - 1);
  const rows = players.map((ps) => {
    const roundsPassed = !ps.alive && ps.eliminatedRound != null ? Math.max(0, ps.eliminatedRound - 1) : teamRounds;
    const lineup = boardOrder(ps.board).filter((x) => x.piece.kind === 'chess').map(({ r, c, piece }) => {
      const e = { id: piece.id, golden: gd.isGolden(piece.id), tier: gd.tierOf(piece.id), row: r, col: c, items: (piece.items || []).map((i) => i.id) };
      // 0.2.0 自选编队: a DIY slot's pick — the result screen names and draws the operator (shared/diy.js diyRecord)
      const pick = typeof ps.diyPickOf === 'function' ? ps.diyPickOf(piece.id) : null;
      if (pick) e.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
      const si = typeof ps.fieldsStandIn === 'function' && ps.fieldsStandIn(piece.id) ? gd.standIn(piece.id) : null;
      if (si && si.standInFor) e.standInFor = si.standInFor;
      return e;
    });
    // the team's clear counts for the players still in; an eliminated / departed teammate did not pass the boss round.
    // 2V2: a player wins when its team won (versusOutcome.winnerTeam); a double loss clears nobody.
    // 随机模式 负生: a player whose LP dropped below 0 (rmFailed) 已判负 — still on the seat, but cannot win this match
    const cleared = versus
      ? (versus.winnerTeam != null && versus.winnerTeam === ps.team)
      : victory && ps.alive && !(m.random && ps.rmFailed);
    return {
      playerId: ps.playerId,
      seat: ps.seat,
      // 2V2: the team this row fights for (null in solo / co-op) — the settlement groups the squads by it
      team: ps.team,
      name: ps.name,
      isBot: ps.isBot,
      ...(Number.isInteger(ps.aiTakeoverRound) ? { aiTakeoverRound: ps.aiTakeoverRound } : {}),
      left: ps.left,
      alive: ps.alive,
      victory: cleared,
      roundsPassed,
      creditedKills: ps.creditedKills,
      eliminatedRound: ps.eliminatedRound,
      lp: Math.max(0, ps.lp),
      bandId: ps.bandId,
      // 随机模式: the second pick, when the player holds two (the client shows both bands)
      ...(m.random && Array.isArray(ps.bandIds) && ps.bandIds.length > 1 ? { bandId2: ps.bandIds[1] } : {}),
      lineup,
      bonds: bondList(gd, ps.bonds).filter((b) => b.active || b.layers > 0),
      // 2V2 商人「坎诺特」: 赏金 is NOT gold. `earned` = every 赏金 banked this match (the settlement's 「本局赏金收入」),
      // `withdrawn` = 金币 taken out of the bank (PlayerState.withdrawnGold), `bank` = the 赏金 still held (剩余存款).
      bounty: {
        earned: Math.max(0, Math.trunc(Number(ps.bountyEarned) || 0)),
        withdrawn: Math.max(0, Math.trunc(Number(ps.withdrawnGold) || 0)),
        bank: Math.max(0, Math.trunc(Number(ps.bountyBank) || 0)),
      },
      stats: {
        dmgDealt: Math.round(ps.stats.dmgDealt), kills: ps.stats.kills, leaks: ps.stats.leaks, gold: ps.stats.gold,
        refreshes: ps.stats.refreshes, merges: ps.stats.merges, itemsEquipped: ps.stats.itemsEquipped,
        bossDamage: Math.round(ps.stats.bossDamage), activatedLayers: ps.activatedLayers(), lpLost: ps.stats.lpLost,
        perfectRounds: ps.stats.perfectRounds,
      },
      title: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? null : titles.get(ps.playerId) ?? null,
      trophies: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? 0 : trophiesFor(gd, roundsPassed, cleared && hiddenCleared),
      reward: m.test === true || Number.isInteger(ps.aiTakeoverRound) ? 0 : rewardFor(gd, roundsPassed),
    };
  });
  const out = {
    t: 'm.result',
    victory,
    roundsPassed: teamRounds,
    hiddenReached,
    hiddenCleared,
    // (fork) only when it fires, so every other payload (and the golden matches) keeps its shape
    ...(altArtResult(m, hiddenReached, rows) ? { altArt: true } : {}),
    reason: outcome.reason,
    // 2V2: the per-team scoring and winner (winnerTeam = the winning team, or null on a draw / double loss).
    // `timeTie`: both squads's 4:5 boss-time scores were equal — the winner then came from the shared LP (and, if that
    // ties too, from the leader scoring); the settlement says so. `timeWeights` are the weights in play (R14 4, R15 5).
    versus: versus ? {
      winnerTeam: versus.winnerTeam, doubleLoss: versus.doubleLoss, timeTie: !!versus.timeTie, teams: versus.teams,
      timeWeights: { r14: BOSS_TIME_WEIGHTS.boss, ...(gd.hiddenRound != null ? { r15: BOSS_TIME_WEIGHTS.hidden } : {}) },
    } : undefined,
    // the merged Final Assault pool (null before round 14); players[].lp are the alive players' shares of it
    teamLp: m.teamLp != null ? Math.max(0, Math.round(m.teamLp)) : (m.teamLps ? [...m.teamLps.values()].reduce((s, v) => s + Math.max(0, Math.round(v)), 0) : null),
    modeId: m.modeId,
    difficulty: m.difficulty,
    stageId: m.stageId,
    // a non-default official version's match (DESIGN §35.23): its registry id — the page records and draws the settlement
    // with that version even when it never saw the room (the lobby's replay after a kick / grace timeout); absent for
    // the default, so its result stays byte-identical
    ...(m.version ? { version: m.version } : {}),
    bossId: m.bossId,
    hiddenBossId: m.hiddenBossId,
    seed: m.seed,
    durationMs: Math.max(0, m.sched.now() - m.startedAt),
    players: rows,
  };
  // A test match is marked on the settlement the replay stores. The keys are absent otherwise, so a normal
  // result stays byte-identical. Test results award nothing and are never persisted by the client.
  if (m.test === true) {
    out.test = true;
    out.testActions = m.testActions | 0;
    if (m.testReplayable === false) out.testReplayable = false;
  }
  return out;
}
