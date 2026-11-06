// server/match/match/unitePhaseWaves.js — Match methods for the OPTIONAL multi-wave 联防 (the SiderLock fork; the
// rules: server/match/uniteWaves.js): the UNITE phase start for a waves plan (round/roundsMax, no uniteRound), its
// continuation (_afterUniteWaves: archive the wave, then the next unused pair or settle), and the skip vote
// (uniteSkipVoteView / refreshUniteSkipVote / voteSkipUnite). Installed on Match.prototype by server/match/Match.js
// (a method container: never instantiated; `this` is the match). Inert unless the opt-in module
// server/match/uniteWaves.js has been imported: waves plans never arise while the mainline relay (unitePhase.js)
// plans the match, and the mainline startUnite only dispatches here on the plan shape.

import { PHASE, GEO, ERR } from '../../../shared/constants.js';
import { WorkerFieldRunner } from '../combat/runner.js';
import { deriveSeed } from '../../sim/rng.js';
import { FieldRunner } from '../fields.js';
import { FLOW_TICKER_PRIORITY, DELAYS, OK, fail } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onStartUnite } from '../botEmotes.js';
import { uniteWavesHook } from '../uniteWavesHook.js';

export class MatchUniteWaves {
  /** A waves plan's UNITE phase in both modes (the mainline startUnite dispatches here on the plan shape). */
  _startUniteWaves(plan) {
    if (this.capacityExperiment && !this.alivePlayers().length) { this.settle(null, null); return; }
    if (!this.clientCombat) plan.battleId = `${this.battlePrefix}.${this.round}.${++this._battleSeq}.wave${plan.round}`;
    if (this.clientCombat) { this._startUniteWavesClient(plan); return; }
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.uniteTimeLimit(plan);
    if (this.capacityExperiment && !(limit > 0)) { this.settle(plan, null); return; }
    const opts = this._uniteOptsWaves(plan, limit);
    const players = plan.helpers.map((p) => p.playerId);
    this.fields = [this.combatPool ? this._remoteField(opts, players)
      : { fieldId: opts.fieldId, kind: 'unite', players, battle: this.newBattle(opts), live: true }];
    this._beginDamage('unite');
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: plan.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
    onStartUnite(this, plan); // an AI helper says "合作愉快" once on the open of a 联防 (enabled by default; SP_BOT_EMOTES=0 silences it)
    this._uniteLeftKey = null;
    const Runner = this.combatPool ? WorkerFieldRunner : FieldRunner;
    this.runner = new Runner(this, this.fields, {
      onTick: (runner) => this._uniteTick(runner),
      onDone: (runner) => {
        if (this.phase !== PHASE.UNITE || this.runner !== runner || this.unitePlan !== plan) return;
        this._sampleDamage(true, true);
        this._flushDamage(true);
        const field = runner.fields[0];
        this._finishUniteField(plan, runner.resultOf(field), field);
      },
    });
    this._defaultWatch();
    this.markPublic();
    this.runner.start();
  }

  _startUniteWavesClient(plan) {
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.uniteTimeLimit(plan);
    if (this.capacityExperiment && !(limit > 0)) { this.settle(plan, null); return; }
    const opts = this._uniteOptsWaves(plan, limit);
    const f = this._ccField({ fieldId: opts.fieldId, kind: 'unite', players: plan.helpers.map((p) => p.playerId), opts });
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this.watchers.clear();
    this._launch([f]);
    this._beginDamage('unite');
    this._flushDamage(true);
    // helpers and everyone else (as observers, spectator seats included) simulate the same 联防 spec locally
    for (const ps of this._viewers()) {
      this.watchers.set(ps.playerId, f.fieldId);
      this._sendStart(ps.playerId, f, { watch: !f.players.includes(ps.playerId) });
    }
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: plan.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
  }

  /**
   * Battle options of a waves field: the SiderLock seeds (`u:<round>` for the first wave, then `u:<round>:<wave>`), a
   * fresh server-run battleId per wave, fieldId 'u' — every wave is a fresh battle on the round's battlefield.
   */
  _uniteOptsWaves(plan, limit) {
    const { wave, players } = uniteWavesHook.uniteBattleOpts(this, plan, limit);
    return {
      seed: deriveSeed(this.seed, plan.round > 1 ? `u:${this.round}:${plan.round}` : `u:${this.round}`),
      ...(plan.battleId ? { battleId: plan.battleId } : {}),
      kind: 'unite',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.UNITE_RECT },
      timeLimit: limit,
      players,
      spawns: this._sanitizeSpawns(wave.spawns),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: false, ...this.gd.dp },
      fieldId: 'u',
      // leaked enemies re-enter with the stats they had: the round template's stat overrides apply again
      enemyOverrides: this.wave && this.wave.overrides ? this.wave.overrides : {},
      waveId: wave.templateId,
    };
  }

  /** One waves field ended (the mainline _finishUniteField dispatches here on the plan shape): archive and continue. */
  _afterUniteWaves(plan, res, field) {
    // nextUnitePlan archives res into the continuation's history ([...plan.history, result]); the final wave's
    // result stays out of history and is combined by settle() ([...plan.history, uniteResult], SiderLock).
    const next = uniteWavesHook.nextUnitePlan(plan, res);
    if (next) {
      this.runner?.stop();
      this.runner = null;
      this._stopClientCombat();
      this.startUnite(next);
    } else this.settle(plan, res);
  }

  /** The running waves 联防 offers a skip vote to the connected manual humans (SiderLock's skip vote). */
  uniteSkipVoters() { return this.humans().filter((ps) => ps.connected && !ps.autoplay); }

  uniteSkipVoteView() {
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || plan.roundsMax == null
      || plan.round >= plan.roundsMax || !uniteWavesHook.uniteReserveHelpers(plan).length) return null;
    const eligible = this.uniteSkipVoters().map((ps) => ps.playerId);
    return { id: `unite:${this.battlePrefix}:${this.round}:${plan.round}`,
      eligible, voters: eligible.filter((pid) => plan.skipVotes.has(pid)),
      needed: Math.floor(eligible.length / 2) + 1, passed: plan.skipRemaining, open: !!this.fields[0]?.live };
  }

  /** Recompute the ballots on every electorate change (disconnect, autoplay, leave); a reached majority latches. */
  refreshUniteSkipVote() {
    if (this.emergencyFrozen) return;
    const vote = this.uniteSkipVoteView();
    if (!vote) return;
    const plan = this.unitePlan;
    plan.skipVotes = new Set(vote.voters);
    if (!plan.skipRemaining && vote.open && vote.eligible.length && vote.voters.length >= vote.needed) {
      plan.skipRemaining = true;
      this.tickerText(msg('投票通过：本轮结束后跳过后续全部联防，按剩余漏怪结算'), FLOW_TICKER_PRIORITY);
    }
    this.markPublic();
  }

  voteSkipUnite(ps, { voteId } = {}) {
    const vote = this.uniteSkipVoteView();
    if (!vote || !vote.open) return fail(ERR.WRONG_PHASE);
    if (voteId != null && voteId !== vote.id) return fail(ERR.WRONG_PHASE);
    if (!vote.eligible.includes(ps.playerId)) return fail(ERR.BAD_TARGET, 'only connected manual humans may vote');
    if (vote.passed || this.unitePlan.skipVotes.has(ps.playerId)) return OK;
    this.unitePlan.skipVotes.add(ps.playerId);
    this.refreshUniteSkipVote();
    return OK;
  }
}
