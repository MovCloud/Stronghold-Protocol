// Left team panel (research 06 §11.1, research 09 §3.1): one row per seat — avatar (the player's picked 名片 头像; the
// strategy icon only in the row's flyout, which is this fork's deviation from research 06 §11.1 — the official row shows
// the strategy icon on the avatar once a band is picked; a player with no pick — an AI seat, which has no card on the
// wire, or a human on 默认 — gets the deterministic default pick by player id, ui/seatArt.js defaultCardPick), the
// 大本营 (调度中心) level badge, name, LP
// tower, status glyph (… acting / ✓ ready / ⌛ deciding / ⚔ combat / door left / ✕ dead), AI badge, "you" marker, the
// field being watched (eye badge), the 预选盟约 glyph (ui/bondPlan.js) and emote bubbles. In a boss round the viewer's pair
// is framed in green from the round's start (gameLogic teamFrameIds; community report of 2026-10-06, item 51).
// Observing (client-side combat, `observe` prop — the official flow): tapping a teammate's avatar expands a mint
// "前往查看" button under the row (when that teammate can be observed now; otherwise the reason is toasted through
// onWatch); while observing, the own row shows a "返回战场" button. Without `observe` (server-run combat) a click
// watches that player's field at once, and a click while that field is already on screen does not ask again.
// 联防 / 最终攻势 (`halves`, battle/observe.js avatarLayer; the owner's request, 2026-10-14 — both combat modes since
// 2026-10-15): the avatar of a player on a half of the field on screen — the own one included — goes to that half at
// once, without 前往查看 (an observer's tap picks that player the way 前往查看 does: screens/game.js); the avatar of the
// player whose half is on screen goes back to 全景.
// In PHASE.PREP a double-click on a teammate's avatar opens their field (GitHub #131, the 「前往查看」 shortcut).
// It does not open a field the teammate does not have, and it does not open one the click already opened.
// Boss-prep phases (最终攻势 / 隐秘核心) are not PHASE.PREP, so they still use 「前往查看」.
// Live LP (user playtest #3 item 2): during a normal round's battle each row's tower shows lp − the loss that player's
// leaks so far will cost (red, −N): the own row the top bar's live value (`self`, ui/hud.js liveLp), a teammate's row
// m.public players[].pendingLp (server/match/match/views.js, ~1 Hz). 联防 (user playtest #6 item 7): a leaker's row adds the
// runner tag ×N — its enemies still standing on the 联防 field, uncapped and live (falling as the helpers kill them,
// rising when one splits) — next to lp − min(lpCapPerRound, N): the own row the top bar's value, a teammate's row the
// local 联防 replica's count while it is on screen (`uniteLocal`: the battle runner's state().uniteLeft, the same battle
// the player watches, so the number moves with the kills on screen), else m.public players[].uniteLeft (the authority's
// report, ~1 Hz).
// Layout (ui/teamLayout.js, css/screens/team.css): 'classic' — the official column, desktop with at most four seats, open
// by default, emote bubbles beside the rows; 'list' — compact one-line rows in a bounded scroller, phones and rooms of more
// than four, folded by default (on a phone the open list is a drawer over the shop bar). The layout follows the screen
// (rotation, resize across the phone breakpoint) and refolds when it changes. Emotes of a folded roster or a list fly as
// danmaku (ui/danmaku.js). An experimental room's rows are grouped by chess pool (m.public poolGroups) so teammates can
// check who draws from the same pool.
// 投票移出 (ui/kickVote.js, GitHub feedback #12): the row of a teammate the AI plays because they stayed offline has a
// 投票移出 button in SP_DRAFT / PREP; the open vote is shown in the notice slot above the rows.
// PR #922 批注（2026-11-11）：浮窗的干员名单按观众裁剪。m.public 绝不携带名册 —— 自己的座位来自 m.private 的
// boardOps，队友只在「他这张侦察 / 战场正好在屏上」时才有；其余屏上看不到的队友由 peek（g.peek → m.peek，
// server/match/match/peek.js 的状态通道）补齐，所以另一组与仍在战斗中的队友在 peek 里照常可见，而在 g.watch 的
// 战场数据里没有（docs/META.md §4）。一行是每个座位的一行网格，分三列（盟约 / 场上干员 / 策略方块）：方块就是
// 行高，另外两列分掉窗口剩余宽度，三格同尺寸。把三列放在**同一行网格**里，正是上游评审报告的那个 bug（PR #922）
// 的修法 —— 策略列单独成网格时，某行展开「前往查看」会把这个座位的策略方块顶得和盟约错位。每格各自横向滚动，
// 选中的策略是按钮，点它在方块旁打开卡片。

import { useEffect, useReducer, useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon, Tooltip, Fragment, BondDisc } from './components.js';
import { PlayerAvatar, Sprite, LpTower, GIcon, LocalSprite, UnitThumb, BandIcon, RichText } from './gameComponents.js';
import { EmoteBubble } from './emotes.js';
import { STATUS_META, sortedPlayers, teamFrameIds, activeBubbles, sortBonds, nextThreshold } from './gameLogic.js';
import { MissTag, uniteRemaining } from './hud.js';
import { localAsset, data } from '../data.js';
import { ReviveAction, RevivalNotice } from './revival.js';
import { KickAction, KickVoteNotice } from './kickVote.js';
import { t } from '../../../shared/i18n.js';
import { uniteRelayKey } from '../battle/observe.js';
import { PHONE_QUERY, rosterPools, rosterStartsOpen, teamDensity, teamEmoteMode, teamPanelLayout } from './teamLayout.js';
import { useMedia } from './device.js';
import { useStore } from '../store.js';
import { BondPlanTag } from './bondPlan.js';
import { bondIconUrl } from './assetUrls.js';
import { toast } from './toasts.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Official status glyphs (ui/battle) per m.public players[].status; CSS glyph fallback. */
const STATUS_SPRITE = { ready: 'icon_ready', deciding: 'icon_waiting', done: 'icon_complete', dead: 'icon_dead' };

/**
 * A row's LP tower: the settled LP and the pending loss of the round's battle (0 outside COMBAT / UNITE). The own row
 * takes the top bar's live value when there is one (its m.private lp: the same number as the top bar). `left`: during
 * 联防 a leaker's enemies still standing (the ×N tag), else null — for a teammate the local 联防 replica's count when
 * one is given (`uniteLocal`, the runner's state().uniteLeft: { [playerId]: n }, absent = none left; the pending loss
 * is then min(cap, left)), else m.public players[].uniteLeft / pendingLp.
 * @param {any} p m.public players[] entry @param {any} pub m.public
 * @param {{ lp?: number|null, pending: number, unite: boolean, left?: number|null } | null} [self] the own live value (only for the own row)
 * @param {{ uniteLocal?: Record<string, number> | null, cap?: number }} [opts]
 * @returns {{ lp: number|null, pending: number, unite: boolean, left: number|null }}
 */
