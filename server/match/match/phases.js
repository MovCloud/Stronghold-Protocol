// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: one countdown of BAND_TURN_SECONDS per turn, 队友已选, the highlighted strategy on a timeout, skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { buildNormalWave, buildBossWave } from '../waves.js';
import { pairPlayers, bossPairSalt } from '../finalAssault.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { OK, fail, DELAYS, BAND_TURN_SECONDS } from './common.js';
import { ROUND_BEACON_ITEM, fixedBeaconSupplyRound } from '../beaconSupply.js';

/** Single-pool diagnostics and old fixtures keep their readable/writable first-group fields. */
export function installDraftFacade(stage, fields) {
  for (const field of fields) Object.defineProperty(stage, field, {
    enumerable: true,
    get() { return this.groups[0]?.[field]; },
    set(value) { if (this.groups[0]) this.groups[0][field] = value; },
  });
  return stage;
}

export class MatchPhases {
  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: 45 s (the official 25 s + 20 s, tools/build-data.mjs)
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.phase !== PHASE.INFO_CHECK || this._anySetupVote() || this._infoAdvanceTimer) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this._anySetupVote()) this.enterBandDraft();
      });
    }
  }

  /**
   * The strategy draft (user playtest #4 item 4): ONE countdown — every turn has the same clock, BAND_TURN_SECONDS, and
   * m.public.deadline is the current turn's end (= draft.turnDeadline; the step header and the turn indicator show the
   * same number). No separate step cap: the turns bound the step (≤ (seats + skips) × turn). AI seats pick at once — one
   * the host designated a strategy for (room.setBotBand) takes that one, held for it until then (bandTaken). A
   * turn that runs out takes the strategy the player has highlighted (g.bandFocus) while it is free, else the default
   * (timeoutBand). Solo, and any single-human match (soloUntimed): untimed. Solo also keeps seat order and has no skip.
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    // The opening is settled, so no reroll cooldown outlives this phase.
    this._rerollStartAt.clear();
    const concurrent = this.concurrentDraft();
    if (concurrent) {
      // the expanded-capacity room's flat draft: every seat picks at once, one step countdown (concurrentDraft)
      let order = this.order.map((p) => p.playerId);
      if (!this.isSolo) this.rngDraft.shuffle(order);
      order = this.humansFirst(order);
      this.draft = {
        order, idx: 0, picks: {}, skipsLeft: {}, untimed: this.soloUntimed, turnDeadline: 0, concurrent: true,
        /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
        focus: new Map(),
      };
      this.setDeadline(0);
      this.startDraftTurn();
      this.markPublic();
      this._checkpoint('band-draft');
      return;
    }
    // the fixed pool groups (SiderLock 分组卡池 / Rosmontis parallel drafts): each group draws its own order and the
    // groups pick in parallel — one page, one countdown and group-local 队友已选 per group (installDraftFacade keeps the
    // readable/writable first-group fields for single-pool diagnostics and old fixtures)
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const groups = this.makeDraftGroups();
    for (const g of groups) g.skipsLeft = Object.fromEntries(g.order.map((pid) => [pid, skips]));
    this.draft = installDraftFacade({
      id: this.nextDraftId('band'), groups, picks: {}, untimed: this.soloUntimed,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    }, ['order', 'idx', 'skipsLeft', 'turnDeadline']);
    this.setDeadline(0);
    for (const g of groups) this.startDraftTurn(g);
    this.markPublic();
    this._checkpoint('band-draft');
  }

  /**
   * Whether this match's drafts — the strategy draft and 机变 — are made by every seat at once (`draft.concurrent` /
   * `sp.concurrent`): the expanded-capacity rooms, where repeats are allowed and a pick takes nothing from another seat
   * but equipment stock (the owner's request of 2026-10-16: with up to 20 seats the turns took minutes). One countdown
   * for the whole step (strategy: BAND_TURN_SECONDS, 机变: spFirst); whoever is still deciding when it runs out gets
   * what a turn that runs out gives; no skip; AI seats pick at once — with 「AI 队友最后选择」 once no human is still
   * deciding (_botMayPick). The step ends as soon as nobody is left to decide.
   */
  concurrentDraft() { return !!this.capacityExperiment && !this.isSolo; }

  /** 「AI 队友最后选择」 in a concurrent draft: an AI seat picks once none of `deciding` is a human. */
  _botMayPick(ps, deciding) { return !this.aiPicksLast || !ps.isBot || !deciding.some((p) => p && !p.isBot); }

  /**
   * The co-op room option 「AI 队友最后选择」 (this.aiPicksLast, GitHub #338): every human seat before every AI seat, each
   * group in the order the draft drew (a stable partition applied AFTER the shuffle — no extra random draw: the order
   * with the option off is unchanged, and with it on every random stream stands where it would without it; only the
   * picks made in the new order can differ). A human is any seat that is not an AI seat (room.addBot): under AI 托管,
   * disconnected or departed it still counts as a human. Used by the strategy draft and the 机变 draft
   * (MatchSpDraft.enterSpDraft).
   * @param {string[]} order playerIds in drawn order
   * @returns {string[]}
   */
  humansFirst(order) {
    if (!this.aiPicksLast) return order;
    const bot = (pid) => !!this.players.get(pid)?.isBot;
    return [...order.filter((pid) => !bot(pid)), ...order.filter(bot)];
  }

  /** A stage identity must not consume the chess/equipment uid stream (MatchSpDraft.enterSpDraft). */
  nextDraftId(kind) { return `${kind}:${this.battlePrefix}:${this.round}:${++this.draftSeq}`; }

  /**
   * The fixed pool groups (SiderLock 分组卡池 / Rosmontis parallel drafts): the poolGroups partition stays fixed for the
   * whole match; this stage's copy of each group only narrows to the seats with a turn. `living` (a 机变 stage) drops
   * every seat already eliminated at the stage's start — a group keeps its fixed membership (playerIds) either way.
   */
  makeDraftGroups({ shuffle = true, living = false } = {}) {
    return this.poolGroups.map(({ id, playerIds }) => {
      // The strategy draft draws over the whole group — upstream enterBandDraft takes `this.order`, so the order IS the
      // seats and a departed one keeps its place to be skipped on turn. The 机变 draft draws over the group's living
      // seats only (upstream enterSpDraft: `alivePlayers()`; audit.js checks that order length against the alive count).
      let order = living
        ? playerIds.filter((pid) => { const ps = this.players.get(pid); return ps && ps.alive; })
        : playerIds.slice();
      if (shuffle) {
        if (!this.isSolo) this.rngDraft.shuffle(order);
        order = this.humansFirst(order);
      }
      return { id, playerIds: playerIds.slice(), order, idx: 0, picks: {}, untimed: this.soloUntimed,
        turnDeadline: 0, turnSeconds: 0, timer: null, token: 0, done: !order.length };
    });
  }

  draftGroup(playerId = null) {
    const groups = this.draft?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  /** Optional request metadata prevents a stale stage or a read-only other-group page being submitted. */
  draftTargetError(stage, group, { draftId, groupId } = {}) {
    if (draftId != null && draftId !== stage.id) return fail(ERR.WRONG_PHASE);
    if (!group || (groupId != null && groupId !== group.id)) return fail(ERR.BAD_TARGET);
    return null;
  }

  clearDraftGroupTimer(group) {
    this.cancel(group.timer);
    group.timer = null;
    group.turnDeadline = 0;
    group.turnSeconds = 0;
    group.token++;
  }

  syncDraftDeadline(stage) {
    // A shared public frame cannot have one current-turn countdown for multiple parallel groups.
    this.deadline = stage.groups.length === 1 ? stage.groups[0].turnDeadline || 0 : 0;
  }

  /** Re-kick the seats on turn after a pause resumed or a 托管 change (the drawn order itself never changes). */
  refreshDraftPriority() {
    if (this.emergencyFrozen) return;
    const d = this.phase === PHASE.BAND_DRAFT ? this.draft : this.phase === PHASE.SP_DRAFT ? this.sp : null;
    if (!d || d.concurrent || !d.groups?.length) return;
    for (const g of d.groups) {
      if (g.done) continue;
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.botControlled && !d.picks[ps.playerId]) {
        if (this.phase === PHASE.BAND_DRAFT) this.scheduleBandBot(g);
        else this.scheduleSpBot(g);
      }
    }
  }

  /** The seat whose turn it is in `playerId`'s group (no argument: the first group's); null when concurrent. */
  draftTurn(playerId = null) {
    const d = this.draft;
    if (!d || d.concurrent) return null;
    if (d.groups?.length) {
      const g = playerId == null ? d.groups[0] : d.groups.find((x) => x.playerIds.includes(playerId)) || null;
      return g && !g.done ? g.order[g.idx] ?? null : null;
    }
    return d.order[d.idx] ?? null; // the flat draft of an expanded solo room
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn(group = this.draftGroup()) {
    const d = this.draft;
    if (d?.concurrent) { this._concurrentBandStep(); return; }
    if (d.groups?.length) {
      // the fixed pool groups (SiderLock 分组卡池): each group runs its own turn order and its own countdown in
      // parallel; the pick itself is group-local (bandTaken), the global map only mirrors it for the old fixtures
      const g = group;
      if (!g) return;
      this.clearDraftGroupTimer(g);
      while (g.idx < g.order.length) { // loop-cap: bounded by g.order.length
        const ps = this.players.get(g.order[g.idx]);
        if (ps && ps.alive && !ps.left && !d.picks[ps.playerId]) break;
        g.idx++;
      }
      g.done = g.idx >= g.order.length;
      if (g.done) {
        this.syncDraftDeadline(d);
        this.markPublic();
        if (d.groups.every((x) => x.done) && !d.finishPending) {
          d.finishPending = true;
          this.later(0, () => {
            if (this.draft === d && this.phase === PHASE.BAND_DRAFT && d.groups.every((x) => x.done)) this.finishBandDraft(false);
          });
        }
        return;
      }
      const token = g.token;
      if (!g.untimed) {
        const ms = this.bandTurnMs();
        g.turnSeconds = ms / 1000;
        g.turnDeadline = this.sched.now() + ms;
        g.timer = this.later(ms, () => {
          if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
          const pid = this.draftTurn(g.playerIds[0]);
          if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
        });
      }
      this.syncDraftDeadline(d);
      const cur = this.players.get(g.order[g.idx]);
      if (cur && cur.botControlled) this.scheduleBandBot(g);
      this.markPublic();
      return;
    }
    // the flat draft of an expanded solo room: the original single-order turns
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    if (this.test) this.setDeadline(0);
    while (d.idx < d.order.length && d.picks[d.order[d.idx]]) d.idx++; // loop-cap: draft order
    if (d.idx >= d.order.length) {
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      return;
    }
    const token = ++this._turnToken;
    if (!d.untimed) {
      const ms = this.bandTurnMs();
      d.turnDeadline = this.sched.now() + ms;
      // the step's countdown IS the turn's (one number everywhere)
      this.deadline = d.turnDeadline;
      const expire = () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        const pid = this.draftTurn();
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      };
      if (this.test) { this.setDeadline(ms / 1000 / (this.timerScale || 1), expire); d.turnDeadline = this.deadline; }
      else this._turnTimer = this.later(ms, expire);
    } else {
      d.turnDeadline = 0;
      this.deadline = 0;
    }
    const cur = this.players.get(this.draftTurn());
    if (cur && cur.botControlled) this.scheduleBandBot();
    this.markPublic();
  }

  /**
   * A concurrent strategy draft (concurrentDraft) at its start and after each pick: ends once every seat has picked;
   * else arms the step's one countdown (the first time) and lets every AI / AI 托管 seat still deciding pick.
   */
  _concurrentBandStep() {
    const d = this.draft;
    if (d.done) return;
    if (d.order.every((pid) => d.picks[pid])) {
      d.done = true;
      this.cancel(this._turnTimer);
      this._turnTimer = null;
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      this.markPublic();
      return;
    }
    if (!d.armed) {
      d.armed = true;
      const token = ++this._turnToken;
      if (!d.untimed) {
        const ms = this.bandTurnMs();
        d.turnDeadline = this.sched.now() + ms;
        this.deadline = d.turnDeadline;
        this._turnTimer = this.later(ms, () => {
          if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken || this.draft !== d) return;
          // whoever is still deciding: the highlighted strategy, else the default (timeoutBand), in draft order
          for (const pid of d.order) if (!d.picks[pid] && this.players.get(pid)) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
        });
      } else {
        d.turnDeadline = 0;
        this.deadline = 0;
      }
    }
    const deciding = d.order.filter((pid) => !d.picks[pid]).map((pid) => this.players.get(pid));
    for (const ps of deciding) if (ps && ps.botControlled && this._botMayPick(ps, deciding)) this.scheduleBandBot(ps);
    this.markPublic();
  }

  /**
   * An AI seat's (or an AI 托管 seat's) turn: it picks at once (user playtest #4 item 4 — nobody waits on the AI). A
   * concurrent draft names the seat (`target`; once per seat while one is queued).
   */
  scheduleBandBot(target = null) {
    const d = this.draft;
    if (d?.concurrent) {
      const token = this._turnToken;
      if (!target || d.botQueued?.has(target.playerId)) return;
      (d.botQueued ||= new Set()).add(target.playerId);
      this.later(0, () => {
        d.botQueued.delete(target.playerId);
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken || this.draft !== d) return;
        const ps = target;
        if (!ps || !ps.botControlled || d.picks[ps.playerId]) return;
        this._botBandPick(ps);
      });
      return;
    }
    if (!d || !d.groups?.length) {
      // the flat draft of an expanded solo room: the seat on turn picks
      const token = this._turnToken;
      this.later(0, () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken || this.draft !== d) return;
        const ps = this.players.get(this.draftTurn());
        if (!ps || !ps.botControlled || d.picks[ps.playerId]) return;
        this._botBandPick(ps);
      });
      return;
    }
    const g = target && target.playerId ? this.draftGroup(target.playerId) : (target || this.draftGroup());
    if (!d || !g || g.done) return;
    const token = g.token;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled || d.picks[ps.playerId]) return;
      const fallback = () => this._botBandPick(ps);
      if (this.bot.decide?.(this, ps, { kind: 'band',
        valid: () => this.phase === PHASE.BAND_DRAFT && token === g.token,
        complete: () => token !== g.token || !!this.draft?.picks[ps.playerId], fallback })) return;
      fallback();
    });
  }

  /** An AI / AI 托管 seat's band pick: the designated strategy (room.setBotBand) first, then a re-draw past 队友已选. */
  _botBandPick(ps) {
    const own = this.designatedBand(ps);
    if (own) { this._applyBand(ps, own, { dedupe: true }); return; }
    let id = this.bot.pickBand(this, ps);
    for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = this.bot.pickBand(this, ps);
    if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    this._applyBand(ps, id, { dedupe: true });
  }

  /**
   * Whether `bandId` was already picked by another player of this draft. Research 09 §5 / DESIGN §14 corrections:
   * the strategy draft marks a teammate's pick as 队友已选 and it cannot be chosen again (co-op). The automatic
   * assignments — a turn that runs out and a departing seat — obey the same rule: see timeoutBand / defaultBand.
   * A strategy the host designated for an AI seat (room.setBotBand, this.botBands) counts as taken for everybody else
   * until that seat picks it (reservedBands). Expanded-capacity rooms allow repeats, even with four or fewer
   * participants/survivors (nothing is held there either: the AI seat takes its strategy all the same).
   */
  bandTaken(bandId, playerId) {
    if (this.capacityExperiment) return false;
    // group-local 队友已选: a group-mate's pick (parallel groups may repeat a band across groups); a botBands
    // designation still blocks everybody until its AI seat picks (d.picks is the global mirror).
    // 2V2: a strategy is unique per TEAM — the opposing team's pick never blocks.
    const picks = this.draftGroup(playerId)?.picks || this.draft?.picks || {};
    const team = this.isVersus ? this.teamIdOf(this.players.get(playerId)) : null;
    const otherTeam = (pid) => this.isVersus && this.teamIdOf(this.players.get(pid)) !== team;
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId && !otherTeam(pid)) return true;
    for (const [pid, id] of this.botBands || []) if (pid !== playerId && id === bandId && !this.draft?.picks[pid] && !otherTeam(pid)) return true;
    return false;
  }

  /**
   * The designated strategies still held (room.setBotBand): bandId → the AI seat's playerId, for every AI seat that has
   * not picked yet; {} in an expanded-capacity room (repeats allowed). m.public draft.reserved.
   * @returns {Record<string, string>}
   */
  reservedBands() {
    const out = {};
    if (this.capacityExperiment) return out;
    const picks = this.draft?.picks || {};
    for (const [pid, id] of this.botBands || []) if (!picks[pid]) out[id] = pid;
    return out;
  }

  /**
   * The strategy the host designated for this AI seat (room.setBotBand) while it can take it — allowed by the mode and
   * held by nobody else —, else null (the seat picks as without the option).
   * @param {any} ps
   * @returns {string | null}
   */
  designatedBand(ps) {
    const id = ps && this.botBands?.get(ps.playerId);
    return id && this.gd.bandAllowed(id) && !this.bandTaken(id, ps.playerId) ? id : null;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no teammate holds it, else the
   * first strategy of the mode (sortId order, gd.bandIds) that nobody else picked — never a duplicate (队友已选; the
   * client shows the same choice: public/js/screens/bandDraft.js timeoutBand). Solo drafts have no teammates, so it is
   * always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId) && (!this.disableDuckLord || this.gd.bandAllowed(def))) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || (this.disableDuckLord ? this.gd.defaultBandId : def);
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the draft
   * screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no teammate holds
   * it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const f = this.draft && this.draft.focus instanceof Map ? this.draft.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (!d.concurrent) {
      // the grouped draft validates the seat's group / draft id (SiderLock); the concurrent flat draft has neither
      const targetError = this.draftTargetError(d, this.draftGroup(ps.playerId), opts);
      if (targetError) return targetError;
    }
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!d.concurrent) {
      const targetError = this.draftTargetError(d, this.draftGroup(ps.playerId), opts);
      if (targetError) return targetError;
    }
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (!d.concurrent && this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    if (!d || !ps || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    const g = d.concurrent ? null : this.draftGroup(ps.playerId);
    if (g) g.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn(d.concurrent ? null : g);
  }

  skipBand(ps, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (d.concurrent) return fail(ERR.WRONG_PHASE, 'no skip when everybody picks at once');
    const g = this.draftGroup(ps.playerId);
    const targetError = this.draftTargetError(d, g, opts);
    if (targetError) return targetError;
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(g.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (g.order.length - g.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    g.skipsLeft[ps.playerId]--;
    g.order.splice(g.idx, 1);
    // the skipper goes to the end; with 「AI 队友最后选择」 to the end of the humans still to pick — behind them, ahead of
    // the AI seats — and to the very end only when no other human is left to pass to [ASSUMED: the option's intent,
    // humans before AI, kept through a skip; no source, a remake option]
    let at = g.order.length;
    if (this.aiPicksLast) {
      for (let j = g.order.length - 1; j >= g.idx; j--) {
        if (!this.players.get(g.order[j])?.isBot) { at = j + 1; break; }
      }
    }
    g.order.splice(at, 0, ps.playerId);
    this.startDraftTurn(g);
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    if (this.draft.groups) for (const g of this.draft.groups) this.clearDraftGroupTimer(g);
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    for (const ps of this.order) {
      if (!this.draft.picks[ps.playerId]) {
        // one after another in seat order, so each default sees the ones assigned before it (no duplicates); an AI seat
        // with a designated strategy (room.setBotBand) takes that one
        const id = this.designatedBand(ps) || this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        const g = this.draftGroup(ps.playerId);
        if (g) g.picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    // 2V2: every seat now holds a band, so the teams' shared HP pools (Σ of the members' band HP) can be built
    if (this.isVersus) this.initTeamHp();
    void timeout;
    this.enterBattleCheck();
  }

  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.afterBattleCheck(), { silent: this.soloUntimed });
    this.markPublic();
  }

  /**
   * BATTLE_CHECK is over: R1 is about to begin. A plugin window declared at `battleCheck` for this round opens here —
   * "before the round begins", the host's own step first (docs/PLUGINS.md §10b) — and holds R1 back until it closes; a
   * content set without a window continues exactly as before (`openOfferWindow` returns before it touches anything).
   */
  afterBattleCheck() {
    this.startRound(1);
  }

  startRound(r, afterStart = null) {
    this._freezeDamage(false); // PREP retains the completed scope; never reset scores when boards change.
    this._finalizePendingDeaths(); // also protects forced/cancelled transitions that bypass afterSettle
    // Every round, including boss rounds. [ASSUMED] Expire nonblocking windows at the next round.
    for (const w of this.offerWin) this._closeOffer(w);
    this.offersDispose(); // A test-console round jump must discard the older continuation too.
    const step = () => { this._startRoundAfterOffers(r); afterStart?.(); };
    if (this.openOfferWindow('battleCheck', r) !== 'open') { step(); return; }
    this._offerResume = step;
  }

  _startRoundAfterOffers(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    this.fields = [];
    this.watchers.clear();
    // Every round starts at the room rule's speed (Match.defaultSpeed): a 快进 or 60× skip covers only the battle it was
    // voted in, so the next round votes again (user report: one passed skip made every later round 60×).
    if (this.gameSpeed !== this.defaultSpeed) this.setGameSpeed(this.defaultSpeed);
    this._flushDamage(true); // no-field prep may view the complete frozen scope, including a former boss group
    this.unitePlan = null;
    this.unitePlans = null;
    this._normalAliveCount = 0;
    this._uniteRelay = null;
    this._revival = null;
    this.uniteResultView = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    this.bossPairsRound = null;
    // 同盟狩猎 plans never survive a round (a no-op while coopHuntOn is off)
    this._coopHuntPlans = null;
    this._coopHuntRound = 0;
    // a 投放公示 never survives a round (a new round starts only after the previous battle / settle)
    this.confrontStage = null;
    this.coopRoster = false;
    // 2V2: the previous round's 对抗期 must not leak into this round's PREP / views / wave (enterConfront rebuilds them)
    this.confront = null;
    this.confrontSubs = null;
    this.confrontTargets = null;
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    const isBoss = this.isBossRound(r);
    if (isBoss) {
      this._planBossWaves();
    } else {
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, r);
      // 同盟狩猎: each alive player's prey for this 狩猎期 — planned once, from the round's shared wave, before any
      // preview or deployment (a no-op on R1–R(start−1) and in every non-coop mode)
      if (this.coopHuntActive()) this.coopHuntPlans();
    }
    for (const ps of alive) ps.startRound(r);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    if (fixedBeaconSupplyRound(this, r)) {
      for (const ps of alive) {
        // Count a supply only once even if a client reconnects or the round entry is repeated.
        const key = `sixPlayerBeacon:${r}`;
        if (ps.counters[key]) continue;
        ps.counters[key] = 1;
        ps.acquireItem(ROUND_BEACON_ITEM, { source: 'sixPlayerBeacon' });
      }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
    // eliminated humans and spectator seats scout the board of the player they follow through the round's prep, not
    // their own empty board (community report of 2026-10-06, item 56; MatchWatch._followScout)
    for (const ps of this._viewers()) this._followScout(ps);
  }

  /** The round's pairs and their templates, generated before the prep preview / board validation. */
  _planBossWaves() {
    const r = this.round;
    const hidden = r === this.gd.hiddenRound && r !== this.gd.bossRound;
    const bossId = hidden ? this.hiddenBossId : this.bossId;
    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness. The Hidden Core
    // draws its pairs and sides anew (GitHub #845: the official R15 of BV1VCXyBjEN1 p1 pairs 1-2 / 3-4 after an R14 of
    // 1-4 / 2-3; DESIGN §35.27, superseding §30.12's kept partners) from a stream of its own, so the Final Assault's
    // draw is unchanged; a player who changes half keeps the board (bossFieldPlacement mirrors it, the halves' deploy
    // maps are identical). Only the round's first plan draws anew: a re-plan after a departure in its round start, 机变
    // draft or prep (platform.js _quit) keeps the intact pairs and re-pairs the orphan, as the Final Assault does.
    const fresh = hidden && this.bossPairsRound !== r;
    const rng = createRng(deriveSeed(this.seed, bossPairSalt(this.gd, r)));
    const groups = this.bossPairGroups(this.alivePlayers(), rng, fresh ? null : this.bossPairs);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    this.bossPairsRound = r;
    this.bossWaves = groups.map((g) => ({
      players: g.map((p) => p.playerId),
      wave: buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1 }),
    }));
  }

  afterRoundStart() {
    // 2V2 事件期 (eventRoundsFor): one entry per player before the round's 机变 / 休整期 (server/match/match/event.js)
    if (this.eventDue()) { this.enterEvent(); return; }
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.beforePrepOffers();
  }

  beforePrepOffers() {
    // The official round start and its draw/draft finish first; only entering prep waits.
    this.sp = null;
    const step = () => this.enterPrep();
    if (this.openOfferWindow('prep', this.round) !== 'open') { step(); return; }
    this._offerResume = step;
  }
}
