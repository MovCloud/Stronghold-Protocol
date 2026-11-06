// server/match/match/messaging.js — Match methods: messaging — unicast, broadcast, toasts, the ticker lines
// (config.broadcasts by type; the remake's CUSTOM lines), the dirty marks and flush: m.private per player only when it
// changed (plus the prep scouts of that player's board), m.public throttled (DELAYS.PUBLIC_THROTTLE) and deduplicated.
// i18n (docs/I18N.md): a toast / CUSTOM line is a string (its own msgid) or a shared/i18n.js msg(msgid, params); the frame
// carries `text` (the Chinese rendering, what older clients show) plus `msgid` / `params`; a broadcast line carries its
// `args` so the client can fill the localized config.broadcasts template.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { DELAYS } from './common.js';
import { STATE_COALESCE } from '../../wireHints.js';
import { wireMessage } from '../../../shared/i18n.js';

const stateScopes = new WeakMap();
/** The replace mark shared by throttled state frames of one phase/round (outboundPump coalescing). */
function stateScope(match) {
  let scope = stateScopes.get(match);
  if (!scope || scope.phase !== match.phase || scope.round !== match.round || scope.setupRevision !== match.setupRevision) {
    scope = { phase: match.phase, round: match.round, setupRevision: match.setupRevision };
    stateScopes.set(match, scope);
  }
  return scope;
}

export class MatchMessaging {
  /** @param {string} [wire] JSON.stringify(msg) when the caller already has it: a host may deliver it as is */
  sendTo(playerId, msg, wire) {
    if (this.disposed) return false;
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return false;
    try { return !!(typeof wire === 'string' ? this.sendFn(playerId, msg, wire) : this.sendFn(playerId, msg)); }
    catch (e) { this.reportError('send', e); return false; }
  }

  /** @param {string} [wire] JSON.stringify(msg), encoded once for every member */
  broadcast(msg, wire) {
    if (this.disposed) return;
    try { if (typeof wire === 'string') this.broadcastFn(msg, wire); else this.broadcastFn(msg); }
    catch (e) { this.reportError('broadcast', e); }
  }

  /** @param {string|{ msgid: string, params?: object }} text a string or msg() (shared/i18n.js) */
  toast(ps, kind, text) {
    if (!ps || ps.isBot || ps.left || !ps.connected) return;
    this.sendTo(ps.playerId, { t: 'm.toast', kind, ...wireMessage(text) });
  }

  /** Broadcast ticker from config.broadcasts by type; `param` picks the variant (SHOP_LEVEL level, BOSS_HIT share…). */
  tickerFor(type, args = [], { playerId = null, to = null, param = null } = {}) {
    const list = Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts.filter((b) => b && b.type === type) : [];
    let b = list[0];
    if (param != null) b = list.find((x) => Array.isArray(x.params) && x.params.includes(String(param))) || b;
    const tpl = b && typeof b.text === 'string' ? b.text : null;
    if (!tpl) return;
    const text = tpl.replace(/\{(\d)\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));
    const msg = { t: 'm.ticker', text, id: b.id, type, priority: Number(b.priority) || 0, playerId, args: args.map((a) => String(a ?? '')) };
    if (to) this.sendTo(to, msg);
    else this.broadcast(msg);
  }

  /**
   * A ticker line of the remake's own (type CUSTOM). `priority`: the match-flow notices (隐秘核心已解锁, 联防阶段, a player out
   * or gone) take FLOW_TICKER_PRIORITY so the strip does not hold them behind shop-level lines; other lines 0.
   */
  tickerText(text, priority = 0) {
    if (!text) return;
    const w = wireMessage(text);
    this.broadcast({ t: 'm.ticker', ...w, text: w.text.slice(0, 200), id: null, type: 'CUSTOM', priority: Number(priority) || 0, playerId: null });
  }

  markPublic() { this._pubDirty = true; }
  /**
   * A player's state changed: its m.private and (throttled, deduplicated) m.public (level, board, bonds…) — in a boss
   * round's prep also its pair partner's m.private, which shows this board on its other half (bossMate, item 51).
   */
  // `_privDirty` is created after the player states (the PlayerState constructor may already mark itself dirty —
  // setSkins does, seat.skins carrying a choice into a new match), so the guard is load-bearing, not defensive
  markPrivate(ps) {
    if (!ps || !this._privDirty) return;
    this._privDirty.add(ps);
    this._pubDirty = true;
    const m = this._bossMateOf(ps);
    if (m) this._privDirty.add(m.mate);
  }

  /** Send pending m.private (per player, only when changed) and m.public (normally throttled ≤ 8/s). */
  flush(forcePublic = false) {
    if (this.disposed) return;
    if (this._privDirty.size) {
      const list = [...this._privDirty];
      this._privDirty.clear();
      for (const ps of list) {
        if (!(ps.isBot || ps.left || !ps.connected)) this._sendPrivate(ps, false);
        this._notifyPrepScouts(ps);
      }
    }
    if (this._pubDirty || forcePublic) this._maybeSendPublic(forcePublic);
    if (this._damageDirty) this._flushDamage();
  }

  _sendPrivate(ps, force) {
    let view;
    try { view = ps.privateView(); } catch (e) { this.reportError('privateView', e); return; }
    const json = JSON.stringify(view);
    if (!force && json === ps._lastPriv) return;
    ps._lastPriv = json;
    // Coalescing scope (outboundPump): throttled privates of one phase/round share a replace mark;
    // forced privates (match end, remakes) are critical and never coalesce.
    if (!force) view[STATE_COALESCE] = stateScope(this);
    this.sendTo(ps.playerId, view, json);
  }

  _maybeSendPublic(force) {
    const now = this.sched.now();
    if (!force && now - this._lastPubAt < DELAYS.PUBLIC_THROTTLE) {
      if (!this._pubTimer) {
        const wait = Math.max(1, DELAYS.PUBLIC_THROTTLE - (now - this._lastPubAt));
        this._pubTimer = this.sched.setTimeout(() => {
          this._pubTimer = null;
          if (this.disposed) return;
          try { this._maybeSendPublic(false); } catch (e) { this.reportError('public', e); }
        }, wait);
      }
      return;
    }
    this._pubDirty = false;
    let view;
    try { view = this.publicView(); } catch (e) { this.reportError('publicView', e); return; }
    const { serverNow, ...rest } = view;
    const json = JSON.stringify(rest);
    if (!force && json === this._lastPubJson) return;
    this._lastPubJson = json;
    // Coalescing scope (outboundPump): throttled publics of one phase/round share a replace mark;
    // forced publics are critical and never coalesce.
    if (!force) view[STATE_COALESCE] = stateScope(this);
    // Snapshot building / serialization can take time; throttle from the actual broadcast, not its start.
    this._lastPubAt = this.sched.now();
    // The dedupe key omits serverNow; the frame itself is encoded once here instead of once per member.
    this.broadcast(view, JSON.stringify(view));
  }
}