export function rowLp(p, pub, self = null, { uniteLocal = null, cap = 10 } = {}) {
  const pubLp = Number.isFinite(p?.lp) ? p.lp : null;
  if ((pub?.phase !== PHASE.COMBAT && pub?.phase !== PHASE.UNITE) || p?.alive === false) return { lp: pubLp, pending: 0, unite: false, left: null };
  const lp = self && Number.isFinite(self.lp) ? self.lp : pubLp;
  const leaker = pub.phase === PHASE.UNITE && Array.isArray(pub.unite?.leakers) && pub.unite.leakers.includes(p.playerId);
  const local = !self && leaker && uniteLocal && typeof uniteLocal === 'object' ? uniteRemaining(uniteLocal[p.playerId] ?? 0, null) : null;
  const rawLeft = pub.phase !== PHASE.UNITE ? null : self ? self.left : local != null ? local : p.uniteLeft;
  const left = Number.isFinite(rawLeft) && rawLeft >= 0 ? Math.trunc(rawLeft) : null;
  if (lp == null) return { lp, pending: 0, unite: false, left };
  const raw = self ? self.pending : local != null ? Math.min(cap, local) : p.pendingLp;
  const pending = Math.min(lp, Math.max(0, Math.trunc(Number(raw) || 0)));
  return { lp, pending, unite: (pending > 0 || left != null) && (self ? !!self.unite : pub.phase === PHASE.UNITE), left };
}

/** True when `watching` is already this teammate's field (their live field, or the prep scout `n:<id>`). */
export function teammateFieldShown(watching, player) {
  if (!watching || !player) return false;
  return watching === player.fieldId || watching === `n:${player.playerId}`;
}

/**
 * A single click on a teammate avatar calls onWatch only in server-run combat (no `observe`), and only when
 * that field is not already on screen. A double-click fires click first; the second click, and any later click
 * while the view is already theirs, must not open it again. Client combat never watches from the avatar click.
 * `askedRecently`: this avatar's click already called onWatch in the last moment (the other click of a double-click,
 * before `watching` has re-rendered).
 * @param {{ observe?: unknown, watching?: string|null, player?: { playerId?: string, fieldId?: string }|null, askedRecently?: boolean }} [o]
 * @returns {boolean}
 */
export function teammateClickWatches(o = {}) {
  if (o.observe || o.askedRecently) return false;
  if (o.player?.hidden) return false; // 2v2 opponent not revealed: expand the row, never watch it

  if (teammateFieldShown(o.watching, o.player)) return false;
  return !!o.player;
}

/**
 * Double-click in PHASE.PREP opens a teammate's field, skipping 「前往查看」. False — do not call onWatch — when
 * the phase is not PREP, the row is your own, there is no client-combat `observe` (the click already watched),
 * `canObserve` has no field (do not force a view; the click toasts), or that field is already open.
 * @param {{ phase?: string, self?: boolean, observe?: { canObserve?: (p: any) => { fieldId?: string }|null }|null,
 *   watching?: string|null, player?: any, askedRecently?: boolean }} [o]
 * @returns {boolean}
 */
export function prepDblClickWatches(o = {}) {
  if (o.phase !== PHASE.PREP || o.self || !o.player || !o.observe) return false;
  if (o.player.hidden) return false; // a hidden 2v2 opponent: 前往查看 is disabled, double-click must not bypass it
  if (o.askedRecently || teammateFieldShown(o.watching, o.player)) return false;
  const view = (typeof o.observe.canObserve === 'function' ? o.observe.canObserve(o.player) : null) || {};
  return !!view.fieldId;
}

/** How long the second click of a double-click counts as "already asked" before `watching` re-renders. */
const AVATAR_CLICK_GAP_MS = 500;

/**
 * Tooltip of a row's LP tower with a pending loss (null without one).
 * @param {{ lp: number|null, pending: number, unite: boolean, left: number|null } | null} lp rowLp(...)
 * @param {number} [cap] lpCapPerRound
 */
export function rowLpTip(lp, cap = 10) {
  if (!lp || !(lp.pending > 0)) return null;
  if (lp.unite && lp.left != null) return t('目标生命值 {lp}，联防中：漏过的敌人还剩 {left} 个，按现在结算扣除 {pending} 点（每回合至多 {cap} 点）', { lp: lp.lp, left: lp.left, pending: lp.pending, cap });
  return lp.unite ? t('目标生命值 {lp}，联防中，结算时扣除至多 {pending} 点', { lp: lp.lp, pending: lp.pending })
    : t('目标生命值 {lp}，结算时扣除 {pending} 点', { lp: lp.lp, pending: lp.pending });
}


/**
 * The roster's layout and fold state for `count` seats (the match screen asks, since it also places the danmaku): the
 * density follows the screen, and a change of density refolds (a list starts folded, the classic column open).
 * @param {number} count
 * @returns {{ phone: boolean, density: 'classic'|'list', open: boolean, setOpen: (fn: boolean|((on: boolean) => boolean)) => void, emotes: 'bubble'|'danmaku' }}
 */
export function useRoster(count) {
  const phone = useMedia(PHONE_QUERY);
  const density = teamDensity({ count, phone });
  const [state, setState] = useState(() => ({ density, open: rosterStartsOpen(density) }));
  const open = state.density === density ? state.open : rosterStartsOpen(density);
  useEffect(() => { if (state.density !== density) setState({ density, open }); }, [density]);
  const setOpen = (fn) => setState((s) => {
    const cur = s.density === density ? s.open : rosterStartsOpen(density);
    return { density, open: typeof fn === 'function' ? fn(cur) : !!fn };
  });
  return { phone, density, open, setOpen, emotes: teamEmoteMode({ density, open }) };
}

/** The newest emote per seat within `ttl` (bubbles beside the rows), re-rendering this panel alone when one expires. */
function useEmoteBubbles(ttl, on) {
  const emotes = useStore((s) => (on ? s.emotes : null));
  const [, expire] = useReducer((c) => c + 1, 0);
  const bubbles = on ? activeBubbles(emotes, Date.now(), ttl) : null;
  const next = bubbles && bubbles.size ? Math.min(...[...bubbles.values()].map((b) => (Number(b.at) || 0) + ttl)) : null;
  useEffect(() => {
    if (next == null) return undefined;
    const id = setTimeout(expire, Math.max(50, next - Date.now() + 20));
    return () => clearTimeout(id);
  }, [next]);
  return bubbles;
}

/**
 * Avatar clicks: server-run combat watches at once (not again for a field already on screen or the other click of a
 * double-click); client combat toggles 「前往查看」 under the row (`openPid`), the own row goes back to the own battle; in
 * PHASE.PREP a double-click opens the teammate's field.
 */
function useAvatarClicks({ pub, watching, onWatch, observe, halves }) {
  const [openPid, setOpenPid] = useState(null);
  // the playerId whose avatar just called onWatch, so the other click of a double-click does not open the view again
  const askedAt = useRef(/** @type {{ id: string|null, at: number }} */ ({ id: null, at: 0 }));
  const phaseKey = `${pub?.phase}:${pub?.round}:${uniteRelayKey(pub) || ''}`;
  useEffect(() => { setOpenPid(null); }, [phaseKey, watching, observe?.observing]);
  const askedRecently = (p) => askedAt.current.id === p?.playerId && Date.now() - askedAt.current.at < AVATAR_CLICK_GAP_MS;
  const noteAsked = (p) => { askedAt.current = { id: p.playerId, at: Date.now() }; };
  const click = (p, self) => {
    const half = halves?.half?.(p) || null;
    if (half) { setOpenPid(null); halves.onHalf(half, p); return; }
    if (!observe) {
      // your own row still goes home; a teammate already on screen (or just opened by this double-click) does not
      if (self || teammateClickWatches({ watching, player: p, askedRecently: askedRecently(p) })) {
        if (!self) noteAsked(p);
        onWatch(p);
      }
      return;
    }
    if (self) { if (observe.observing) observe.onBack(); setOpenPid(null); return; }
    const view = observe.canObserve(p) || {};
    if (!view.fieldId) {
      setOpenPid(null);
      if (!askedRecently(p)) { noteAsked(p); onWatch(p); } // the game screen toasts the reason; a double-click toasts once
      return;
    }
    setOpenPid((cur) => (cur === p.playerId ? null : p.playerId));
  };
  const dblClick = (e, p, self) => {
    if (!prepDblClickWatches({ phase: pub?.phase, self, observe, watching, player: p, askedRecently: askedRecently(p) })) return;
    e.preventDefault();
    setOpenPid(null);
    noteAsked(p);
    onWatch(p);
  };
  return { openPid, setOpenPid, click, dblClick };
}

