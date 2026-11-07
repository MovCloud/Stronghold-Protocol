// INFO_CHECK full setup reroll (重刷本局): a ¾ human vote, keeping the room and player settings.
// [ASSUMED] Remake convenience: the vote rule below, pause/resume timer, independent reroll stream and a 300 ms request
// guard. These are not official mode rules; DESIGN §28.21 and the 0.3.0 history (owner's rules of 2026-10-17).
// Installed on Match.prototype like the other method containers. The lobby authorizes who may propose (the host of a
// private room, any seated human of a matchmade one) and the host's room.cancelReroll; the proposer withdraws with
// g.rerollVote agree:false.
//
// The vote: voters = the humans connected (not left, not bots, not spectators) when it is proposed; need =
// ceil(0.75 × voters), the proposer counts as yes. It passes as soon as `agreed` reaches need and fails as soon as
// voters − rejected < need. A voter that disconnects or leaves is dropped from voters / agreed / rejected and need is
// recomputed from the voters left — the vote goes on (and may pass or fail on that recount); a human connecting later
// does not join it. It times out after REROLL_VOTE_MS. Failure, timeout or cancellation restores the paused confirmation
// time. Limits: one proposal per player per setup revision, MAX_SETUP_REROLLS per match (setupRevision counts them).
// The vote and the proposal marks are transient: a checkpoint restore drops them (server/match/snapshot.js).
// Per-seat throttle (PR #860): a seat may open one vote every SETUP_REROLL_COOLDOWN_MS (30 s); a completed reroll is a
// new opening and therefore a new window, a cancelled or rejected vote does not give the cooldown back. The value lives
// in shared/constants.js so the client's refusal toast names the same one. A connection's starts also draw from its
// heavy bucket.
import { PHASE, ERR, SETUP_REROLL_COOLDOWN_MS as REROLL_COOLDOWN_MS, VERSUS_INFO_SECONDS } from '../../../shared/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { setupMatchWaves } from '../waves.js';
import { drawDisabledBonds, SharedPool, createPoolGroups } from '../pool.js';
import { OK, fail } from './common.js';

/** How long a reroll vote stays open (ms, × timerScale). */
export const REROLL_VOTE_MS = 20_000;
/** Successful rerolls per match. */
export const MAX_SETUP_REROLLS = 3;
/** Yes votes a reroll needs of `n` voters. */
export const rerollNeed = (n) => Math.ceil(0.75 * n);

// One start per seat per cooldown: the vote freezes the INFO_CHECK countdown, so an endless restart loop would stall
// the opening. With one human every start completes at once and clears the seat cooldown, so the throttle there is the
// connection's heavy bucket: room.rerollSetup is in server/net.js HEAVY_TYPES (2 per second, burst 6), as each reroll
// rebuilds the opening and resends m.public (DESIGN §35.47).

export class MatchSetupVote {
  /** The pending setup-reroll vote of a team (2V2: one per team; solo/coop: the scalar setupVote). null when none. */
  _setupVoteOf(team) { return this.setupVotes ? (this.setupVotes.get(team) || null) : this.setupVote; }

  /** Any pending setup-reroll vote (the INFO_CHECK advance pauses while one is open). */
  _anySetupVote() { return this.setupVotes ? ([...this.setupVotes.values()][0] || null) : this.setupVote; }

  _setSetupVote(team, vote) {
    if (!this.setupVotes) { this.setupVote = vote; return; }
    const prev = this.setupVotes.get(team);
    if (prev && prev !== vote && prev.timer) { this.cancel(prev.timer); prev.timer = null; }
    if (vote) this.setupVotes.set(team, vote); else this.setupVotes.delete(team);
  }

  /** The vote's own window in REAL ms: the WHOLE briefing countdown (45 s 2V2 / the mode timer otherwise), scaled. */
  _setupVoteWindowMs() {
    const secs = this.isVersus ? VERSUS_INFO_SECONDS : (Number(this.gd.timer('infoCheck')) || 25);
    return Math.max(5000, this.scaled(secs * 1000));
  }

