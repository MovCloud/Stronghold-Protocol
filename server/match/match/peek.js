// server/match/match/peek.js —— MatchPeek：同盟盟约速查的 peek 通道（本 fork 功能，owner request 2026-11-12）。
//
// 队伍栏的浮窗（public/js/ui/teamPanel.js BondsFlyout）在队友的战场不在屏上时拿不到他的干员名单：m.public 是面向
// 所有座位与观战席的一条广播，绝不能携带名册（PR #922 批注），而 g.watch 只跟随一张战场。于是浮窗改向服务端要快照：
//
//   C→S  g.peek { open: true|false }   观众展开 / 收起浮窗（展开带去抖，见下）
//   S→C  m.peek { seq, ops: { [pid]: [{ id, golden? }] } }   展开时的快照：该观众的每一位队友
//        m.peek { seq, seat: pid, ops: [...] }               浮窗展开期间，某位队友的名单发生变化
//
// 隐私（owner 的规则）：服务端自己按 teamIdOf 过滤 —— 同盟（coop）下发整队，2V2（'versus'）只发观众自己的队伍
// （两队各自成局），观战席根本到不了这里（MatchPlatform._handleSeatIntent 只放行 g.watch）。这里的内容不进
// m.public、不落盘；载荷与 m.private boardOps（MatchViews._boardOps）完全同形：只含场上棋子，精简 { id, golden? }，
// 不含手牌 / 暂存 / 装备 / 召唤物 / 坐标。
//
// 这是状态通道：一条只读的名册流，与战场通道（g.watch → m.field / b.snap / b.start 以及 watchers 表）彼此独立。
// 它不携带任何战况、从不写 MatchWatch.watchers、不改动 g.watch 的任何规则；它自己的策略只有下面的队伍归属。
// 正因如此，它能在观众自己的战斗进行中照常应答：名册在战斗窗口内是静态的，准备期也已经通过 g.watch 的侦察
// 一席一席地看过。它唯一不能跨越的是队伍边界。
//
// 订阅：open: true 按当前回合与阶段订阅并回一份快照；open: false、离场与断线都会解除。回合或阶段变化时订阅
// 也会自行失效 —— 浮窗只是对打开它的那个准备 / 战斗窗口瞥一眼，客户端在同一道边界上收起它
// （screens/game.js phaseKey → teamPanel.js）。服务端这一半是冗余保障：卡死的页面、丢失的 close 也可能仍然在线。
// 同一座位在 PEEK_OPEN_DEBOUNCE_MS 内重复 open 只刷新订阅（重渲染，不是新的一次瞥一眼）。名单变化每次 flush
// （MatchMessaging.flush → _flushPeek）比对一次各座位的排序签名：在棋盘上挪动棋子不改变签名，因此不推送。

import { OK } from './common.js';

/** 同一座位在该窗口内再次 open 视为重新渲染：只刷新订阅，不再重发快照。 */
const PEEK_OPEN_DEBOUNCE_MS = 1000;

export class MatchPeek {
  /**
   * g.peek { open }（同盟盟约速查浮窗）。open: true：按当前回合 / 阶段订阅，并把该观众队友的快照单播给他；
   * open: false：解除订阅。观战席到不了这里。阶段或回合变化会在下一次 flush 时结束订阅（_flushPeek）。
   * @param {PlayerState} ps @param {boolean} open
   */
  peek(ps, open) {
    const now = this.sched.now();
    if (!this._peekSubs) this._peekSubs = new Map();
    if (!open) {
      this._peekSubs.delete(ps.playerId);
      this._peekOpenAt?.delete(ps.playerId);
      // 已经没人听了：签名表也一并清掉，免得下次展开的快照后面跟着一份陈旧的差分。
      if (this._peekSubs.size === 0) this._peekSig?.clear();
      return OK;
    }
    this._peekSubs.set(ps.playerId, { round: this.round, phase: this.phase });
    if (!this._peekOpenAt) this._peekOpenAt = new Map();
    const last = this._peekOpenAt.get(ps.playerId) || 0;
    this._peekOpenAt.set(ps.playerId, now);
    // 重新渲染式的再次询问：第一份应答仍然新鲜。订阅已在上面刷新。
    if (now - last < PEEK_OPEN_DEBOUNCE_MS) return OK;
    this._sendPeek(ps.playerId, { ops: this._peekSnapshot(ps) });
    return OK;
  }

  /** 该观众的每一位队友（永远不含自己、不含另一队）的精简干员名单。 */
  _peekSnapshot(viewer) {
    const ops = {};
    for (const ps of this.alliesOf(viewer)) {
      if (!ps || ps.playerId === viewer.playerId) continue;
      ops[ps.playerId] = this._peekOps(ps);
    }
    return ops;
  }

  /** 该座位给浮窗用的干员名单：_boardOps（只含场上棋子、场上记录的 char id 与精英位），排序固定，
   *  所以同一批棋子换了格子仍是同一份名单。 */
  _peekOps(ps) {
    const list = this._boardOps(ps).map((u) => (u.golden ? { id: u.id, golden: 1 } : { id: u.id }));
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.golden ? 1 : 0) - (b.golden ? 1 : 0)));
    return list;
  }

  /** 一份名单的签名：排序后的干员 id 与精英位（站位不参与）。 */
  _peekSigOf(list) { return list.map((u) => (u.golden ? `${u.id}*` : u.id)).join(','); }

  /** 解除一个座位的订阅（离场、断线）：不再向他推送。签名表刻意保留 —— 离场 / 淘汰会清空该座位的棋盘，
   *  其他观众的浮窗仍要收到那份 `[]`，不能把最后一帧名册留在屏上。 */
  _peekForget(playerId) {
    this._peekSubs?.delete(playerId);
    this._peekOpenAt?.delete(playerId);
    if (this._peekSubs && this._peekSubs.size === 0) this._peekSig?.clear();
  }

  /**
   * 每次 flush 的名单差分（MatchMessaging.flush）：凡是自上次 flush 以来签名发生变化的座位，把新名单单播给
   * 此刻正展开着浮窗的每一位队友。首次见到的座位（新的对局状态、重连回来的座位）没有可比对的旧值 ——
   * 它的内容由快照携带。在更早的回合或阶段打开的订阅会在这里被丢掉（浮窗的窗口已经结束）。
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

  /** 一帧单播 m.peek；seq 是对局的递增计数（新帧的 seq 总是更大）。 */
  _sendPeek(playerId, body) {
    this._peekSeq = (this._peekSeq || 0) + 1;
    this.sendTo(playerId, { t: 'm.peek', seq: this._peekSeq, ...body });
  }
}