/** Status glyph: the official ui/battle sprite (offline / ready / deciding / done / dead), else the CSS glyph. */
function RowStatus({ status, meta, offline }) {
  const sprite = offline ? 'icon_lost_connect' : STATUS_SPRITE[status];
  return html`<${Tooltip} text=${offline ? t('连接已断开') : t(meta.text)} placement="right">
    <span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', sprite && localAsset('ui/battle', sprite) && 'has-sprite')} aria-label=${t(meta.text)}>
      ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
        : STATUS_SPRITE[status] ? html`<${LocalSprite} name=${STATUS_SPRITE[status]} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
        : html`<${GIcon} name=${meta.glyph} />`}
    </span>
  <//>`;
}

/** One seat. `bubble`: its emote beside the row (classic roster), else null. */
export function TeamRow({ p, pub, myId, watching, onWatch, observe, halves, clicks, selfLive, cap, uniteLocal, team, frameArt, list, bubble, spMark = null }) {
  const self = p.playerId === myId;
  const status = p.pendingDeath ? 'rescue' : p.alive === false ? 'dead' : p.status;
  const meta = p.pendingDeath ? { ...STATUS_META.deciding, text: t('等待救援') } : STATUS_META[status] || STATUS_META.acting;
  // a player on a half of the 联防 / 最终攻势 field on screen: the tap switches the camera ('ALL': their half is shown)
  const half = halves?.half?.(p) || null;
  const watched = teammateFieldShown(watching, p);
  const offline = p.connected === false && !p.isBot;
  const open = !!observe && clicks.openPid === p.playerId && !self;
  const back = !!observe && self && observe.observing;
  // a 2v2 opponent the server still hides: the row expands, but watching it is refused (and the server says why).
  const locked = !!p.hidden;
  const title = locked ? t('你不能查看对手的信息')
    : half ? (half === 'ALL' ? t('返回全景') : self ? t('查看自己的半场') : t('查看 {name} 的半场', { name: p.name }))
    : observe ? (self ? (observe.observing ? t('返回战场') : t('你自己')) : t('查看 {name} 的战场', { name: p.name })) : (self ? t('查看自己的阵地') : t('查看 {name} 的阵地', { name: p.name }));
  const lp = rowLp(p, pub, self ? selfLive : null, { uniteLocal, cap });
  const inTeam = team.has(p.playerId);
  const { click, dblClick } = clicks;
  return html`<div data-seat=${p.seat} data-pid=${p.playerId} class=${cx('team__row', self && 'is-self', inTeam && 'is-team', watched && 'is-watched', p.alive === false && !p.pendingDeath && 'is-dead', p.pendingDeath && 'is-pending', open && 'is-open', offline && 'is-offline')}>
    <button type="button" class="team__btn" onClick=${() => click(p, self)} onDblClick=${(e) => dblClick(e, p, self)} title=${inTeam && !self ? `${title} · ${t('与你在同一战场')}` : title} aria-label=${title} aria-expanded=${observe && !self && !half ? String(open) : undefined}>
      <${PlayerAvatar} player=${p} self=${self} prefer="avatar">${p.shopLevel && !p.pendingDeath && !spMark ? html`<span class="pavatar__level" title=${t('调度中心等级')}><${Sprite} k=${`shopLevelSprite/shop_level_icon_${p.shopLevel}`} fallback=${html`<b class="num">${p.shopLevel}</b>`} /></span>` : null}</${PlayerAvatar}>
      ${inTeam ? html`<span class=${cx('team__frame', !frameArt && 'team__frame--plain')} style=${frameArt ? `--frame:url("${frameArt}")` : undefined} aria-hidden="true"></span>` : null}
      <span class="team__seat num">P${(p.seat ?? 0) + 1}</span>
      ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
      ${self ? html`<span class="team__you"><${Icon} name="user" /></span>` : null}
      ${spMark === 'done' ? html`<span class="team__spmark is-done" title=${t('已完成选择')}><${Icon} name="check" /></span>`
        : spMark === 'turn' ? html`<span class="team__spmark is-turn" title=${t('正在决策…')}><i></i><i></i><i></i></span>` : null}
    </button>
    <div class="team__info">
      <span class="team__name" title=${p.name || t('博士')}>${p.name || t('博士')}</span>
      <div class="team__line">
        <${LpTower} value=${lp.lp} size="sm" tone=${Number.isFinite(lp.lp) && lp.lp - lp.pending <= 5 ? 'danger' : null} pending=${lp.pending}
          tip=${rowLpTip(lp, cap)} />
        ${lp.left != null ? html`<${MissTag} n=${lp.left} name=${self ? null : p.name || t('博士')} />` : null}
        <${RowStatus} status=${status} meta=${meta} offline=${offline} />
        ${p.bondPlan ? html`<${BondPlanTag} bondId=${p.bondPlan} compact=${true} class="team__plan" />` : null}
        ${watched && !self ? html`<span class="team__eye" title=${t('正在查看')}><${GIcon} name="eye" /></span>` : null}
      </div>
      <${ReviveAction} pub=${pub} myId=${myId} target=${p} compact=${list} />
      <${KickAction} pub=${pub} myId=${myId} target=${p} compact=${list} />
      ${open ? (locked
        ? html`<${Tooltip} text=${t('你不能查看对手的信息')} placement="top">
            <button type="button" class="btn btn--primary btn--sm team__ob" disabled aria-disabled="true">
              <span class="btn__label">${t('前往查看')}</span></button><//>`
        : html`<button type="button" class="btn btn--primary btn--sm team__ob"
            onClick=${() => { clicks.setOpenPid(null); onWatch(p); }}><span class="btn__label">${t('前往查看')}</span></button>`) : null}
      ${back ? html`<button type="button" class="btn btn--secondary btn--sm team__back"
        onClick=${() => observe.onBack()}><span class="btn__label">${t('返回战场')}</span></button>` : null}
    </div>
    ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} at=${bubble.at} class="team__bubble" />` : null}
  </div>`;
}

/**
 * The bar on the flyout's left edge: > opens the 盟约 flyout beside the roster, < closes it again. It stays at the
 * roster's right edge, so the flyout grows to the right and never widens the roster or its header.
 */
export function BondsToggle({ open, onToggle }) {
  const label = open ? t('收起同盟盟约速查') : t('展开同盟盟约速查');
  return html`<button type="button" class=${cx('team__bonds-toggle', open && 'is-open')}
    aria-expanded=${String(open)} aria-controls="team-bonds" title=${label} aria-label=${label}
    onClick=${onToggle}><${Icon} name=${open ? 'chevronLeft' : 'chevronRight'} /></button>`;
}

/**
 * The display name for a flyout operator: the operator record itself, or the chess record that maps to it (a 补位 /
 * 自选 slot shows the operator it actually deploys). Cached per data load — the flyout draws every seat.
 * @param {string} id charId
 * @param {() => any} [chess] chess table (defaults to data/chess.json)
 * @returns {string|null}
 */
let charNamesSrc = null;
const charNames = new Map();