  /** Arm the phase deadline in REAL ms (the value is already timerScale-d). */
  _armPhaseDeadline(ms, fn) {
    this.cancel(this._phaseTimer);
    this._phaseTimer = null;
    if (!(ms > 0)) { this.deadline = 0; return; }
    this.deadline = this.sched.now() + ms;
    this._phaseTimer = this.later(ms, () => { this._phaseTimer = null; fn(); });
  }

  /** The humans whose consent a team's reroll needs (2V2: that team; solo/coop: every human). */
  _rerollHumans(team) {
    const humans = this.humans();
    return this.setupVotes ? humans.filter((p) => this.teamIdOf(p) === team) : humans;
  }

  requestSetupReroll(playerId, revision) {
    if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    if (this.setupVotes) return this._requestVersusReroll(playerId, revision);
    if (this.disposed || this.ended) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (revision !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup revision changed');
    if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
    if (this.setupRevision >= MAX_SETUP_REROLLS) return fail(ERR.ALREADY, 'reroll-limit');
    const now = this.sched.now();
    // The seat cooldown is the persistent half of the limit (it survives a checkpoint restore), the per-revision
    // proposal mark the transient half (snapshot.js drops it), so the cooldown answers first.
    const last = this._rerollStartAt.get(playerId);
    if (last !== undefined && now - last < REROLL_COOLDOWN_MS) return fail(ERR.RATE, 'setup reroll cooldown');
    if (this._setupProposals.get(playerId) === this.setupRevision) return fail(ERR.ALREADY, 'reroll-proposed');
    if (now - this._lastSetupVoteAt < 300) return fail(ERR.RATE);
    this._rerollStartAt.set(playerId, now);
    this._lastSetupVoteAt = now;
    this._setupProposals.set(playerId, this.setupRevision);
    // offline humans neither vote nor block
    const voters = this.humans().filter((p) => p.connected).map((p) => p.playerId);
    const ms = this.scaled(REROLL_VOTE_MS);
    const vote = this.setupVote = {
      id: ++this._setupVoteSeq,
      proposerId: playerId,
      voters,
      agreed: new Set([playerId]),
      rejected: new Set(),
      need: rerollNeed(voters.length),
      deadline: now + ms,
      remainingMs: this.deadline > 0 ? Math.max(1, this.deadline - now) : 0,
      timer: null,
    };
    this.cancel(this._infoAdvanceTimer);
    this._infoAdvanceTimer = null;
    this.setDeadline(0);
    if (vote.agreed.size >= vote.need) return this.completeSetupReroll();
    vote.timer = this.later(ms, () => {
      if (this.setupVote !== vote) return;
      vote.timer = null;
      this.cancelSetupVote('timeout');
    });
    this.markPublic();
    this.flush(true);
    return OK;
  }

  voteSetupReroll(ps, voteId, agree) {
    if (this.setupVotes) return this._voteVersusReroll(ps, voteId, agree);
    if (this.phase !== PHASE.INFO_CHECK || !this.setupVote) {
      // The vote is already over. A late YES on an issued vote merely consents to the reroll that passed — a harmless
      // no-op OK (SiderLock's unanimous-era flow votes every seat through). Anything else stays WRONG_PHASE; the wire
      // layer (intents g.rerollVote) refuses every vote once the vote object is gone.
      if (this.phase === PHASE.INFO_CHECK && agree === true && Number.isInteger(voteId)
        && voteId >= 1 && voteId <= this._setupVoteSeq) return OK;
      return fail(ERR.WRONG_PHASE);
    }
    const vote = this.setupVote;
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    if (!ps.connected || !vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    // the proposer saying no withdraws the proposal
    if (!agree && ps.playerId === vote.proposerId) { this.cancelSetupVote('cancelled', ps.playerId); return OK; }
    // a voter may change its mind until the vote ends
    if (agree) { vote.agreed.add(ps.playerId); vote.rejected.delete(ps.playerId); }
    else { vote.rejected.add(ps.playerId); vote.agreed.delete(ps.playerId); }
    return this._settleSetupVote();
  }

  /** room.cancelReroll: the lobby lets the host only through (the proposer withdraws with g.rerollVote). */
  cancelSetupReroll(playerId, voteId) {
    if (this.setupVotes) return this._cancelVersusReroll(playerId, voteId);
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK || !this.setupVote) return fail(ERR.WRONG_PHASE);
    if (this.setupVote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    const ps = this.players.get(playerId);
    if (!ps || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    this.cancelSetupVote('cancelled', playerId);
    return OK;
  }

  /** A voter disconnected or left (MatchPlatform): it is dropped and the vote recounted, never cancelled by it. */
  _dropSetupVoter(playerId) {
    if (this.setupVotes) {
      for (const team of [...this.setupVotes.keys()]) {
        const v = this.setupVotes.get(team);
        if (!v || !v.voters.includes(playerId)) continue;
        v.voters = v.voters.filter((id) => id !== playerId);
        v.agreed.delete(playerId);
        if (!v.voters.length) { this._cancelVersusVote(team); continue; }
        if (v.voters.every((id) => v.agreed.has(id))) this._completeVersusReroll(team);
      }
      return;
    }
    const vote = this.setupVote;
    if (!vote || !vote.voters.includes(playerId)) return;
    vote.voters = vote.voters.filter((id) => id !== playerId);
    vote.agreed.delete(playerId);
    vote.rejected.delete(playerId);
    if (!vote.voters.length) { this.cancelSetupVote('cancelled'); return; }
    vote.need = rerollNeed(vote.voters.length);
    this._settleSetupVote();
  }

  /** Pass once agreed reaches need; fail once it no longer can. */
  _settleSetupVote() {
    const vote = this.setupVote;
    if (vote.agreed.size >= vote.need) return this.completeSetupReroll();
    if (vote.voters.length - vote.rejected.size < vote.need) { this.cancelSetupVote('rejected'); return OK; }
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /**
   * End a vote without a reroll and restore the paused confirmation time. `reason` (m.notice): 'rejected' / 'timeout'
   * / 'error' → kind rerollFailed; 'cancelled' (by = the host or the proposer; null when no voter is left) → kind
   * rerollCancelled.
   */
  cancelSetupVote(reason = 'cancelled', by = null) {
    const vote = this.setupVote;
    if (!vote) return;
    this.setupVote = null;
    this.cancel(vote.timer);
    if (this.phase === PHASE.INFO_CHECK && !this.disposed && !this.ended) {
      if (vote.remainingMs > 0) {
        this.deadline = this.sched.now() + vote.remainingMs;
        this._phaseTimer = this.later(vote.remainingMs, () => {
          this._phaseTimer = null;
          this.enterBandDraft();
        });
      }
      this.broadcast(reason === 'cancelled' ? { t: 'm.notice', kind: 'rerollCancelled', voteId: vote.id, by }
        : { t: 'm.notice', kind: 'rerollFailed', voteId: vote.id, reason });
      this.maybeEndInfo();
      this.markPublic();
      this.flush(true);
    }
  }

  completeSetupReroll() {
    let prepared;
    try {
      const rng = createRng(deriveSeed(this.seed, `reroll-setup:${this.setupRevision + 1}`));
      const setup = setupMatchWaves(this.gd, rng);
      const stage = setup.stageId ? this.gd.stage(setup.stageId) : null;
      const bans = drawDisabledBonds(this.gd, rng);
      const poolGroups = createPoolGroups(this.gd, this.order, { banned: bans.banned, independent: this.disableSharedPool });
      const pool = this.disableSharedPool ? new SharedPool(this.gd, { banned: bans.banned }) : poolGroups[0].pool;
      if (!pool.entries.size || poolGroups.some(g => !g.pool.entries.size)) throw new Error('rerolled chess pool is empty');
      const playerPools = this.disableSharedPool || this.capacityExperiment || poolGroups.length > 1
        ? new Map(poolGroups.flatMap(g => g.playerIds.map(id => [id, g.pool]))) : null;
      const off = new Set([...bans.drawn, ...bans.staticOff]);
      const stocks = this.order.map((ps) => ps.buildDiyStock(off));
      prepared = { setup, stage, bans, pool, poolGroups, playerPools, stocks };
    } catch (e) {
      this.reportError('reroll setup', e);
      this.cancelSetupVote('error');
      return fail(ERR.INTERNAL);
    }
    // All data-dependent work succeeds before any opening or player state changes.
    const { setup, stage, bans, pool, poolGroups, playerPools, stocks } = prepared;
    this.stageId = setup.stageId;
    this.stage = stage;
    this.factions = setup.factions;
    this.bossId = setup.bossId;
    this.hiddenBossId = setup.hiddenBossId;
    this.disabledBonds = bans.drawn;
    this.staticInactiveBonds = bans.staticOff;
    this.bannedChess = bans.banned;
    this.pool = pool;
    this.poolGroups = poolGroups;
    this.playerPools = playerPools;
    // the equipment stock follows the new groups (pool.js createPoolGroups attaches each group's itemPool; ownership is
    // read live, nothing to carry over)
    this.playerItemPools = new Map(poolGroups.flatMap(g => g.playerIds.map(id => [id, g.itemPool])));
    this.itemPool = this.playerItemPools.get(poolGroups[0].playerIds[0]);
    this._botPath = null;
    for (const [i, ps] of this.order.entries()) {
      ps.diyStock = stocks[i].stock;
      ps.diyBanned = stocks[i].banned;
      ps.invalidateDeployMap();
      ps.infoReady = ps.botControlled;
    }
    this.setupRevision++;
    const vote = this.setupVote;
    this.setupVote = null;
    this.cancel(vote?.timer);
    if (vote) this.broadcast({ t: 'm.notice', kind: 'rerollPassed', voteId: vote.id, setupRevision: this.setupRevision });
    // A completed reroll is a new opening, so every seat gets a fresh chance to ask for another one.
    this._rerollStartAt.clear();
    this.enterInfoCheck();
    return OK;
  }

  // ---- 2V2 (versus): one setup-reroll vote PER TEAM; the reroll touches only that team's bans ----------------

  _requestVersusReroll(playerId, revision) {
    if (this.disposed || this.ended) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (revision !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup revision changed');
    const team = this.teamIdOf(ps);
    if (this.setupVotes.get(team)) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
    const voters = this._rerollHumans(team);
    const now = this.sched.now();
    if (now - this._lastSetupVoteAt < 300) return fail(ERR.RATE);
    this._lastSetupVoteAt = now;
    const ms = this._setupVoteWindowMs();
    const vote = {
      id: ++this._setupVoteSeq, team, proposerId: playerId,
      voters: voters.map((p) => p.playerId), agreed: new Set([playerId]), rejected: new Set(),
      savedRemainingMs: this.deadline > now ? this.deadline - now : ms,
    };
    this._setSetupVote(team, vote);
    this.cancel(this._infoAdvanceTimer);
    this._infoAdvanceTimer = null;
    // keep a VISIBLE countdown: the phase deadline becomes the vote's own FULL window; its expiry cancels the vote and
    // lets the briefing advance (a voter who never answers must not strand INFO_CHECK)
    this._armPhaseDeadline(ms, () => { if (this.setupVotes.get(team) === vote) this._cancelVersusVote(team, { restore: false }); });
    if (voters.length <= 1) return this._completeVersusReroll(team);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  _voteVersusReroll(ps, voteId, agree) {
    if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const team = this.teamIdOf(ps);
    const vote = this.setupVotes.get(team);
    if (!vote) {
      if (agree === true && Number.isInteger(voteId) && voteId >= 1 && voteId <= this._setupVoteSeq) return OK;
      return fail(ERR.WRONG_PHASE);
    }
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    if (!ps.connected || !vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (!agree) { this._cancelVersusVote(team); return OK; }
    vote.agreed.add(ps.playerId);
    if (vote.voters.every((id) => vote.agreed.has(id))) return this._completeVersusReroll(team);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  _cancelVersusReroll(playerId, voteId) {
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    const vote = this.setupVotes.get(this.teamIdOf(ps));
    if (!vote || vote.id !== voteId) return fail(ERR.BAD_TARGET, 'setup vote changed');
    this._cancelVersusVote(this.teamIdOf(ps));
    return OK;
  }

  /** Close one team's vote (all teams' when `team` is null). restore hands the interrupted briefing time back. */
  _cancelVersusVote(team, { restore = true } = {}) {
    const teams = team == null ? [...this.setupVotes.keys()] : [team];
    for (const t of teams) {
      const vote = this.setupVotes.get(t);
      if (!vote) continue;
      this._setSetupVote(t, null);
      if (this.phase !== PHASE.INFO_CHECK || this.disposed || this.ended || this._anySetupVote()) continue;
      if (restore && vote.savedRemainingMs > 0) {
        this._armPhaseDeadline(vote.savedRemainingMs, () => this.enterBandDraft());
        this.markPublic();
        this.flush(true);
        this.maybeEndInfo();
        continue;
      }
      this.setDeadline(0);
      this.cancel(this._infoAdvanceTimer);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this._anySetupVote()) this.enterBandDraft();
      });
      this.markPublic();
      this.flush(true);
    }
  }

  /** 2V2 reroll: ONLY this team's disabled core bonds (the stage / boss / factions stay shared). */
  _completeVersusReroll(team) {
    let prepared;
    try {
      const n = (this.teamRerolls.get(team) || 0) + 1;
      const rng = createRng(deriveSeed(this.seed, `reroll-bans:${team}:${n}`));
      const bans = drawDisabledBonds(this.gd, rng, { core: 5, addon: this.gd.bans(this.gd.difficulty).addon });
      const pool = new SharedPool(this.gd, { banned: bans.banned });
      if (!pool.entries.size) throw new Error('rerolled chess pool is empty');
      const off = new Set([...bans.drawn, ...bans.staticOff]);
      const stocks = new Map();
      for (const ps of this.order) if (this.teamIdOf(ps) === team) stocks.set(ps.playerId, ps.buildDiyStock(off));
      prepared = { n, bans, pool, stocks };
    } catch (e) {
      this.reportError('reroll setup', e);
      this._cancelVersusVote(team);
      return fail(ERR.INTERNAL);
    }
    const { n, bans, pool, stocks } = prepared;
    this.teamRerolls.set(team, n);
    this.teamBans.set(team, bans);
    this.pools.set(team, pool);
    const group = this.poolGroups.find((g) => g.id === team + 1);
    if (group) group.pool = pool;
    if (team === 0) this.pool = pool;
    for (const [pid, s] of stocks) {
      const ps = this.players.get(pid);
      if (!ps) continue;
      ps.diyStock = s.stock;
      ps.diyBanned = s.banned;
      ps.invalidateDeployMap();
      ps.infoReady = ps.botControlled;
      if (this.playerPools) this.playerPools.set(pid, pool);
    }
    this.setupRevision++;
    this._setSetupVote(team, null);
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    // a fresh setup needs re-confirming: give it a new window, so the briefing can never wait forever on it
    this.setDeadline(VERSUS_INFO_SECONDS, () => this.enterBandDraft());
    this.maybeEndInfo();
    return OK;
  }
}
