// server/match/match/matchControl.js — Match methods: the three battle controls (比赛控制) a player may request — the
// pause, the fast-forward toggle and the one-shot 跳过. Every one is a request the connected humans must all agree to
// (g.matchControl { action } proposes, g.matchControlBallot { voteId, agree } answers); when the match has no other
// connected human — a solo run, or humans only against AI seats — the server applies it directly, so the protocol
// shape stays the same in every match. A voter that disconnects or leaves is dropped and the vote is recounted; a vote
// that times out is treated as a refusal. The proposer's agree:false withdraws it. One control at a time per match,
// with a 300 ms burst guard per proposing player.
//
// A passed control is applied by the server and the new state is pushed as m.public (paused / speed); the client's
// battle runner follows it like it follows the pause. The end time of every running battle is recomputed from the
// game seconds still left at the new speed (setGameSpeed re-anchors each field's startAt), and the HUD deadline /
// overtime are scaled by oldSpeed/newSpeed.
// Everything here is transient: a checkpoint restore drops it (server/match/snapshot.js MATCH_FIELDS).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR, MATCH_CONTROL_ACTIONS, PLAYBACK } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

/** How long a match control stays open (ms, × timerScale). */
export const MATCH_CONTROL_MS = 30_000;
/** The phases a control may be requested in: a battle must be running. */
const CONTROL_PHASES = new Set([PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

export class MatchControl {
  /** The connected humans a control needs: every one of them (unanimous), the proposer included. */
  matchControlVoters() { return this.humans().filter((p) => p.connected).map((p) => p.playerId); }

  /** A battle is running: the field clocks have something to freeze or to speed up. */
  controlBattleRunning() { return !this._finalEnding && this.fields.some((f) => f.live && !f.done); }

  /** g.matchControl { action } */
  requestMatchControl(ps, action) {
    if (!MATCH_CONTROL_ACTIONS.includes(action)) return fail(ERR.BAD_MSG, 'unknown control action');
    // `{ action: 'resume' }` when nothing is paused is a no-op and is always accepted (like g.pause on:false)
    if (action === 'resume' && !this.paused) return OK;
    if (!CONTROL_PHASES.has(this.phase)) return fail(ERR.WRONG_PHASE);
    if (ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (this.matchControl) return fail(ERR.WRONG_PHASE, 'match control vote in progress');
    if (!this.controlBattleRunning()) return fail(ERR.WRONG_PHASE, 'no battle running');
    if (action === 'skip' && this.gameSpeed === PLAYBACK.SKIP) return fail(ERR.ALREADY, 'already at the 60x speed');
    const now = this.sched.now();
    if (now - (this._matchControlAt.get(ps.playerId) ?? -Infinity) < 300) return fail(ERR.RATE);
    this._matchControlAt.set(ps.playerId, now);
    const voters = this.matchControlVoters();
    const ms = this.scaled(MATCH_CONTROL_MS);
    const vote = this.matchControl = {
      id: ++this._matchControlSeq,
      action,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      rejected: new Set(),
      // unanimous: every connected human must agree. One voter left (a solo run, humans only against AI seats) is
      // already unanimous, so the server applies it directly.
      need: voters.length,
      deadline: now + ms,
      timer: null,
    };
    this.log.info?.(`[match ${this.roomCode}] seat ${ps.seat} requests ${action} (R${this.round}, ${voters.length} voter(s))`);
    vote.timer = this.later(ms, () => {
      if (this.matchControl !== vote) return;
      vote.timer = null;
      this._failMatchControl('timeout');
    });
    return this._settleMatchControl();
  }

  /** g.matchControlBallot { voteId, agree } */
  answerMatchControl(ps, voteId, agree) {
    const vote = this.matchControl;
    if (!vote) return fail(ERR.WRONG_PHASE);
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'match control vote changed');
    if (!ps.connected || ps.left || !vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    // the proposer saying no withdraws the request
    if (!agree && ps.playerId === vote.proposerId) { this.cancelMatchControl('withdrawn'); return OK; }
    if (agree) { vote.agreed.add(ps.playerId); vote.rejected.delete(ps.playerId); }
    else { vote.rejected.add(ps.playerId); vote.agreed.delete(ps.playerId); }
    return this._settleMatchControl();
  }

  /**
   * A voter disconnected or left: dropped and recounted (a disconnected human's silence is never consent). A voter
   * back online counts again but has to answer once more — the ballot it cast while away stands for nothing.
   */
  _matchControlMemberGone(playerId, reconnected = false) {
    const vote = this.matchControl;
    if (!vote) return;
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot) return;
    if (reconnected) {
      if (!ps.connected || vote.voters.includes(playerId)) return;
      vote.voters.push(playerId);
    } else {
      if (!vote.voters.includes(playerId)) return;
      vote.voters = vote.voters.filter((id) => id !== playerId);
      vote.agreed.delete(playerId);
      vote.rejected.delete(playerId);
    }
    if (!vote.voters.length) { this.cancelMatchControl('empty'); return; }
    vote.need = vote.voters.length;
    this._settleMatchControl();
  }

  _settleMatchControl() {
    const vote = this.matchControl;
    if (!this.controlBattleRunning()) { this.cancelMatchControl('battleEnd'); return OK; }
    if (vote.agreed.size >= vote.need) {
      this._endMatchControl();
      const res = this.applyMatchControl(vote.action, vote.proposerId);
      if (res !== OK) {
        this.broadcast({ t: 'm.notice', kind: 'controlCancelled', voteId: vote.id, action: vote.action, reason: res.detail || 'rejected' });
        this.markPublic();
        this.flush(true);
        return res;
      }
      this.log.info?.(`[match ${this.roomCode}] control ${vote.action} passed ${vote.agreed.size}/${vote.need} (R${this.round})`);
      // `solo` (the same soloUntimed rule as the untimed phases) tells the client that no vote happened: one human
      // applied it directly, so its notice must not read as a passed vote. `speed` is the resulting playback speed
      // (2× / 60× / back to 1×) the solo notice names.
      this.broadcast({ t: 'm.notice', kind: 'controlPassed', voteId: vote.id, action: vote.action,
        agreed: vote.agreed.size, need: vote.need, solo: this.soloUntimed, speed: this.gameSpeed });
      this.markPublic();
      this.flush(true);
      return OK;
    }
    if (vote.voters.length - vote.rejected.size < vote.need) { this._failMatchControl('rejected'); return OK; }
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /** Rejected or timed out: the request is refused, nothing is applied. */
  _failMatchControl(reason) {
    const vote = this._endMatchControl();
    if (!vote) return;
    this.broadcast({ t: 'm.notice', kind: 'controlRejected', voteId: vote.id, action: vote.action, reason });
    this.markPublic();
    this.flush(true);
  }

  /**
   * `reason` (m.notice controlCancelled): 'withdrawn' (the proposer), 'empty' (no voter left), 'battleEnd' (the battle
   * the control was requested for is over).
   */
  cancelMatchControl(reason) {
    const vote = this._endMatchControl();
    if (!vote || this.disposed) return;
    this.broadcast({ t: 'm.notice', kind: 'controlCancelled', voteId: vote.id, action: vote.action, reason });
    this.markPublic();
    this.flush(true);
  }

  _endMatchControl() {
    const vote = this.matchControl;
    if (!vote) return null;
    this.matchControl = null;
    this.cancel(vote.timer);
    return vote;
  }

  /**
   * A passed control, applied by the server: the pause / resume go through pause.js, the speed through setGameSpeed.
   * `fast` toggles (2× → 1× when it is already the fast-forward, otherwise 2×); `skip` is the one-shot 60×.
   */
  applyMatchControl(action, proposerId) {
    const ps = this.players.get(proposerId);
    if (action === 'pause') return this.setPause(ps, true);
    if (action === 'resume') return this.setPause(ps, false);
    const next = action === 'skip' ? PLAYBACK.SKIP : (this.gameSpeed === PLAYBACK.FAST ? PLAYBACK.NORMAL : PLAYBACK.FAST);
    if (next === this.gameSpeed) return fail(ERR.ALREADY, 'speed unchanged');
    this.setGameSpeed(next);
    return OK;
  }

  /**
   * Change the playback speed and recompute every end time from the game seconds still left. Game-second progress is
   * unchanged (`f.result.time` / `f.endGt` are game seconds), so each running field is re-anchored at
   * `now − (elapsed / newSpeed) × 1000`: its result deadline / release timer then lands `remaining game seconds /
   * newSpeed` from now. `gameSpeed` must be set before re-arming, because `_armDeadline` and `_armRelease` read it.
   * The HUD `deadline`, `overtimeAt` and the boss clock anchor are scaled by oldSpeed/newSpeed (they are real-clock
   * timestamps of the same game-second budget). While paused the clocks stay frozen and the timers are re-armed on
   * resume (pause.js), exactly like `_assignClient` does.
   */
  setGameSpeed(newSpeed) {
    const old = this.gameSpeed;
    if (newSpeed === old) return;
    const now = this._clockNow();
    const plan = this.fields.filter((f) => f.cc && !f.done).map((f) => ({ f, elapsed: this._fieldElapsed(f) }));
    this.gameSpeed = newSpeed;
    for (const { f, elapsed } of plan) {
      const next = now - Math.round((elapsed / newSpeed) * 1000);
      const shift = next - f.startAt;
      f.startAt = next;
      if (Number.isFinite(f.lastProgressAt)) f.lastProgressAt += shift;
      // a boss / hidden field has no result deadline of its own (bossRounds.js paces it by the boss clock)
      if (f.kind === 'boss' || f.kind === 'hidden') continue;
      if (this.paused) {
        if (f.mode === 'client') f.rearmDeadline = true;
        else if (f.mode === 'server') f.rearmRelease = true;
      } else if (f.mode === 'client') this._armDeadline(f);
      else if (f.mode === 'server') this._armRelease(f);
    }
    const scale = old / newSpeed;
    const anchor = (t) => (Number.isFinite(t) && t > 0 ? now + Math.round((t - now) * scale) : t);
    this.deadline = anchor(this.deadline);
    this.overtimeAt = anchor(this.overtimeAt);
    if (Number.isFinite(this._bossStartAt) && this._bossStartAt > 0) this._bossStartAt = anchor(this._bossStartAt);
    // the 联防 budget display (unitePhase.js) reports the speed it was opened with
    if (this.unitePlan) this.unitePlan.gameSpeed = newSpeed;
    this.markPublic();
  }

  matchControlView() {
    const v = this.matchControl;
    if (!v || this.ended) return null;
    return { id: v.id, action: v.action, proposerId: v.proposerId, voters: v.voters.slice(), agreed: [...v.agreed],
      rejected: [...v.rejected], need: v.need, deadline: v.deadline };
  }
}