export function charName(id, chess = () => data.get('chess')) {
  const src = chess();
  if (src !== charNamesSrc) {
    charNamesSrc = src;
    charNames.clear();
    for (const rec of Object.values(src || {})) {
      if (rec?.charId && rec.name && !charNames.has(rec.charId)) charNames.set(rec.charId, rec.name);
    }
  }
  return charNames.get(id) || null;
}

/**
 * The chess record a flyout operator tile draws: null when `u.id` already is a chess id (the thumbnail's own
 * lookup works), else the char record composed from the body id `boardOps` sends (a `chars` key: its art, and the
 * elite bit for the E2 avatar). Exported for the UI tests.
 * @param {{ id: string, golden?: number }} u
 * @param {(id: string) => any} [lookup] chess lookup (defaults to data/chess.json)
 * @param {(id: string) => string|null} [nameOf] display name (defaults to charName)
 * @returns {any} a chess-shaped record, or null
 */
export function flyOpRec(u, lookup = (id) => data.lookup('chess', id), nameOf = charName) {
  if (!u?.id || lookup(u.id)) return null;
  return { charId: u.id, name: nameOf(u.id) || u.id, assets: { avatar: u.id }, isGolden: !!u.golden };
}

/** The chess id behind a flyout operator (the charId `boardOps` sends): the same id the 干员详情 card opens with, so
 *  tapping a tile in the flyout opens that operator's card. A charId with no chess record of its own falls back to the
 *  first record that maps to it (the elite record first when the seat's piece is elite). Exported for the UI tests. */
export function flyOpChessId(u, lookup = (id) => data.lookup('chess', id), chess = () => data.get('chess')) {
  if (!u?.id) return null;
  if (lookup(u.id)) return u.id;
  let plain = null;
  for (const [cid, rec] of Object.entries(chess() || {})) {
    if (rec?.charId !== u.id) continue;
    if (u.golden ? rec.isGolden : !rec.isGolden) return cid;
    if (!plain) plain = cid;
  }
  return plain;
}

/**
 * 浮窗里按观众看到的场上干员（PR #922 批注）。自己的座位读 m.private.boardOps；队友只在他那张战场正好在屏上时
 * 才有（准备期侦察，或观众有权观看的战斗 —— 其他战场 g.watch 已经拒绝过），且只含场上棋子、只含干员。
 * 返回值形如 `{ [playerId]: [{ id, golden? }] }`。
 * 准备期侦察（`prep: true`，fieldId `n:<pid>`）的棋盘在 meta 自身里：此时还没有战斗在跑，runner 里没有它的数据
 * （客户端战斗的对局在准备期 `cc` 仍为 true —— 在那里读 runner 会把明明画在屏上的那一行清空）。战斗在客户端战斗
 * 模式下读 runner 的棋盘，否则读 meta 的。
 * 导出供测试使用。
 */
export function flyOpsFor({ myId, priv = null, field = null, players = null, cc = false, runner = null }) {
  const out = {};
  const own = priv?.boardOps;
  if (Array.isArray(own) && own.length) out[myId] = own;
  if (!field?.fieldId) return out;
  // the field's members: a normal field / prep board is `n:<pid>`; a shared (府/联防) field lists them in `players` or sides
  const onField = (pid) => {
    if (Array.isArray(field.players)) return field.players.includes(pid);
    if (field.fieldId === `n:${pid}`) return true;
    return !!field.sides && typeof field.sides === 'object' && Object.prototype.hasOwnProperty.call(field.sides, pid);
  };
  for (const p of Array.isArray(players) ? players : []) {
    const pid = p.playerId;
    if (!pid || pid === myId || (p.alive === false && !p.pendingDeath) || !onField(pid)) continue;
    const units = (!field.prep && cc && runner ? runner.ownerOps?.(pid, field.fieldId) : field.units) || field.units || [];
    const ops = [];
    for (const u of units) {
      if (!u || u.kind !== 'op' || (u.ownerId && u.ownerId !== pid)) continue;
      if (u.area && u.area !== 'board') continue;
      const id = u.avatar || u.diy?.charId || u.defId || u.id;
      if (id) ops.push({ id, ...(u.golden ? { golden: 1 } : {}) });
    }
    if (ops.length) out[pid] = ops;
  }
  return out;
}

/**
 * 浮窗的干员名单：屏上视图优先，peek 补齐其余座位（server/match/match/peek.js，同盟盟约速查）。`base` 是
 * `flyOpsFor` —— 自己的 m.private boardOps，加上屏上战场里的队友；`peek` 是 `m.match.peek`，浮窗展开期间服务端
 * 发来的队友名单。peek 的空列表一律忽略：屏上已经画着的座位不会被一份更慢的帧清空，场上没有干员的座位也就没有条目。
 * 导出供 UI 测试使用。
 * @param {Record<string, Array<{ id: string, golden?: number }>>|null} base
 * @param {Record<string, Array<{ id: string, golden?: number }>>|null} peek
 * @returns {Record<string, Array<{ id: string, golden?: number }>>}
 */
export function mergeFlyOps(base, peek) {
  const out = { ...(base || {}) };
  if (!peek || typeof peek !== 'object' || Array.isArray(peek)) return out;
  for (const [pid, ops] of Object.entries(peek)) {
    if (out[pid] || !Array.isArray(ops) || ops.length === 0) continue;
    out[pid] = ops;
  }
  return out;
}

/**
 * 浮窗里一个座位的盟约：只有图标，不写名字、不显示「尚未激活盟约」—— 浮窗不复用 BondStrip（PR #922 批注，
 * 评审反对复用共享组件的意见）。本 fork 在这套形状之上保留自己的追加（owner request 2026-10-25）：`count/next`
 * 角标，队友那一行仍能看出每条盟约走到哪一步。角标沿用 `.bslot` / `.bslot__count`，与顶栏名册条共享定位规则
 * （css/game.css）。`size="sm"` 是上游的，保留：圆盘与棋盘上方的盟约条同尺寸（owner request 2026-11-12），
 * 浮窗一行读起来就像那条名册条。只有干员缩略图与策略图标按 css `--fly-ico` 画得更大。
 * @param {{ bonds?: any[] | null, ownerId: any, onBond?: ((bondId: string, ownerId: any) => void) | null,
 *   layersDisabled?: boolean }} props
 */
function FlyBonds({ bonds, ownerId, onBond = null, layersDisabled = false }) {
  const m = data.get('assets');
  const list = sortBonds(Array.isArray(bonds) ? bonds : [], (id) => data.lookup('bonds', id)).filter((b) => !b.off);
  return list.map((b) => {
    const rec = data.lookup('bonds', b.bondId);
    const th = Array.isArray(b.thresholds) && b.thresholds.length ? b.thresholds : rec?.thresholds || [];
    const next = nextThreshold(b.count ?? 0, th);
    const name = rec?.name || b.bondId;
    const title = `${name} ${b.count ?? 0}/${next ?? th[th.length - 1] ?? '-'}${b.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: b.harmony }) : ''}`;
    return html`<span key=${b.bondId} class=${cx('bslot', b.active && 'is-active')} data-bond=${b.bondId}>
      <${BondDisc} name=${name} icon=${bondIconUrl(m, b.bondId)} layers=${rec?.noStack ? undefined : b.layers ?? 0}
        tier=${b.tier ?? 0} maxTier=${Math.max(1, th.length)} active=${!!b.active} size="sm" showName=${false}
        layersDisabled=${layersDisabled} title=${title} onClick=${onBond ? () => onBond(b.bondId, ownerId) : undefined} />
      <span class=${cx('bslot__count', 'num', next == null && 'is-max')}>${b.count ?? 0}<small>/${next ?? th[th.length - 1] ?? '-'}</small></span>
    </span>`;
  });
}

