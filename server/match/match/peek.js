// server/match/match/peek.js — Match methods: the 同盟盟约速查 peek (fork feature, owner request 2026-11-12).
//
// The team panel's flyout (public/js/ui/teamPanel.js BondsFlyout) cannot show a teammate's operators while that
// teammate's field is not on screen: m.public is one broadcast and must never carry a roster (PR #922 review), and
// g.watch only follows a field. So the flyout asks for a snapshot instead:
//
//   C→S  g.peek { open: true|false }   the viewer expanded / collapsed the flyout (the open is debounced, see below)
//   S→C  m.peek { seq, ops: { [pid]: [{ id, golden? }] } }   the open's snapshot: every TEAM MATE of the viewer
//        m.peek { seq, seat: pid, ops: [...] }              one mate's layout changed while the viewer's flyout is open
//
// Privacy (the owner's rule): the server filters by teamIdOf on its own — 同盟 (coop) sends the whole roster, 2V2
// ('versus') only the viewer's own team (one team's game is separate from the other's), and a spectator seat never
// reaches this module at all (MatchPlatform._handleSeatIntent refuses every intent but g.watch). Nothing here goes
// into m.public and nothing is written to disk. The payload is exactly the shape of m.private boardOps
// (MatchViews._boardOps): board chess only, lean { id, golden? }, no hand / temp / equipment / summons / coordinates.
//
// Subscription: `open: true` subscribes for the CURRENT round and phase and answers the snapshot; `open: false`,
// leaving and a disconnect drop it. The subscription also ends on its own when the round or the phase changes — the
// flyout is a glance at the prep / battle window it was opened in, and the client collapses it on the same boundary
// (screens/game.js phaseKey → teamPanel.js). The server-side reset is the redundant half: a client stuck with an open
// panel (a frozen page, a lost close) can still be connected and idle. A repeated open within
// PEEK_OPEN_DEBOUNCE_MS only refreshes the subscription (a re-render, not a new glance). Layout changes are diffed
// once per flush (MatchMessaging.flush → _flushPeek) between the seats' sorted operator signatures: moving a piece
// around the board changes no signature, so it pushes nothing.

import { OK } from './common.js';

/** A second open of the same seat within this window is a re-render: it refreshes the subscription, no snapshot again. */
const PEEK_OPEN_DEBOUNCE_MS = 1000;

export class MatchPeek {
  /**
   * g.peek { open } (the 同盟盟约速查 flyout). `open: true`: subscribe for the current round/phase and unicast the
   * snapshot of the viewer's team mates; `open: false`: drop the subscription. A spectator seat never reaches this
   * method. A phase or round change ends the subscription on the next flush (_flushPeek).
   * @param {PlayerState} ps @param {boolean} open
   */
  peek(ps, open) {
    const now = this.sched.now();
    if (!this._peekSubs) this._peekSubs = new Map();
    if (!open) {
      this._peekSubs.delete(ps.playerId);
      this._peekOpenAt?.delete(ps.playerId);
      // Nobody listens any more: drop the signatures too, so the next open's snapshot is not followed by a stale diff.
      if (this._peekSubs.size === 0) this._peekSig?.clear();
      return OK;
    }
    this._peekSubs.set(ps.playerId, { round: this.round, phase: this.phase });
    if (!this._peekOpenAt) this._peekOpenAt = new Map();
    const last = this._peekOpenAt.get(ps.playerId) || 0;
    this._peekOpenAt.set(ps.playerId, now);
    // A re-render asks again: the first answer is still fresh. The subscription was refreshed above.
    if (now - last < PEEK_OPEN_DEBOUNCE_MS) return OK;
    this._sendPeek(ps.playerId, { ops: this._peekSnapshot(ps) });
    return OK;
  }

  /** Every TEAM MATE of the viewer (never the viewer itself, never the other team): its lean operator list. */
  _peekSnapshot(viewer) {
    const ops = {};
    for (const ps of this.alliesOf(viewer)) {
      if (!ps || ps.playerId === viewer.playerId) continue;
      ops[ps.playerId] = this._peekOps(ps);
    }
    return ops;
  }

  /** The seat's operators for the flyout: `_boardOps` (board chess only, the field record's char id + elite bit),
   *  in a stable order so a moved piece (same pieces, different tiles) is the same list. */
  _peekOps(ps) {
    const list = this._boardOps(ps).map((u) => (u.golden ? { id: u.id, golden: 1 } : { id: u.id }));
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.golden ? 1 : 0) - (b.golden ? 1 : 0)));
    return list;
  }

  /** The identity of a seat's layout: the sorted operator ids and their elite bits (position is not part of it). */
  _peekSigOf(list) { return list.map((u) => (u.golden ? `${u.id}*` : u.id)).join(','); }

  /** Drop a seat's subscription (leave, disconnect): it is not shown anything and its own signature is forgotten. */
  _peekForget(playerId) {
    this._peekSubs?.delete(playerId);
    this._peekOpenAt?.delete(playerId);
    this._peekSig?.delete(playerId);
    if (this._peekSubs && this._peekSubs.size === 0) this._peekSig?.clear();
  }

  /**
   * The layout diff of one flush (MatchMessaging.flush): for every seat whose operator signature changed since the last
   * flush, unicast the new list to each TEAM MATE whose flyout is open right now. A seat seen for the first time (a
   * fresh match state, a seat back from a reconnect) has nothing to compare against — its snapshot carries it.
   * A subscription opened in an earlier round or phase is dropped here (the panel's window has ended).
   */
  _flushPeek() {
    const subs = this._peekSubs;
    if (!subs || subs.size === 0 || this.disposed) return;
    const stale = [];
    for (const [pid, sub] of subs) if (sub.round !== this.round || sub.phase !== this.phase) stale.push(pid);
    for (const pid of stale) { subs.delete(pid); this._peekOpenAt?.delete(pid); }
    if (subs.size === 0) { this._peekSig?.clear(); return; }

    const sig = new Map();
    const ops = new Map();
    for (const ps of this.order) {
      const list = this._peekOps(ps);
      ops.set(ps.playerId, list);
      sig.set(ps.playerId, this._peekSigOf(list));
    }
    const prev = this._peekSig || (this._peekSig = new Map());
    const changed = [];
    for (const ps of this.order) {
      const s = sig.get(ps.playerId);
      if (prev.has(ps.playerId) && prev.get(ps.playerId) !== s) changed.push(ps);
      prev.set(ps.playerId, s);
    }
    if (changed.length === 0) return;
    for (const pid of subs.keys()) {
      const viewer = this.players.get(pid);
      if (!viewer || viewer.left || !viewer.connected) continue;
      const team = this.teamIdOf(viewer);
      for (const ps of changed) {
        if (ps.playerId === pid || this.teamIdOf(ps) !== team) continue;
        this._sendPeek(pid, { seat: ps.playerId, ops: ops.get(ps.playerId) });
      }
    }
  }

  /** One unicast m.peek frame; `seq` is the match's running counter (a newer frame always carries a larger one). */
  _sendPeek(playerId, body) {
    this._peekSeq = (this._peekSeq || 0) + 1;
    this.sendTo(playerId, { t: 'm.peek', seq: this._peekSeq, ...body });
  }
}
