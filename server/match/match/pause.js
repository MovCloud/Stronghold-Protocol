// server/match/match/pause.js — Match methods: the pause half of the match control (matchControl.js) — freeze, resume
// (every clock and deadline shifted by the pause), the drop at the battle phase's end (with the open vote), and the
// field clocks' "now".
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { BOSS_CLOCK_MS, OK, fail } from './common.js';

export class MatchPause {
  /** Freeze all phases and server work without turning the user's solo pause on or off. */
  setEmergencyFreeze(on, { reason = 'bandwidth', since = null } = {}) {
    void since; // The match freezes at its own clock's current epoch, never at an older global detection sample.
    if (this.disposed || this.ended) return OK;
    if (on) {
      if (this.emergencyFrozen) return OK;
      this.sched.freeze();
      this.emergencyFrozen = true;
      this.emergencyFrozenAt = this.sched.gameNow();
      this.emergencyReason = String(reason || 'bandwidth');
    } else {
      if (!this.emergencyFrozen) return OK;
      const elapsed = Math.max(0, this.sched.now() - this.emergencyFrozenAt);
      this._shiftEmergencyClocks(elapsed);
      this.emergencyFrozen = false;
      this.emergencyFrozenAt = 0;
      this.emergencyReason = null;
      this.emergencyFrozenMs += elapsed;
      this.sched.resume();
      // Lifecycle events still update connected/left immediately while frozen. Apply their gameplay effects now,
      // once only, against the resumed clocks; a client that reconnected during protection keeps its authority.
      const left = [...this._emergencyLeaves];
      const lost = [...this._emergencyLostAuthorities];
      this._emergencyLeaves.clear();
      this._emergencyLostAuthorities.clear();
      this.guard(() => {
        for (const playerId of left) {
          if (this.ended) break;
          const ps = this.players.get(playerId);
          if (ps?.left) this._quit(ps);
        }
        if (!this.ended) {
          for (const playerId of lost) {
            const ps = this.players.get(playerId);
            if (this.clientCombat && ps && (ps.left || !ps.connected)) this._authorityLost(ps, ps.left ? 'left' : 'disconnect');
          }
          this.refreshDraftPriority();
          this.refreshUniteSkipVote();
          this.maybeEndInfo();
          this.maybeEndPrep();
          this._maybeFieldsDone();
        }
      });
    }
    this.markPublic();
    this.flush(true); // The emergency snapshot must not wait for a held/throttled public timer.
    return OK;
  }

  _shiftEmergencyClocks(elapsed) {
    if (this.deadline) this.deadline += elapsed;
    if (this.overtimeAt) this.overtimeAt += elapsed;
    if (this._bossStartAt != null) this._bossStartAt += elapsed;
    for (const stage of [this.draft, this.sp]) {
      for (const group of stage?.groups || []) if (group.turnDeadline) group.turnDeadline += elapsed;
    }
    for (const field of this.fields) {
      if (!field.cc || field.done) continue;
      field.startAt += elapsed;
      field.lastProgressAt += elapsed;
    }
    // Held pacing intervals retain fractional progress but must not count the protection time in their next dt.
    if (this.runner?.interval) this.runner.last += elapsed;
    if (this.pacer?.interval) this.pacer.last += elapsed;
    // The solo resume later accounts only for its own time; emergency time has already moved the same clocks.
    if (this.paused) this._pausedAt += elapsed;
  }

  /**
   * The pause (a passed match control, matchControl.js; the official PauseUp / ResumeUp): freezes the running battle —
   * the field clock (b.start `elapsed`, the boss budgets and overtime), the result deadline / server release timers,
   * the boss clock, the HUD `deadline` / `overtimeAt` (shifted by the pause on resume) and the server-run pacers
   * (FieldRunner / HeadlessPacer skip their intervals) — and the browser's runner stops its local clock while
   * `m.public.paused` is true. Authorization comes from the vote, not from this method: every connected human has
   * already agreed (or was the only one). Only while a battle runs; `{ on: false }` is always accepted. A disconnect /
   * leave, or the battle phase ending, resumes.
   */
  setPause(ps, on) {
    void ps;
    if (!on) { this._resume(); return OK; }
    if (this.paused) return OK;
    const battlePhase = this.phase === PHASE.COMBAT || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE;
    if (!battlePhase || this._finalEnding || !this.fields.some((f) => f.live && !f.done)) return fail(ERR.WRONG_PHASE, 'no battle running');
    this.paused = true;
    this._pausedAt = this.sched.gameNow();
    for (const f of this.fields) {
      if (!f.cc) continue;
      if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; f.rearmDeadline = true; }
      if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; f.rearmRelease = true; }
    }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    this._sampleDamage(true);
    this._flushDamage(true);
    this.markPublic();
    return OK;
  }

  /** End a solo pause: every clock and deadline moves on by the paused time (no-op when not paused). */
  _resume() {
    if (!this.paused) return;
    const d = Math.max(0, this.sched.gameNow() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.pausedMs += d;
    if (this.deadline) this.deadline += d;
    if (this.overtimeAt) this.overtimeAt += d;
    if (this._bossStartAt != null) this._bossStartAt += d;
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      f.startAt += d;
      f.lastProgressAt += d;
      if (f.rearmDeadline && f.mode === 'client') this._armDeadline(f);
      if (f.rearmRelease && f.mode === 'server') this._armRelease(f);
      f.rearmDeadline = false;
      f.rearmRelease = false;
    }
    // The 1 Hz progress ticker of a frozen match parked on `_progressWanted`: give it its next tick
    // exactly once (`_armProgressTicker` is a no-op while a tick is already armed).
    if (this._progressWanted) { this._progressWanted = false; this._armProgressTicker(); }
    for (const f of this.fields.filter((x) => x.verifying && x.resultSource === 'verified' && x.result)) {
      f.verifying = false;
      this._fieldDone(f);
    }
    if (this._bossClockOn && !this._bossClock && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE)) {
      this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    }
    if (this.runner?.remote) this.runner.resume();
    this.markPublic();
  }

  /** The battle phase is over: drop the pause without shifting anything (its timers are gone), and the open control. */
  _clearPause() {
    this.cancelMatchControl('battleEnd');
    if (!this.paused) return;
    this.pausedMs += Math.max(0, this.sched.gameNow() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.markPublic();
  }

  /** The field clocks' "now": frozen at the pause instant while paused. */
  _clockNow() { return this.paused ? this._pausedAt : this.sched.gameNow(); }
}