/**
 * 一个座位场上的干员，画在盟约圆盘旁（owner request 2026-10-25）：`flyOpsFor` 组出的按观众名单 —— 自己的座位来自
 * m.private.boardOps，队友来自屏上的战场（PR #922 批注）。精简名单，只有 id 与精英位，缩略图不需要再查棋盘
 * （名字 / 星级 / 立绘来自 data/chess.json）。id 是干员的 **char** id（场上记录的实体：views.js
 * `assets.avatar || charId || piece.id` —— 补位槽显示的是实际出战的干员），它是立绘清单 `chars` 的键，绝不是
 * data/chess.json 的键（那里的键是 `chess_char_*`）：缩略图直接组合那条记录而不是查棋子表，否则每格都会显示 '?'。
 * 一行是一个座位的一行网格（css/screens/team.css）：盟约格与这一格分掉窗口宽度、各自内部滚动，长名单永远不会
 * 把策略方块挤走 —— 策略方块就是行高，不是窗口的三分之一。缩略图用 css `--fly-ico`（owner request 2026-11-12），
 * 与策略图标同尺寸，所以缩略图正好和旁边的方块一样大；隔壁格的盟约圆盘保持顶栏名册条的尺寸。
 * @param {{ ops?: Array<{ id: string, golden?: number }> | null,
 *   onOp?: ((u: { id: string, golden?: number }) => void) | null }} props
 */
function FlyOps({ ops, onOp = null }) {
  const list = Array.isArray(ops) ? ops : [];
  const body = list.length ? list.map((u, i) => {
    const rec = flyOpRec(u);
    const thumb = html`<${UnitThumb} key=${`${u.id}:${i}`} kind="chess" id=${u.id} rec=${rec} golden=${!!u.golden} />`;
    if (!onOp) return thumb;
    return html`<button key=${`${u.id}:${i}`} type="button" class="team__fly-opbtn"
      aria-label=${t('{name} 的干员卡', { name: rec?.name || u.id })}
      onClick=${() => {
        // An id with no chess record cannot open the card (a 补位 body that this version's data does not carry). Say so
        // in the non-blocking toast instead of leaving a button that silently ignores the tap (owner request 2026-11-12).
        if (flyOpChessId(u)) onOp(u);
        else toast(t('找不到这名干员的图鉴记录，无法打开干员卡'), 'warn');
      }}>${thumb}</button>`;
  }) : null;
  return cell('team__fly-ops', body);
}

/**
 * The strategy a seat picked in the opening draft, drawn to the right of its field operators (owner request
 * 2026-10-25): m.public players[].bandId — the same field the draft screen and the seat rows use. One icon, the name in
 * the tooltip; an empty cell keeps every row's third column on the same left edge. With `onOpen` it is a button: the
 * click opens `BandPopup` beside the square, the same name / effect / description the 本局信息 card shows. The button is
 * the cell itself (`team__fly-cell`), so the square keeps the same grey backing as the bonds and operator cells — a bare
 * `team__fly-band` button would have no backing at all and read as a floating glyph.
 * @param {{ bandId?: string|null, onOpen?: ((bandId: string, el: any) => void) | null }} props
 */
function FlyBand({ bandId, onOpen = null }) {
  const has = typeof bandId === 'string' && bandId;
  const icon = has ? html`<${BandIcon} bandId=${bandId} />` : null;
  if (!has || !onOpen) return cell('team__fly-band', icon);
  return html`<button type="button" class=${cx('team__fly-cell', 'team__fly-band', 'is-clickable')}
    aria-label=${t('{name} 的策略卡', { name: data.lookup('bands', bandId)?.name || bandId })}
    onClick=${(e) => onOpen(bandId, e.currentTarget)}>${icon}</button>`;
}

/** The band card the flyout opens beside its square (PR #922 review): the same name / effect / description the 本局信息
 *  card shows, kept small so it fits the flyout's own width. `position: fixed` in css — the bond and operator cells are
 *  horizontal scrollers and would clip an absolutely placed card. */
function BandPopup({ band, onClose }) {
  const b = data.lookup('bands', band.bandId);
  if (!b) return null;
  return html`<div class="team__fly-bandpop" role="dialog" aria-label=${t('策略')}
    aria-modal="true" style=${`top:${band.top}px;right:${band.right}px`}>
    <header class="team__fly-bandpop__head">
      <${BandIcon} bandId=${band.bandId} size="md" />
      <div class="team__fly-bandpop__titles">
        <small class="team__fly-bandpop__kicker">STRATEGY // ${band.owner ? t('{bandOwner} 的策略', { bandOwner: band.owner }) : t('我的策略')}</small>
        <b>${b.name}${b.effectName ? html` <small>${b.effectName}</small>` : null}</b>
      </div>
      <button type="button" class="team__fly-bandpop__close tapx" aria-label=${t('关闭')} onClick=${onClose}>
        <${Icon} name="close" />
      </button>
    </header>
    <${RichText} as="p" text=${b.descRaw || b.desc} class="team__fly-bandpop__desc" />
  </div>`;
}

/** One cell of the flyout's row: a horizontally scrolling track, its own backing, and no backing when empty (so the
 *  卡池 spacer stays transparent and reads as the divider between pools — owner request 2026-10-25). */
function cell(cls, body) {
  return html`<div class=${cx('team__fly-cell', cls, !body && 'is-empty')}>
    <div class="team__fly-track">${body}</div></div>`;
}

/**
 * 「同盟盟约速查」浮窗（用户需求 2026-10-24 / 2026-10-25，PR #922 批注）：拉杆立在最宽那行队伍栏的右缘
 * （`--fly-left`，在 TeamPanel 里量出），窗口向右展开，所以展开它既不会加宽队伍栏，也不会把表头挤走。拉杆占满
 * 队伍栏整个高度，窗口却从第一行的高度开始（css `--fly-top`，在 TeamPanel 里量出），每一行正好是那个座位队伍行
 * 的高度（`--fly-row-h`，镜像 `rowH`）—— 于是「同盟成员」表头旁边没有分组，每个头像的圆盘正好落在那一行右边，
 * 展开「前往查看」只会移动浮窗，而不会把后面的每一行顶下去。
 * 一行是每个座位的一行网格，分三列：盟约、场上干员、策略方块（owner request 2026-11-12）。方块就是行高，
 * 另外两列分掉窗口剩余宽度；三格同尺寸，格内图标按同一共享尺寸绘制。把三列放在**同一行网格**里，正是上游评审
 * 报告的那个 bug（PR #922）的修法：策略列单独成网格时，某行展开「前往查看」会把这个座位的策略方块顶得和盟约错位。
 * 前两列在各自格内横向滚动（长名单切不掉方块），窗口从锚点一直延伸到 HUD 右侧「指令 / 效果」列的左缘，那一列
 * 不在屏上时延伸到 HUD 自己的右缘（`--fly-w`，在 TeamPanel 里量出）—— 始终落在 css/devices.css 的安全区 /
 * 异形屏内边距里，绝不到页面的绝对右缘（owner request 2026-11-12）。选中的策略是按钮：点它在方块旁打开
 * `BandPopup`，点其他地方关闭。
 * 队伍栏收起时不渲染（TeamPanel 只在队伍栏展开时渲染它）。
 * 按棋子卡池分组（`pools`，rosterPools）的对局也在这里预留每个卡池表头的高度，于是整份名单里浮窗的行始终与
 * 对应的队伍行齐平（owner request 2026-10-25：横着一条线就是同一个座位）。
 * 浮窗里圆盘只有图标（owner request 2026-10-25）：没有名字之后，每个圆盘白色图形的中心都落在行的中线上，
 * 与干员缩略图、策略图标齐平。
 * @param {{ players: any[], myId: any, open: boolean, onToggle: () => void,
 *   onBond?: ((bondId: string, playerId: string) => void) | null,
 *   flyOps?: Record<string, Array<{ id: string, golden?: number }>> | null,
 *   onOp?: ((u: { id: string, golden?: number }, p: any) => void) | null,
 *   rowH?: Record<string, number> | null, layersDisabled?: boolean,
 *   pools?: Array<{ id: number|null, players: any[] }>|null,
 *   bandPop?: { bandId: string, owner: string|null, top: number, right: number } | null,
 *   rowsRef?: any, onBandPick?: ((bandId: string, owner: string, el: any) => void) | null,
 *   onBandClose?: (() => void) | null }} props
 */
