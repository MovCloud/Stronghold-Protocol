// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: parallel fixed-pool groups (SiderLock 分组卡池),
// one turn order and countdown per group, AI picks, the card applied by choices.js applyCard), the expanded-capacity
// rooms' flat draft (MatchPhases.concurrentDraft: every seat picks at once, repeats allowed), the personal bounty choice
// of the Art 教鞭 (offerBountyChoice / pickPersonalChoice / autoPickPersonalChoice: held by the player inside PREP — no
// phase, no timer of its own) and the rolls the meta effects ask for — bounties (addBounty), item ids (rollItemId) and
// choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, generateGroupDrafts, generateVersusDrafts, applyCard, bountyBattles, isMultiRoundBounty, bountyCard } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { OK, fail, DELAYS } from './common.js';
import { installDraftFacade } from './phases.js';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    if (this.capacityExperiment) { this._enterFlatSpDraft(); return; }
    // 2V2: every team drafts its own board — 4 cards (3 for the 机密商店) from its own live bonds / pool, same family and
    // the same fixed gradient for both, the team's own turn order alternating one member of each team. Solo/co-op keep
    // the shared (group) draw below.
    if (this.isVersus) { this._enterVersusSpDraft(); return; }
    if (!this.alivePlayers().length) { this.beforePrepOffers(); return; }
    const groups = this.makeDraftGroups({ shuffle: false, living: true });
    const active = groups.filter((g) => g.order.length).map((g) => ({ id: g.id, playerIds: g.order.slice() }));
    const pages = generateGroupDrafts(this.gd, this.rngDraft, this.round, active, {
      stageId: this.stageId, bondAvailable: (bondId, group) => this.bondLive(bondId, group.playerIds[0]),
      itemAvailable: (id, group) => this.itemPoolFor(group.playerIds[0]).canGain(id),
    });
    if (!pages || !pages.length) { this.beforePrepOffers(); return; }
    for (const g of groups) {
      const page = pages.find((p) => p.id === g.id);
      Object.assign(g, page || { cards: [] }, { taken: {} });
      if (!this.isSolo) this.rngDraft.shuffle(g.order);
      // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
      g.order = this.humansFirst(g.order);
    }
    this.phase = PHASE.SP_DRAFT;
    this.sp = installDraftFacade({ ...pages[0], id: this.nextDraftId('sp'), groups, picks: {}, untimed: this.soloUntimed },
      ['order', 'idx', 'cards', 'taken', 'turnDeadline', 'turnSeconds']);
    this.setDeadline(0);
    for (const g of groups) this.startSpTurn(g);
    this.markPublic();
    this._checkpoint('sp-draft');
  }

  /** The 2V2 机变 draft: generateVersusDrafts builds the two fixed-gradient boards (choices.js); this lays them out as
   * one flat 8-card draw with per-team tags (poolTeam), fills sp.teams and alternates the pick order. */
  _enterVersusSpDraft() {
    const alive = this.alivePlayers();
    if (!alive.length) { this.beforePrepOffers(); return; }
    const pair = generateVersusDrafts(this.gd, this.rngDraft, this.round, {
      stageId: this.stageId,
      bondAvailable: (bondId, team) => this.bondLive(bondId, team),
      itemAvailable: (id) => this.itemPool.canGain(id),
    });
    if (!pair) { this.beforePrepOffers(); return; }
    const cards = [];
    const teams = new Map();
    this.matchTeamIds().forEach((team, i) => {
      const list = pair.teams[i] || [];
      const base = cards.length;
      list.forEach((c, j) => cards.push({ ...c, idx: base + j, poolTeam: team }));
      teams.set(team, { family: pair.family, name: pair.name, desc: pair.desc, eventId: pair.eventId });
    });
    if (!cards.length) { this.beforePrepOffers(); return; }
    // the two teams decide IN STEP: alternate one member of each team (each team's own internal order), so neither side
    // gets a head start; a team that runs out of cards waits for the other (spViewFor `waiting`)
    const perTeam = this.matchTeamIds().map((team) => {
      const ids = alive.filter((p) => this.teamIdOf(p) === team).map((p) => p.playerId);
      if (!this.isSolo) this.rngDraft.shuffle(ids);
      return this.humansFirst(ids);
    });
    const slots = Math.max(0, ...perTeam.map((ids) => ids.length));
    const order = [];
    for (let i = 0; i < slots; i++) for (const ids of perTeam) if (ids[i]) order.push(ids[i]);
    this.phase = PHASE.SP_DRAFT;
    this.sp = { ...teams.get(0), cards, teams, order, idx: 0, picks: {}, taken: {}, untimed: this.soloUntimed, turnDeadline: 0 };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
    this._checkpoint('sp-draft');
  }

  /**
   * The expanded-capacity room's flat draft (MatchPhases.concurrentDraft): one shared page, every seat still deciding
   * picks at once (a solo expanded room by turns), repeats allowed. `groups` is an explicit empty array so the wire
   * schema's spDraft record round-trips (shared/wireSchema.js).
   */
  _enterFlatSpDraft() {
    const alive = this.alivePlayers();
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId,
      bondAvailable: (bondId) => this.bondLive(bondId), itemAvailable: id => this.spItemAvailable(id) });
    if (!draft || !alive.length) { this.beforePrepOffers(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
    order = this.humansFirst(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay
    const untimed = this.soloUntimed;
    const concurrent = this.concurrentDraft();
    this.sp = { ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0, groups: [],
      ...(concurrent ? { concurrent: true } : {}) };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
    this._checkpoint('sp-draft');
  }

  /** The 机变 cards a player may pick: their own team's in 2V2, the whole draw otherwise. */
  spCardsFor(ps) {
    const s = this.sp;
    if (!s) return [];
    if (!this.isVersus) return s.cards;
    const team = this.teamIdOf(ps);
    return s.cards.filter((c) => c.poolTeam === team);
  }

  spGroup(playerId = null) {
    const groups = this.sp?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  /** The seat whose turn it is in `playerId`'s group (no argument: the first group's); null when concurrent. */
  spTurn(playerId = null) {
    const s = this.sp;
    if (!s || s.concurrent) return null;
    if (s.groups?.length) {
      const g = playerId == null ? s.groups[0] : s.groups.find((x) => x.playerIds.includes(playerId)) || null;
      return g && !g.done ? g.order[g.idx] ?? null : null;
    }
    return s.order[s.idx] ?? null; // the flat draft of an expanded solo room
  }

  /** Whether `ps` still has its 机变 pick to make: alive, no card yet, and one of the cards is available to it. */
  spPending(ps) {
    const s = this.sp;
    return !!s && !!ps && ps.alive && s.picks[ps.playerId] == null && s.cards.some((c) => this.spCardAvailable(c, ps));
  }

  /** `picker`: the seat about to pick (default: the one whose turn it is) — an item card checks that seat's stock; the
   * group form (SiderLock 分组卡池) checks the group's own taken set and its first seat's stock instead. */
  spCardAvailable(card, picker = this.spTurn()) {
    if (!card) return false;
    if (picker && typeof picker === 'object' && Array.isArray(picker.playerIds))
      return picker.taken?.[card.idx] == null
        && (card.kind !== 'item' || this.itemPoolFor(picker.playerIds[0]).canGain(card.id));
    return (this.capacityExperiment || this.sp?.taken?.[card.idx] == null)
      && (card.kind !== 'item' || this.spItemAvailable(card.id, picker));
  }

  /**
   * Whether an item card can still be taken: from `player`'s equipment stock (Match itemPoolFor), or — no picker: the
   * draw itself, the public view after the last turn — from the stock of any alive seat (one group: the match's stock).
   */
  spItemAvailable(id, player = null) {
    if (player) return this.itemPoolFor(player).canGain(id);
    return this.alivePlayers().some((p) => this.itemPoolFor(p).canGain(id));
  }

  startSpTurn(group = this.spGroup()) {
    const s = this.sp;
    if (this.phase !== PHASE.SP_DRAFT || !s) return;
    // the fixed-pool groups (SiderLock 分组卡池 / Rosmontis parallel drafts): each group runs its own turn order and
    // countdown in parallel — installDraftFacade mirrors groups[0] into the flat fields for single-pool diagnostics
    if (s.groups?.length) {
      const g = group;
      if (!g) return;
      this.clearDraftGroupTimer(g);
      while (g.idx < g.order.length) { // loop-cap: draft order
        const ps = this.players.get(g.order[g.idx]);
        if (ps && ps.alive && !ps.left && s.picks[ps.playerId] == null) break;
        g.idx++;
      }
      // As in the strategy draft, the order is fixed for the whole draft (upstream 0.2.2 enterSpDraft): a seat keeps the
      // place it drew, and only a skip moves it. A card the group's stock cannot pay for is not offered (SiderLock).
      const available = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
      g.done = g.idx >= g.order.length || !available.length;
      if (g.done) {
        this.syncDraftDeadline(s);
        this.markPublic();
        if (s.groups.every((x) => x.done) && !s.finishPending) {
          s.finishPending = true;
          this.later(0, () => {
            if (this.sp === s && this.phase === PHASE.SP_DRAFT && s.groups.every((x) => x.done)) this.finishSpDraft();
          });
        }
        return;
      }
      const token = g.token;
      if (!g.untimed) {
        const first = g.idx === 0;
        const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
        const ms = this.scaled(secs * 1000);
        g.turnSeconds = ms / 1000;
        g.turnDeadline = this.sched.now() + ms;
        g.timer = this.later(ms, () => {
          if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
          const ps = this.players.get(g.order[g.idx]);
          if (!ps) return;
          const avail = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
          if (!avail.length) { this.startSpTurn(g); return; }
          this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
        });
      }
      this.syncDraftDeadline(s);
      const cur = this.players.get(g.order[g.idx]);
      if (cur && cur.botControlled) this.scheduleSpBot(g);
      this.markPublic();
      return;
    }
    if (s.concurrent) { this._concurrentSpStep(); return; }
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    // a seat whose equipment stock holds none of the cards is passed over (an experimental room's other groups may
    // still pick; in a one-stock match nobody after it can, so the draft ends as before)
    while (s.idx < s.order.length) { // loop-cap: draft order
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null && s.cards.some(c => this.spCardAvailable(c, ps))) break;
      s.idx++;
    }
    const cur0 = this.players.get(this.spTurn());
    // 2V2: the picker may only take its own team's cards (the other team's board is not its business)
    const mine = this.isVersus ? this.spCardsFor(cur0) : s.cards;
    const available = mine.filter(c => this.spCardAvailable(c)).map(c => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = this.isSolo && this.gd.config.version?.rules?.soloTimed ? 150 : first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = (this.isVersus ? this.spCardsFor(ps) : s.cards).filter(c => this.spCardAvailable(c)).map(c => c.idx);
        if (!avail.length) { this.startSpTurn(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  /**
   * A concurrent 机变 draft (MatchPhases.concurrentDraft) at its start and after each pick: ends once nobody has a pick
   * left to make (spPending); else arms the step's one countdown (spFirst, the first time) and lets every AI / AI 托管
   * seat still deciding pick. A countdown that runs out gives each seat still deciding one of the cards it can take at
   * random, in draft order — like a turn that runs out.
   */
  _concurrentSpStep() {
    const s = this.sp;
    if (s.done) return;
    const deciding = s.order.map((pid) => this.players.get(pid)).filter((ps) => this.spPending(ps));
    if (!deciding.length) {
      s.done = true;
      s.turnDeadline = 0;
      this.setDeadline(0);
      this.later(0, () => this.finishSpDraft());
      this.markPublic();
      return;
    }
    if (!s.armed) {
      s.armed = true;
      const token = ++this._turnToken;
      if (!s.untimed) {
        this.setDeadline(this.gd.timer('spFirst'), () => {
          if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || this.sp !== s) return;
          for (const pid of s.order) {
            const ps = this.players.get(pid);
            if (!this.spPending(ps)) continue;
            const avail = s.cards.filter((c) => this.spCardAvailable(c, ps)).map((c) => c.idx);
            this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
          }
          this._concurrentSpStep();
        });
        s.turnDeadline = this.deadline;
      } else {
        this.setDeadline(0);
      }
    }
    for (const ps of deciding) if (ps.botControlled && this._botMayPick(ps, deciding)) this.scheduleSpBot(ps);
    this.markPublic();
  }

  /** An AI / AI 托管 seat's pick after DELAYS.BOT_ACTION. A concurrent draft names the seat (`target`; once while queued). */
  scheduleSpBot(target = null) {
    const s = this.sp;
    // the fixed-pool groups: each group's turn has its own token (clearDraftGroupTimer), the pick comes from the
    // group's own page (`target` names the group — or the seat whose group it is)
    if (s?.groups?.length) {
      const g = target && target.playerId ? this.spGroup(target.playerId) : target || this.spGroup();
      if (!g || g.done) return;
      const token = g.token;
      this.later(this.scaled(DELAYS.BOT_ACTION), () => {
        if (this.phase !== PHASE.SP_DRAFT || this.sp !== s || token !== g.token) return;
        const ps = this.players.get(g.order[g.idx]);
        if (!ps || !ps.botControlled) return;
        const avail = g.cards.filter((c) => this.spCardAvailable(c, g)).map((c) => c.idx);
        if (!avail.length) return;
        // Same as scheduleBandBot's group branch: the strategy API decides (an external strategy gets a 'card' job),
        // the card list it is handed stays the fork's per-group view.
        const fallback = () => this._applyCard(ps, this.bot.pickCard(this, ps, g.cards, avail));
        if (this.bot.decide?.(this, ps, { kind: 'card',
          valid: () => this.phase === PHASE.SP_DRAFT && this.sp === s && token === g.token,
          complete: () => this.sp?.picks[ps.playerId] != null, fallback })) return;
        fallback();
      });
      return;
    }
    const token = this._turnToken;
    if (s?.concurrent) {
      if (!target || s.botQueued?.has(target.playerId)) return;
      (s.botQueued ||= new Set()).add(target.playerId);
    }
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (s?.concurrent) s.botQueued.delete(target.playerId);
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp || this.sp !== s) return;
      const ps = s.concurrent ? target : this.players.get(this.spTurn());
      if (!ps || !ps.botControlled || !this.spPending(ps)) return;
      const pool = this.isVersus ? this.spCardsFor(ps) : s.cards;
      const avail = pool.filter(c => this.spCardAvailable(c, ps)).map(c => c.idx);
      if (!avail.length) return;
      // The strategy API is upstream's; the card list it is handed stays the fork's per-group view (s is the seat's
      // own group).
      const fallback = () => this._applyCard(ps, this.bot.pickCard(this, ps, pool, avail));
      if (this.bot.decide?.(this, ps, { kind: 'card',
        valid: () => this.phase === PHASE.SP_DRAFT && token === this._turnToken,
        complete: () => this.sp?.picks[ps.playerId] != null, fallback })) return;
      fallback();
    });
  }

  pickCard(ps, idx, opts = {}) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    // the fixed-pool groups: the request must name the seat's own group ({ draftId, groupId } metadata, intents g.choice)
    if (this.sp.groups?.length) {
      const g = this.spGroup(ps.playerId);
      const targetError = this.draftTargetError(this.sp, g, opts);
      if (targetError) return targetError;
      if (!ps.alive) return fail(ERR.ELIMINATED);
      if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
      if (this.spTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
      if (!Number.isInteger(idx) || idx < 0 || idx >= g.cards.length) return fail(ERR.BAD_TARGET);
      if (!this.spCardAvailable(g.cards[idx], g)) return fail(ERR.SOLD_OUT);
      this._applyCard(ps, idx);
      return OK;
    }
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (!this.sp.concurrent && this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    // 2V2: the card must belong to the picker's own team board
    if (this.isVersus && this.sp.cards[idx].poolTeam !== this.teamIdOf(ps)) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx], ps)) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    // the fixed-pool groups: the pick locks the card in the seat's own group, then that group moves on
    if (s?.groups?.length) {
      const g = ps && this.spGroup(ps.playerId);
      if (!s || !g || !ps.alive || ps.left || s.picks[ps.playerId] != null || !this.spCardAvailable(g.cards[idx], g)) return;
      const card = g.cards[idx];
      if (!card) return;
      s.picks[ps.playerId] = idx;
      g.picks[ps.playerId] = idx;
      g.taken[idx] = ps.playerId;
      try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
      this.markPrivate(ps);
      this.markPublic();
      onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
      this.startSpTurn(g);
      // a room-wide grant (a team equipment tactic) can empty another group's stock: its page closes at once, the
      // pages that can still choose keep their clocks (SiderLock 分组卡池)
      for (const other of s.groups) {
        if (other !== g && !other.done && !other.cards.some((c) => this.spCardAvailable(c, other))) this.startSpTurn(other);
      }
      return;
    }
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx], ps)) return;
    if (this.isVersus && s.cards[idx].poolTeam !== this.teamIdOf(ps)) return;
    const card = this.capacityExperiment ? structuredClone(s.cards[idx]) : s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    // Repeatable drafts keep the first picker only as display metadata, never as a slot lock.
    if (s.taken[idx] == null) s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    // a concurrent draft: an item card can empty its group's stock — the seats still deciding see it in m.private spBlocked
    if (s.concurrent && card.kind === 'item') for (const p of this.alivePlayers()) if (p !== ps && s.picks[p.playerId] == null) this.markPrivate(p);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    for (const g of this.sp?.groups || []) this.clearDraftGroupTimer(g);
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this.beforePrepOffers();
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — the card becomes a bounty on its next battles. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? this.bot.pickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items — among those the
   * drawing seat's equipment stock (`player`, Match itemPoolFor) still holds.
   * `also` (pool_equip_kathe: 突变细胞) joins the draw even though it is shopExcluded. The shop item slot does not
   * read it. `pick` still drops ids that `canGain` refuses, so an empty shop item stays out and an uncapped `also`
   * id can still be drawn. `exclude` removes ids before sampling (Cathy's match-long allowance / distinct choices). */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6, player = null, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const stock = this.itemPoolFor(player);
    const pick = (ids, weights = null) => stock.pick(rng, exclude.length ? ids.filter((id) => !exclude.includes(id)) : ids, weights);
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && stock.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return pick(pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return pick(withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return pick(withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return pick(list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, player = null, extra = null, chessOf = null, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl, player, exclude });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const stock = this.poolFor(player);
    const ps = typeof player === 'string' ? this.players.get(player) : player;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      const copies = typeof ps?.poolOf === 'function' ? ps.poolOf(base) : stock;
      return !copies.has(base) || copies.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = stock.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