export function BondsFlyout({ players, myId, open, onToggle, onBond = null, flyOps = null, onOp = null,
  rowH = null, layersDisabled = false, pools = null, bandPop = null, rowsRef = null, onBandPick = null, onBandClose = null }) {
  const row = (p) => {
    // 已经最终判死的座位不是浮窗能操作的状态：棋子清空、复制体回到共享卡池（server/match/player/round.js eliminate），
    // 盟约重算为空、棋盘清空。行仍留在网格里（三列必须对齐），但灰掉并让所有控件不可点，读起来是「已淘汰」，
    // 而不是「还没东西可显示」。救援窗口**不是**死亡：`pendingDeath` 期间这个座位仍算存活（实验性救援，
    // owner request 2026-11-12）。
    const dead = p.alive === false && !p.pendingDeath;
    return html`<section key=${p.playerId} class=${cx('team__fly-row', p.playerId === myId && 'is-self', dead && 'is-dead')}
      style=${rowH?.[p.playerId] ? `--fly-row-h:${rowH[p.playerId]}px` : undefined}>
      <!-- a hidden 2v2 opponent has no bonds to show: keep the cell (the grid columns must stay aligned) but print
           nothing, rather than 「尚未激活盟约」 which reads as if the opponent had none to share. -->
      ${cell('team__fly-bonds', p.hidden ? null : html`<${FlyBonds} bonds=${p.bonds} ownerId=${p.playerId}
        layersDisabled=${layersDisabled} onBond=${onBond && !dead ? (id) => onBond(id, p.playerId) : null} />`)}
      <${FlyOps} ops=${flyOps?.[p.playerId] || null} onOp=${onOp && !dead ? (u) => onOp(u, p) : null} />
      <${FlyBand} bandId=${p.bandId}
        onOpen=${onBandPick && !dead ? (id, el) => onBandPick(id, p.name || p.playerId, el) : null} />
    </section>`;
  };

  const spacer = () => html`<div class="team__fly-pool" aria-hidden="true"></div>`;
  const groups = () => (pools && pools.length > 1
    ? pools.map((pool) => html`<${Fragment} key=${pool.id ?? 'rest'}>${spacer()}${pool.players.map(row)}<//>`)
    : players.map(row));

  return html`<div class=${cx('team__fly', open && 'is-open')}>
    <${BondsToggle} open=${open} onToggle=${onToggle} />
    ${open ? html`<div class="team__fly-window" id="team-bonds" role="region" aria-label=${t('同盟盟约速查')}>
      <div ref=${rowsRef} class="team__fly-rows">${groups()}</div>
      ${bandPop ? html`<${BandPopup} band=${bandPop} onClose=${onBandClose} />` : null}
    </div>` : null}
  </div>`;
}

/** An experimental room's pool header: 卡池 N, its seat count, 你的卡池 on the own one. */
function PoolHead({ pool }) {
  return html`<div class=${cx('team__pool-head', pool.mine && 'is-mine')}>
    <span class="team__pool-name">${pool.id == null ? t('其他') : t('卡池 {n}', { n: pool.id })}</span>
    <small class="num">${t('{n} 人', { n: pool.players.length })}</small>
    ${pool.mine ? html`<small class="team__pool-mine">${t('你的卡池')}</small>` : null}
  </div>`;
}

/**
 * @param {{ pub:any, myId:string, watching:string|null, onWatch:(p:any)=>void, roster: ReturnType<typeof useRoster>,
 *   emoteTtl?: number, teamLp?: number|null, self?: { lp?: number|null, pending: number, unite: boolean, left?: number|null } | null,
 *   cap?: number, uniteLocal?: Record<string, number> | null,
 *   observe?: null | { canObserve: (p:any) => { fieldId?: string, reason?: string|null, back?: boolean }, observing: boolean, onBack: () => void },
 *   halves?: null | { half: (p:any) => 'L'|'ALL'|'R'|null, onHalf: (layer: string, p: any) => void } }} props
 *   halves.half: the ‹ › layer a tap on that player's avatar switches to (battle/observe.js avatarLayer), null = the usual flow
 *   spMarks: the shared 机变 draft's pick order on the portraits (ui/choiceOverlay.js spMarks: ✓ picked, ••• deciding)
 *   uniteLocal: the local 联防 replica's per-leaker counts while it is on screen (battle runner state().uniteLeft), else null
 *   onBond: 点击浮窗圆盘打开该玩家的盟约弹窗（screens/game.js openBond）；缺省 = 圆盘不可点
 *   onFlyToggle: 浮窗展开 / 收起 —— g.peek { open }（server/match/match/peek.js）；缺省 = 不走 peek
 *   phaseKey: 屏幕所处的回合与阶段 —— 变化时收起浮窗（peek 订阅就在那道边界结束）
 *   online: 连接状态 —— 重连（false → true）同样收起浮窗（旧订阅已随断线结束）
 */
export function TeamPanel({ pub, myId, watching, onWatch, roster, emoteTtl = 3000, observe = null, halves = null, self: selfLive = null, cap = 10, uniteLocal = null, spMarks = null, onBond = null,
  flyOps = null, onOp = null, layersDisabled = false, onFlyToggle = null, phaseKey = null, online = null }) {
  const players = sortedPlayers(pub);
  const { density, open: rosterOpen, setOpen: setRosterOpen, phone } = roster;
  const list = density === 'list';
  const bubbles = useEmoteBubbles(emoteTtl, roster.emotes === 'bubble');
  const clicks = useAvatarClicks({ pub, watching, onWatch, observe, halves });
  const pools = list ? rosterPools(pub, players, myId) : null;
  const panelRef = useRef(null);
  const noticeRef = useRef(null);
  const headerRef = useRef(null);
  const [layout, setLayout] = useState(() => teamPanelLayout(players.length, 0));
  // 队伍栏旁的「盟约」浮窗：由队伍栏右缘的拉杆打开（箭头 > / < 切换）；它占满队伍栏高度，且只在队伍栏展开时存在
  const [bondsOpen, setBondsOpen] = useState(false);
  // 同盟盟约速查（server/match/match/peek.js）：展开浮窗即向服务端索要队友的干员名单，收起即解除订阅。
  // 队伍栏折起时浮窗状态维持原样，所以只有拉杆会上报。
  useEffect(() => { if (onFlyToggle) onFlyToggle(bondsOpen); }, [bondsOpen]);
  // 阶段边界：浮窗只是对打开它的那个准备 / 战斗窗口瞥一眼，所以回合或阶段变化就收起它 —— 这次 close 正是链路上
  // 结束 peek 订阅的动作。服务端本来也会在同一道边界丢弃订阅，那是针对「从不发 close 的客户端」的冗余保障。
  const phaseRef = useRef(phaseKey);
  useEffect(() => {
    if (phaseRef.current === phaseKey) return;
    phaseRef.current = phaseKey;
    setBondsOpen(false);
  }, [phaseKey]);
  // 重连：订阅随断开的连接结束（server/match/match/peek.js 在断线时丢弃），而回来的玩家想看主画面而不是他离开时
  // 开着的面板 —— false → true 的边沿直接收起浮窗。
  const onlineRef = useRef(online);
  useEffect(() => {
    const was = onlineRef.current;
    onlineRef.current = online;
    if (online === true && was === false) setBondsOpen(false);
  }, [online]);
  // 浮窗的每一行镜像对应的队伍行（PR #922 批注）：只量第一行时，前面某行展开「前往查看」会让后面每一行错位。
  // 队伍行上的 `data-pid` 就是连接键。
  const [rowH, setRowH] = useState({});
  // 浮窗在方块旁打开的盟约卡（PR #922 批注）：状态放在 TeamPanel 而不是 BondsFlyout 里，浮窗才能保持成一棵纯 vnode
  // 树，test/ui/watch-bonds.test.js 不用渲染就能遍历。
  const flyRowsRef = useRef(null);
  const [bandPop, setBandPop] = useState(null);
  useEffect(() => {
    if (!bondsOpen) setBandPop(null);
    const rows = flyRowsRef.current;
    if (rows) for (const c of rows.querySelectorAll('.team__fly-cell')) c.scrollLeft = 0;
  }, [bondsOpen]);
  useEffect(() => {
    if (!bandPop) return undefined;
    const close = (e) => {
      if (e.target?.closest?.('.team__fly-bandpop') || e.target?.closest?.('.team__fly-band')) return;
      setBandPop(null);
    };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [bandPop]);
  // A click anywhere outside the open flyout closes it — the command column, the shop, 升级 / 冻结 / 刷新, the bench,
  // 查看迎击单位, 本局信息 (upstream PR #922, merged 2026-11-12). The roster itself (`.team`: its rows, 前往查看 /
  // 返回战场 and the toggle) keeps it open, as does a click in the flyout's own gaps (between rows or cells, the
  // window's padding) and the band popup or operator card.
  useEffect(() => {
    if (!bondsOpen) return undefined;
    const onDown = (e) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.team, .bpop, .dpanel')) return;
      setBondsOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [bondsOpen]);
  // fixed, beside the square that was clicked (upstream PR #922's placement, synced 2026-11-12): the card's right edge
  // sits 8px to the LEFT of the square, its top on the square's top, clamped so its ~240px body never runs off the bottom.
  // The cells are horizontal scrollers and clip an absolutely placed card, so it is position: fixed.
  const openBandPop = (bandId, owner, el) => {
    const r = el?.getBoundingClientRect?.();
    const vw = globalThis.innerWidth || document.documentElement.clientWidth || 1920;
    const vh = globalThis.innerHeight || document.documentElement.clientHeight || 1080;
    setBandPop({
      bandId,
      owner: owner || null,
      right: r ? Math.max(8, Math.round(vw - r.left + 8)) : 8,
      top: r ? Math.max(8, Math.min(Math.round(r.top), Math.round(vh - 240))) : 8,
    });
  };
  // a desktop list takes a second column when its seats do not fit the height (phones: one column, the drawer scrolls)
  const measured = list && rosterOpen && !phone;
  // where the roster's rows begin: the 盟约 window starts there, so the 同盟成员 header has no group beside it
  const rosterRef = useRef(null);
  useEffect(() => {
    const panel = panelRef.current;
    const rosterEl = rosterRef.current;
    if (!panel || !rosterEl) return undefined;
    const place = () => {
      if (rosterEl.hidden) return;
      const box = panel.getBoundingClientRect();
      const top = rosterEl.getBoundingClientRect().top - box.top;
      panel.style.setProperty('--fly-top', `${Math.max(0, Math.round(top))}px`);
      // the anchor is the right edge of the WIDEST roster row, not the panel's padding edge (PR #922 model): the bar
      // stands there and the window opens from it, so a row that does not fill the panel still has its flyout row
      // level with it (owner request 2026-11-12: the width is copied from the optimised branch)
      let widest = box.width;
      for (const row of rosterEl.querySelectorAll('.team__row')) widest = Math.max(widest, row.getBoundingClientRect().right - box.left);
      // round UP, not to the nearest px: the column is content-driven and its width is fractional, so rounding down let
      // the bar's left edge land inside the column (up to 1px, a hairline that reads as the bar covering the roster's
      // right edge — owner report 2026-11-12). Ceiling keeps it at or just outside the roster's edge.
      const anchor = Math.ceil(widest);
      // the flyout takes the roster's own metrics: a list seat carries a 1px frame (46px, not the nominal 44) and a
      // 卡池 head is as tall as its line box (~26px, not the 24px minimum), so a fixed height would drift a little
      // lower down every row (owner request 2026-10-25: one line across is one and the same seat). Every row is
      // measured, not just the first (PR #922 review): an expanded 「前往查看」 row must move the row beside it too.
      const heights = {};
      for (const row of rosterEl.querySelectorAll('.team__row')) {
        heights[row.dataset.pid] = Math.round(row.getBoundingClientRect().height * 10) / 10;
      }
      setRowH((prev) => (JSON.stringify(prev) === JSON.stringify(heights) ? prev : heights));
      const first = rosterEl.querySelector('.team__row');
      if (first) panel.style.setProperty('--fly-row', `${heights[first.dataset.pid]}px`);
      const head = rosterEl.querySelector('.team__pool-head');
      if (head) panel.style.setProperty('--fly-pool', `${head.getBoundingClientRect().height}px`);
      else panel.style.removeProperty('--fly-pool');
      if (!bondsOpen) {
        for (const key of ['--fly-left', '--fly-w', '--fly-square']) panel.style.removeProperty(key);
        return;
      }
      const bar = panel.querySelector('.team__bonds-toggle')?.getBoundingClientRect().width || 44;
      // The window stops at the left edge of whatever occupies the right side of the HUD, plus an 8px gutter (upstream's
      // rule, PR #922): the 指令 / 效果 column when it is on screen, otherwise the HUD's own right edge. That edge is the
      // HUD box, which already carries the safe-area and 异形屏 insets (css/devices.css §2, §5) — the flyout must stop
      // there, not at the page's absolute right edge (owner request 2026-11-12). The effects column fades out in the
      // 敌方预览 pen view, so the HUD edge is the fallback there too. When the 规程 season lands its own 策略操作列 it
      // takes priority over the effects column in this lookup (owner request 2026-11-12).
      const hud = panel.closest('.gm__hud') || document.documentElement;
      const fx = hud.querySelector('.gm__effects');
      const fxRect = fx && !hud.closest('.gm.is-pen') ? fx.getBoundingClientRect() : null;
      const right = fxRect && fxRect.width > 0 ? fxRect.left - 8 : hud.getBoundingClientRect().right || window.innerWidth;
      const flyW = Math.max(220, Math.round(right - box.left - anchor - bar));
      // the strategy column is a square: its width is the row height, so --fly-square is the SHORTEST measured row —
      // every square in the window is then the same size, and the rest of the window is divided between the bonds and
      // the operators columns (PR #922 model, owner request 2026-11-12). There is no equal-third cap: the square is the
      // row, not a third of the window.
      const vals = Object.values(heights);
      const square = vals.length ? Math.round(Math.min(...vals)) : 64;
      panel.style.setProperty('--fly-left', `${anchor}px`);
      panel.style.setProperty('--fly-w', `${flyW}px`);
      panel.style.setProperty('--fly-square', `${square}px`);
    };
    place();
    // The compact roster scrolls with the wheel and with a dragged mouse (owner request 2026-10-25: a 20-seat room is
    // one scrolling column and its scrollbar stays hidden, css). A wheel or a drag over the 盟约 flyout beside it moves
    // the roster too, and the two always hold the same offset, so a group never drifts off the row it belongs to. Touch
    // keeps the browser's own panning (`touch-action: pan-y`). A row's own cell scrolls sideways on its own (PR #922
    // review): a long bond strip or operator list pans inside its cell and never cuts the strategy square.
    const scrollers = () => [rosterEl, panel.querySelector('.team__fly-rows')].filter((el) => el && !el.hidden);
    const sync = () => {
      for (const el of scrollers()) if (el !== rosterEl) el.scrollTop = rosterEl.scrollTop;
    };
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // zoom / a sideways swipe stays native
      const max = rosterEl.scrollHeight - rosterEl.clientHeight;
      if (max <= 0) return;
      if (e.cancelable) e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * rosterEl.clientHeight : e.deltaY;
      rosterEl.scrollTop = Math.max(0, Math.min(max, rosterEl.scrollTop + dy));
      sync();
    };
    let drag = null;
    let swallow = false;
    const onDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const cell = e.target?.closest?.('.team__fly-cell');
      if (cell && cell.scrollWidth > cell.clientWidth) {
        drag = { host: cell, axis: 'x', id: e.pointerId, x: e.clientX, left: cell.scrollLeft, moved: false };
        return;
      }
      drag = { host: e.currentTarget, axis: 'y', id: e.pointerId, y: e.clientY, top: rosterEl.scrollTop, moved: false };
    };
    const onMove = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag.axis === 'x' ? e.clientX - drag.x : e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(d) < 6) return;
        drag.moved = true;
        drag.host.setPointerCapture?.(e.pointerId);
        drag.host.classList.add('is-dragging');
      }
      if (drag.axis === 'x') {
        drag.host.scrollLeft = Math.max(0, Math.min(drag.host.scrollWidth - drag.host.clientWidth, drag.left - d));
        return;
      }
      rosterEl.scrollTop = Math.max(0, drag.top - d);
      sync();
    };
    const onUp = () => {
      const d = drag;
      drag = null;
      if (!d?.moved) return;
      d.host.classList.remove('is-dragging');
      // the press became a drag: its click must not pick a row or open a bond
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
    };
    const onClick = (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const targets = scrollers();
    for (const el of targets) {
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('click', onClick, true);
    }
    sync();
    rosterEl.addEventListener('scroll', sync, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(panel);
    observer?.observe(rosterEl);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', place);
      rosterEl.removeEventListener('scroll', sync);
      for (const key of ['--fly-top', '--fly-row', '--fly-pool', '--fly-left', '--fly-w', '--fly-square']) panel.style.removeProperty(key);
      for (const el of targets) {
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.removeEventListener('click', onClick, true);
        el.classList.remove('is-dragging');
      }
    };
  }, [rosterOpen, density, measured, layout.rows, bondsOpen, pub?.revival?.windowOpen, !!pub?.kickVote]);
  useEffect(() => {
    if (!measured) return undefined;
    const panel = panelRef.current;
    const measure = () => {
      if (!panel) return;
      const css = getComputedStyle(panel);
      const notice = noticeRef.current?.getBoundingClientRect().height || 0;
      const header = headerRef.current?.getBoundingClientRect().height || 0;
      const height = panel.clientHeight - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0) - notice - header;
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 40;
      // the widest the panel may grow (css/screens/team.css --team-w2)
      const width = Math.min(innerWidth * 0.32, Math.max(520, root * 5.2)) - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
      const next = teamPanelLayout(players.length, height, root, width, document.documentElement.classList.contains('sp-coarse'), pools ? pools.length * 30 : 0);
      setLayout(prev => prev.columns === next.columns && prev.rows === next.rows && prev.rowHeight === next.rowHeight ? prev : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (panel) observer?.observe(panel);
    if (noticeRef.current) observer?.observe(noticeRef.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [measured, players.length, pools ? pools.length : 0, pub?.revival?.windowOpen, !!pub?.kickVote]);
  if (!players.length) return null;
  // a boss round: the viewer's pair framed in green from the round's start (item 51 — the official bg_team_border,
  // tinted like the official green; a plain green ring without the local art)
  const team = teamFrameIds(pub, myId);
  const frameArt = team.size ? localAsset('ui/battle', 'bg_team_border') : null;
  // an open 盟约 flyout keeps the roster in one column (owner request 2026-10-25): with two columns two seats would be
  // level with a single flyout row, so a line across could not be one and the same seat
  const columns = measured && !bondsOpen ? layout.columns : 1;
  const style = list ? `--team-columns:${columns};--team-rows:${Math.ceil(players.length / columns)}` : undefined;
  const row = (p) => html`<${TeamRow} key=${p.playerId} p=${p} pub=${pub} myId=${myId} watching=${watching} onWatch=${onWatch} observe=${observe} halves=${halves} clicks=${clicks} spMark=${spMarks?.get(p.playerId) || null}
    selfLive=${selfLive} cap=${cap} uniteLocal=${uniteLocal} team=${team} frameArt=${frameArt} list=${list} bubble=${bubbles?.get(p.playerId) || null} />`;
  return html`<aside ref=${panelRef} class=${cx('team', `team--${density}`, list && columns > 1 && 'team--wide', pools && 'team--pools', !rosterOpen && 'is-folded', rosterOpen && 'is-open')} style=${style} aria-label=${t('同盟成员')}>
    <div ref=${headerRef} class="team__header">
      <button type="button" class="team__toggle" aria-expanded=${String(rosterOpen)} aria-controls="team-roster" onClick=${() => setRosterOpen(on => !on)}>
        <${Icon} name="users" /><span>${t('同盟成员')}</span><b class="num">${players.length}</b><${Icon} name="chevronRight" />
      </button>
    </div>
    <div ref=${noticeRef} class="team__notice"><${RevivalNotice} pub=${pub} /><${KickVoteNotice} pub=${pub} /></div>
    <div class="team__body">
      <div ref=${rosterRef} class="team__players" id="team-roster" hidden=${!rosterOpen}>${pools
        ? pools.map((pool) => html`<section key=${pool.id ?? 'rest'} class=${cx('team__pool', pool.mine && 'is-mine')}><${PoolHead} pool=${pool} />${pool.players.map(row)}</section>`)
        : players.map(row)}</div>
    </div>
    ${rosterOpen && players.length > 1 ? html`<${BondsFlyout} players=${players} myId=${myId} open=${bondsOpen} pools=${pools}
      rowH=${rowH} layersDisabled=${layersDisabled} flyOps=${flyOps} onOp=${onOp}
      bandPop=${bandPop} rowsRef=${flyRowsRef} onBandPick=${openBandPop} onBandClose=${() => setBandPop(null)}
      onToggle=${() => setBondsOpen(on => !on)} onBond=${onBond} />` : null}
  </aside>`;
}
