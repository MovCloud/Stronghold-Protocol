// Room screen (同盟等待室) — 2026-10-14: the room design by 雨千代chiyo (the event's room), adopted by the owner with this
// fork's own features kept. Tall seat cards side by side — a portrait per doctor (名片干员: the player's own pick, else an
// operator chosen from the player id, ui/seatArt.js), 创建者, 已就绪 / 准备中 / 失去信号, the name plate (名片底图, the trophy
// level, the 服主 mark — room.state seats[].card / .owner, ui/playerCard.js, ui/ownerName.js), the host's 移出; an AI seat
// names the strategy it takes in the draft (AI 指定策略: room.setBotBand; seats[].band, null = 自动选择 — the host's chip
// opens the picker, a strategy set for another AI is greyed out) and the host's ✕ removes it; an empty seat is 邀请
// (copies the alliance key) and, for the host, 添加 AI 队友. Expanded rooms (8–20 seats, 实验性选项) scroll sideways —
// without a scrollbar: a mouse drags the row (ui/dragScroll.js), touch and pen keep the browser's own swipe.
// Top: leave, the time waited, 统计 / 设置 / 玩法说明, the alliance
// key with 复制 / 链接. Bottom: 实验性选项 (left, as in the earlier room; marked when an option is changed), the status
// line, the difficulty | ⚙ pill (the host picks the difficulty in 选择模拟协议; ⚙ holds AI 队友最后选择, 允许观战者接替 AI
// and 实验性选项 again), 组队匹配 (host: the whole party joins the public
// queue — queue.join { party: true }; everybody sees the queue, ui/matchmaking.js QueueFlow) and 开始模拟 (host) or 准备就绪.
// Motion (css tr-*): the room comes up from black card by card and fades out when left; a doctor turning 已就绪 flashes
// green; 选择模拟协议 and ⚙ stay mounted while they fade out (ui/transitions.js).
// Room settings (the maintainer's PR #643 keep / drop list of 2026-10-15): a co-op room is created at once from the
// lobby's 创建同盟 (the event's 联合模拟, research 06 §3.2; the maintainer's decision of 2026-10-21), so the difficulty is
// chosen here — the host's pill (or ⚙'s 模拟难度 row) opens 选择模拟协议 (screens/lobby.js ProtocolSelect) whose 确认 sends
// room.setDifficulty; the dialog closes only once the server took it (a refusal keeps it open with the error toast), and
// its hint states the server's rules: the other doctors have to ready again, a plugin mode the host chose is left.
// ⚙ 同盟设置 lists the 模拟难度, the 「允许观战者接替 AI」 and the 「AI 队友最后选择」 switch; a timed solo's ⚙ is 模拟设置 and
// holds 「不限时」 (DESIGN §35.23.10). The other doctors (and spectators) open the same screens read-only — the cards
// shown, not chosen, 由创建者选择 / 由创建者设置 — and a toast tells them when the host changed the difficulty [ASSUMED: a
// remake aid, since the change reset their ready state; how the event tells the others is not recorded].
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the mode name in the top bar (the orange chip).
// 名片干员 (PR #643 split 6): a doctor's seat card shows an operator's portrait — the one the player picked (更换立绘 on
// one's own seat opens the picker: search, rarity, 默认; kept as a pref — ui/seatArt.js cardStore — and sent as
// room.card by ui/loadoutSync.js installCardSync, so the room sees it as seats[].card), else one of the 5★/6★ operators
// chosen by the player id (ui/seatArt.js), the same on every client. [ASSUMED] The pick made here and kept in this
// browser stands in for the event's account assistant (名片形象); [ASSUMED] the default by player id is a remake rule.
// Outfits (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21): the portrait wears the player's outfit — one's own
// card this browser's choice at once, another doctor's the map that seat published (room.state seats[].skins) unless
// 「显示其他玩家的皮肤」 is off; an outfit this page's appearance plugins do not have draws the default art (ui/seatArt.js
// seatCardSkin). The picker is one's own picker, so its tiles wear one's own outfits too (like 干员调配's).
// Without the art pack the card keeps its avatar frame; a bot keeps its robot frame. A player with no 名片 pick — an AI
// seat, which has no card on the wire, and a human seat on 默认 — gets the deterministic pick from the default pool
// (ui/seatArt.js defaultCardPick — the fork's rule, docs/design/client.md §10), the same on every client: it is the seat
// card's 立绘, and for a human seat with no 头像 of their own the plate's avatar too (the same operator as the team row,
// ui/gameComponents.js PlayerAvatar). The plate's avatar stays the robot frame for a bot.
// Official versions (DESIGN §35.23, M1; versions.js): a room plays one version (room.state.version; absent = 第二期下半).
// Another version's name shows beside the mode in the top bar (ui/pluginTag.js VersionTag) and every page loads and checks
// its data like a gameplay plugin's content set (content.js) — the seat tags read 版本数据载入中 / 就绪 / 校验失败 and
// 准备就绪 / 开始模拟 wait for it (needsContent: gameplay plugins or another version; 非官方 stays the plugins' alone).
// The version pill beside the difficulty opens the version picker (ui/versionPicker.js) — the bottom bar is its only entry
// (⚙ keeps the co-op rules only, no duplicate version row): the
// host's pick proposes the switch (room.proposeVersion: a lone human's room switches at once; otherwise the seated humans
// vote — ui/versionVote.js, the strip between the 观战席 and the footer); everybody else reads it (由创建者发起). It is off
// during a vote, with gameplay plugins on (they play 第二期下半 only) and offline. A switch is told to everybody (a toast,
// never on entering a room), and a room whose version is not this browser's lobby choice says that leaving restores it.
// Texts go through t() (docs/I18N.md).

import { audio } from '../audio.js';
import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, MAX_SPECTATORS, PLAYBACK } from '../../../shared/constants.js';
import { roomCapacity } from '../../../shared/playerCapacity.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyIcon, Tooltip, Spinner, confirmDialog, doctorNo, Modal,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { TestMark } from '../ui/testConsole.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { useDragScroll } from '../ui/dragScroll.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, VersionTag, isModdedRoom } from '../ui/pluginTag.js';
import { VersionVote, versionVoteOf } from '../ui/versionVote.js';
import { VersionPicker } from '../ui/versionPicker.js';
import { DEFAULT_VERSION, lobbyVersion, needsContent, offeredDifficulties, roomVersion, serverDefaultVersion, soloTimedOf, soloTimeMsgid, versionLabel } from '../versions.js';
import { hasScriptConsent, rememberScriptConsent, pageVersion } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, loadPref, savePref } from '../store.js';
import { data, useData, getConfig } from '../data.js';
import { chessPortraitUrl } from '../ui/assetUrls.js';
import { cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc, CARD_PREF, seatPortrait, cardAvatarUrl, defaultCardPick } from '../ui/seatArt.js';
import { CARD_SYNC, useMyCard, cardMessage, seatCardMatches } from '../ui/playerCard.js';
import { NameCardLayer } from '../ui/namecards.js';
import { TrophyBadge } from '../ui/trophies.js';
import { OwnerBadge, isOwnerSeat } from '../ui/ownerName.js';
import { skinsStore, SKINS_KEY } from '../ui/skins.js';
import { settingsStore } from '../ui/settingsStore.js';
import { difficultyInfo, ProtocolSelect } from './lobby.js';
import { usePresence, useRise, afterLeave } from '../ui/transitions.js';
import { ExperimentalOptions, experimentalChanged, experimentalSummary } from '../ui/experimental.js';
import { QueueFlow, queueActive } from '../ui/matchmaking.js';
import { useGameData, BandIcon } from '../ui/gameComponents.js';
import { allowedBands } from './bandDraft.js';
import { t, tc } from '../../../shared/i18n.js';

/**
 * Seats padded to the room's capacity (co-op 4, an expanded room 8–20, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = roomCapacity(room?.mode, room?.experimental);
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  // a room with gameplay plugins (DESIGN §32.6) or another official version (§35.23): every player's page has loaded and
  // checked its content (the host's too); `modded` (非官方) is the plugins' alone
  const modded = isModdedRoom(room);
  const loadsContent = needsContent(room);
  const contentReady = !loadsContent || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    needsContent: loadsContent,
    // another official version (its seat tags and texts; a gameplay plugin room keeps the plugins' words)
    versionRoom: loadsContent && !modded,
    contentReady,
    myContent: loadsContent ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * 2V2 双人组队匹配 (user request 2026-11-07): one complete team and the other team empty is ONE party. It queues with
 * required = the room's full capacity (4 in versus), so two such parties form one 4-seat versus match; the shape is
 * computed from seat halves rather than hard-coded 2 so a future 1- or 3-player side follows the same rule.
 */
export function versusPartySlot(room) {
  if (!room || room.mode !== 'versus') return false;
  const seats = Array.isArray(room.seats) ? room.seats : [];
  if (seats.length < 2 || seats.length % 2) return false;
  const half = seats.length / 2;
  const humans = seats.map((s, i) => (s && s.playerId && !s.isBot ? i : -1)).filter((i) => i >= 0);
  if (humans.length !== half) return false;
  return humans.every((i) => Math.floor(i / half) === Math.floor(humans[0] / half));
}

/** Client hint only; the server independently validates every party member before queuing. */
export function partyQueueReason(room, myId, online = true) {
  if (!online) return t('连接中断，请稍候重试');
  if (!room || room.inMatch) return t('仅等待中的好友同盟可组队匹配');
  if (room.mode !== 'coop' && room.mode !== 'versus') return t('仅等待中的好友同盟可组队匹配');
  if (room.mode === 'versus' && !versusPartySlot(room)) return t('2V2 组队匹配需要一支队伍满员、另一支队伍为空');
  if (room.hostId !== myId) return t('由同盟创建者发起组队匹配');
  const seats = room.seats?.filter(Boolean) || [];
  if (seats.some(s => s.isBot)) return t('请先移除 AI 队友，公开匹配仅限真人');
  if (!seats.length || seats.some(s => s.connected === false)) return t('请等待所有队友连接后再匹配');
  if (seats.some(s => s.playerId !== room.hostId && !s.ready)) return t('仍有博士未准备就绪');
  return null;
}

/**
 * The co-op room option 「AI 队友最后选择」 (GitHub #338; room.setAiPicksLast, room.state.aiPicksLast): in the strategy and
 * 机变 drafts every human picks before the AI teammates. null in a solo room (no AI teammates); otherwise its state (off
 * when the server sends none) and whether this player may switch it — the host only, the others see it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

/**
 * 「全局默认速度」 (room.setSpeed): 1× or 2×, what every match and every round starts at — the host sets it before the
 * match, everybody else sees it. A 快进 or 60× skip that a vote won covers only the battle it was voted in.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ speed: number, editable: boolean } | null}
 */
export function speedOption(room, myId) {
  if (!room) return null;
  return { speed: room.speed === PLAYBACK.NORMAL ? PLAYBACK.NORMAL : PLAYBACK.FAST,
    editable: !room.inMatch && room.hostId != null && room.hostId === myId };
}

/** Spectator handover is available only in original default-version co-op rooms, with a host opt-in. */
export function aiTakeoverOption(room, myId) {
  if (!room || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION || room.content?.vanilla === false) return null;
  return { on: room.aiTakeoverEnabled === true, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

/**
 * The solo room option 「不限时」 (DESIGN §35.23.10; room.setSoloUnlimited). null unless the room is solo AND `timed`
 * is exactly true (a version whose solo is timed, and whose data is on screen). Off when room.state omits the key.
 * The host switches it; everybody else sees it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @param {boolean | null} timed soloTimedOf(config, room version)
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function soloUnlimitedOption(room, myId, timed) {
  if (!room || room.mode !== 'solo' || timed !== true) return null;
  return { on: room.soloUnlimited === true, editable: room.hostId != null && room.hostId === myId };
}

/**
 * An AI teammate's name split into its 「AI·」 prefix and the rest, for the plate (room.css hides the prefix on a phone:
 * the avatar's badge and the card's AI 队友 tag say it, and at 特大 the prefix left one character of the name,
 * 「AI·华…」). Null for a human seat and for a name that is only a number after the prefix (`AI·2`).
 * @param {{ isBot?: boolean, name?: string } | null | undefined} seat
 * @returns {[string, string] | null}
 */
export function botNameParts(seat) {
  const m = seat?.isBot ? /^(AI\s*·\s*)(\D.*)$/su.exec(seat.name || '') : null;
  return m ? [m[1], m[2]] : null;
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

// 名片干员 portraits (the pick, else one chosen by the player id): ui/seatArt.js, shared with the strategy draft's rows
export { CARD_PREF, cardOperators, seatPortrait, CARD_SYNC };

/** An AI seat's strategy (自动选择 when none is set); the host's is a button opening the picker. */
function BotBandChip({ seat, gd, editable, busy, onOpen }) {
  const band = typeof seat.band === 'string' ? gd.band(seat.band) : null;
  const body = html`${band ? html`<${BandIcon} bandId=${band.bandId} size="sm" />` : html`<${Icon} name="robot" />`}
    <span class="seat__band-name">${band ? band.name : typeof seat.band === 'string' ? seat.band : t('自动选择')}</span>`;
  return editable
    ? html`<button type="button" class="seat__band rseat__band is-editable" disabled=${busy} onClick=${onOpen} title=${t('指定该 AI 队友选择的策略')}>
        <span class="seat__band-k">${t('策略')}</span>${body}<${Icon} name="edit" /></button>`
    : html`<span class="seat__band rseat__band"><span class="seat__band-k">${t('策略')}</span>${body}</span>`;
}

/**
 * The host's strategy picker for one AI seat: 自动选择, then every co-op strategy; one already set for another AI of the
 * room is disabled and names it (the server refuses a duplicate too).
 */
function BotBandPicker({ seat, room, gd, busy, onClose, onPick }) {
  const seats = roomFacts(room, null).seats;
  // an expanded room's 禁用鸭爵 option drops that strategy, as in its draft (server: the same GameData rule)
  const bands = allowedBands(gd.list('bands'), 'MULTI', seats.length > MAX_SEATS && room.experimental?.disableDuckLord === true);
  const usedBy = new Map();
  for (const s of seats) if (s && s.isBot && s.seat !== seat.seat && typeof s.band === 'string') usedBy.set(s.band, s.name);
  return html`<${Modal} open=${true} onClose=${onClose} title=${t('指定 AI 策略：{name}', { name: seat.name })} micro="AI STRATEGY"
      class="botband-dlg" actions=${html`<${Button} variant="secondary" data-autofocus onClick=${onClose}>${t('关闭')}<//>`}>
    <p class="botband-dlg__tip t-dim">${t('开局选择策略时，该 AI 队友会直接选择指定的策略，其他博士不能再选它。')}</p>
    <div class="botband-dlg__grid" role="listbox" aria-label=${t('策略')}>
      <button type="button" role="option" aria-selected=${seat.band == null ? 'true' : 'false'} disabled=${busy}
          class=${`botband ${seat.band == null ? 'is-sel' : ''}`} onClick=${() => onPick(null)}>
        <span class="botband__auto"><${Icon} name="robot" /></span><span class="botband__name">${t('自动选择')}</span>
      </button>
      ${bands.map((b) => {
        const other = usedBy.get(b.bandId);
        return html`<button key=${b.bandId} type="button" role="option" aria-selected=${seat.band === b.bandId ? 'true' : 'false'}
            disabled=${busy || !!other} title=${other ? t('已指定给 {name}', { name: other }) : b.effectName || b.name}
            class=${`botband ${seat.band === b.bandId ? 'is-sel' : ''} ${other ? 'is-used' : ''}`} onClick=${() => onPick(b.bandId)}>
          <${BandIcon} bandId=${b.bandId} size="md" /><span class="botband__name">${b.name}</span>
          ${other ? html`<span class="botband__used">${other}</span>` : b.effectName ? html`<span class="botband__eff">${b.effectName}</span>` : null}
        </button>`;
      })}
    </div>
  <//>`;
}

/**
 * One seat: a tall card — the top strip (P#), the 名片干员 portrait (or the avatar frame: a bot, no art pack), 创建者, the
 * state at the bottom (准备中 / 待命中 / 已就绪 with its box) — and the name plate under it. The art's text sits in two
 * groups in flow, `.rseat__top` (the badge, the tags) and `.rseat__low` (the operator's name, the state), so a
 * larger 文字大小 wraps and pushes them apart rather than drawing one over another (§35.18 review). The card is read-only
 * (the lobby's 个人名片 edits it); the host gets 移出 / 移除 AI 队友 at the top right. An empty seat: 邀请 (copies the key) and, for the
 * host of a co-op room, 添加 AI 队友. `portrait` is the outfit's picture, `portraitDefault` the operator's default one
 * (given when an outfit is worn): a picture that fails to load gives way to the next, the last to the avatar frame.
 */
function SeatCard({ seat, index, room, facts, myId, myCard, busy, gd, queued, onKick, onInvite, onAddBot, onRemoveBot, onBotBand, portraits,
  portrait = null, portraitDefault = null, operator = null, fresh = false, drag = false, onDrop = null }) {
  const [badArt, setBadArt] = useState([]);
  const [over, setOver] = useState(false);
  const coop = room.mode !== 'solo';
  // 2V2: the host drags an occupied seat onto another seat to swap them (room.swapSeats); any seat is a drop target.
  // Without `drag` no handler is attached at all, so other rooms' cards render exactly as before.
  const dragProps = !drag ? {} : {
    draggable: !!seat,
    onDragStart: (e) => { try { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ } },
    onDragOver: (e) => { e.preventDefault(); if (!over) setOver(true); },
    onDragLeave: () => { if (over) setOver(false); },
    onDrop: (e) => {
      e.preventDefault(); setOver(false);
      let from = NaN;
      try { const raw = e.dataTransfer.getData('text/plain'); if (raw) from = Number(raw); } catch { /* ignore */ }
      if (Number.isInteger(from) && from !== index && onDrop) onDrop(from, index);
    },
  };
  // the 转场 flash: a seat that turns ready (or becomes the host's), and an AI teammate added while the room is open
  // (`fresh`: this card mounted after the room was already on screen)
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId), 700, fresh);
  if (!seat) {
    const canAdd = coop && facts.isHost && !queued;
    const invitable = coop && !facts.spectating;
    return html`<article class=${`seat seat--empty rseat rseat--empty${queued ? ' is-searching' : ''}${over ? ' is-dragover' : ''}`} style=${`--i:${index}`} ...${dragProps}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><span class="num">P${index + 1}</span></header>
      <div class="rseat__art">
        ${queued
          ? html`<span class="rseat__wait"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2l5 5-5 5-5-5z" /><rect x="10" y="16" width="14" height="22" rx="3" /><path d="M24 22h10l-4 7 4 7H24" /></svg><small>STRONGHOLD PROTOCOL</small></span>`
          : invitable
            ? html`<button type="button" class="rseat__invite" onClick=${onInvite} title=${t('复制同盟密钥以邀请队友')}>
                <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('复制同盟密钥以邀请队友')}</small></button>`
            : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        ${canAdd ? html`<${Button} variant="secondary" size="sm" icon="robot" class="rseat__add" loading=${busy === 'add'} onClick=${onAddBot}>${t('添加 AI 队友')}<//>` : null}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty"><span class="seat__state t-dim">${t('空位')}</span></div>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  const lit = state === 'ready' || state === 'host';
  const art = seatArtSrc([portrait, portraitDefault], badArt);
  const card = isMe ? myCard : seat.card && typeof seat.card === 'object' ? seat.card : null;
  const owner = isOwnerSeat(seat);
  // an AI teammate's name without its 「AI·」 prefix on a phone (room.css; botNameParts)
  const botPrefix = botNameParts(seat);
  return html`<article class=${`seat rseat${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''}${art ? ' has-art' : ''}${lit ? ' is-lit' : ''}${flash ? ' is-flash' : ''}${offline ? ' is-offline' : ''}${owner ? ' is-owner' : ''}${seat.team != null ? ` seat--team-${seat.team}` : ''}${over ? ' is-dragover' : ''} is-${state}`}
      style=${`--i:${index}`} ...${dragProps}>
    <span class="rseat__clip" aria-hidden="true"></span>
    <header class="rseat__strip"><span class="num">P${index + 1}</span>${seat.team != null ? html`<span class="rseat__team num">${t('队伍 {n}', { n: seat.team + 1 })}</span>` : null}</header>
    <div class="seat__art rseat__art">
      ${art
        ? html`<img key=${art} class="seat__portrait" src=${art} alt="" draggable=${false} onError=${() => setBadArt((b) => (b.includes(art) ? b : [...b, art]))} />`
        : html`<${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />`}
      <div class="rseat__top">
        ${isHostSeat ? html`<span class="rseat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
        ${seat.isBot ? html`<span class="rseat__bot"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
        ${consent ? html`<span class="rseat__tag" data-testid="script-consented">${t('已同意')}</span>` : null}
        ${facts.needsContent && !seat.isBot ? html`<span class=${`rseat__tag seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
          ${facts.versionRoom
            ? seat.content === 'ready' ? t('版本数据就绪') : seat.content === 'failed' ? t('版本数据校验失败') : t('版本数据载入中')
            : seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
        </span>` : null}
      </div>
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('连接中断')}</span>` : null}
      <div class="rseat__low">
        ${art ? html`<span class="seat__op">${operator?.name || ''}</span>` : null}
        <span class=${`rseat__state seat__state--${state}`}>
          <span class="rseat__box">${lit ? html`<${Icon} name="check" />` : null}</span>
          <span class="rseat__said">${state === 'ready' ? t('已就绪') : state === 'host' ? t('待命中') : state === 'offline' ? t('连接中断') : t('准备中')}</span>
        </span>
      </div>
    </div>
    ${seat.isBot && coop ? html`<${BotBandChip} seat=${seat} gd=${gd} editable=${facts.isHost && !queued} busy=${busy === `band${index}`} onOpen=${() => onBotBand(index)} />` : null}
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick rseat__kick--bot" disabled=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)}
      title=${t('移除该 AI 队友')} aria-label=${t('移除 AI 队友')}><${Icon} name="robot" /><${Icon} name="close" /></button>` : null}
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    <div class=${`rseat__plate${card?.bg ? ' has-nc' : ''}`}>
      ${card?.bg ? html`<${NameCardLayer} card=${card.bg} shift=${card.bgShift} />` : null}
      ${isMe ? html`<span class="rseat__me" role="img" aria-label=${t('你')} title=${t('你')}><${Icon} name="info" /></span>` : null}
      <${AvatarFrame} size="sm" name=${seat.name} src=${seat.isBot ? null : (cardAvatarUrl(card?.avatar, portraits.m, card?.avatarLook) || cardAvatarUrl(defaultCardPick(seat.playerId)?.charId, portraits.m))} seat=${index} bot=${seat.isBot} self=${isMe} />
      <span class="rseat__who"><b class="seat__name">${botPrefix ? html`<span class="seat__name-pre">${botPrefix[0]}</span>${botPrefix[1]}` : seat.name || t('博士')}</b>${isMe ? html`<span class="seat__you" aria-hidden="true">${t('你')}</span>` : null}${owner ? html`<${OwnerBadge} seat=${seat} />` : null}${seat.isBot ? null : html`<${TrophyBadge} count=${Number.isSafeInteger(card?.trophies) ? card.trophies : null} class="tbadge--inline" />`}</span>
      <small class="rseat__doc">${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}</small>
    </div>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">${MAX_SPECTATORS > 0 ? `/${MAX_SPECTATORS}` : ` / ${t('无上限')}`}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}<span class=${isOwnerSeat(s) ? 'sp-owner-name' : ''}>${s.name || t('博士')}</span><${OwnerBadge} seat=${s} />${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

/** The 「默认速度」 rule (1× / 2×): the host picks before the match, everybody else sees the choice. */
function SpeedChoice({ option, busy, onChange }) {
  if (!option) return null;
  const hint = t('每局与每回合开始时按房规速度进行；60× 跳过只在本回合有效，下一回合需重新投票');
  return html`<div class="ailast rs-opts__row" role="group" aria-label=${t('全局默认速度')}>
    <span class="rs-opts__k">${t('默认速度')}</span>
    <div class="rs-opts__ctl">
      ${[PLAYBACK.NORMAL, PLAYBACK.FAST].map((v) => html`<${Tooltip} key=${v} text=${hint}>
        <button type="button" class=${`dpick__opt ailast__opt${option.speed === v ? ' is-active' : ''}`}
          aria-pressed=${option.speed === v ? 'true' : 'false'} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && option.speed !== v && onChange(v)}>${v}×</button>
      <//>`)}
      ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
    </div>
  </div>`;
}

/** The 「不限时」 switch (a timed solo): the host toggles it, everybody else sees its state. */
function SoloUnlimitedToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast rs-opts__row">
    <span class="rs-opts__k" aria-hidden="true"></span>
    <div class="rs-opts__ctl">
      <${Tooltip} text=${t('关闭本局休整与机变的计时。官方为休整期每轮 300 秒、机变 150 秒。')}>
        <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'} data-testid="room-solo-unlimited"
            class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
            onClick=${() => option.editable && onToggle(!option.on)}>
          <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('不限时')}
        </button>
      <//>
      ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
    </div>
  </div>`;
}

/** The 「AI 队友最后选择」 switch (co-op): the host toggles it, everybody else sees its state. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast rs-opts__row">
    <span class="rs-opts__k" aria-hidden="true"></span>
    <div class="rs-opts__ctl">
      <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
        <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
            class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
            onClick=${() => option.editable && onToggle(!option.on)}>
          <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
        </button>
      <//>
      ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
    </div>
  </div>`;
}

/** mm:ss of a duration in seconds. */
const clock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s)) % 60).padStart(2, '0')}`;

function AiTakeoverToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast rs-opts__row">
    <span class="rs-opts__k" aria-hidden="true"></span>
    <div class="rs-opts__ctl">
      <${Tooltip} text=${t('默认关闭。开启后，观战者可在休整期经同房间真人投票接替 AI；继承记录不计个人统计或奖励。')}>
        <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'} data-testid="room-ai-takeover"
            class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
            onClick=${() => option.editable && onToggle(!option.on)}>
          <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('允许观战者接替 AI')}
        </button>
      <//>
      ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
    </div>
  </div>`;
}

/**
 * ⚙ of the bottom pill (co-op): 同盟设置 — the 模拟难度 (opens 选择模拟协议: the host's 确认, the others' read-only view)
 * and the 「AI 队友最后选择」 switch, the 「全局默认速度」 rule. 实验性选项 is not here: it has one entry, the bottom bar's
 * left button (this fork), so the dialog does not duplicate it. Closes on a click outside it or
 * Esc, where a dialog above it keeps the priority.
 */
function RoomOptions({ option, takeoverOption, onAiTakeover, soloOption = null, room, facts, myId, isHost, busy, onAiLast, onSpeed, onSoloUnlimited, onDifficulty, onClose, leaving = false }) {
  const info = difficultyInfo(room.mode, room.difficulty);
  const title = soloOption ? t('模拟设置') : t('同盟设置');
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear, .modal')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal')) { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  return html`<div class=${`rs-opts${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${title}>
    <h4>${title}${facts.isHost ? null : html`<small>${t('由创建者设置')}</small>`}</h4>
    ${soloOption ? null : html`<div class="rs-opts__row" data-testid="room-opt-difficulty">
      <span class="rs-opts__k">${t('模拟难度')}</span>
      <div class="rs-opts__ctl">
        <button type="button" class="rs-opts__diff" disabled=${isHost && !!busy} onClick=${onDifficulty}
            title=${isHost ? t('更改模拟难度') : t('由创建者选择')}>
          <${DifficultyIcon} difficulty=${room.difficulty} />${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span>
          ${isHost ? html`<em>${t('更改')}</em>` : null}
        </button>
        ${isHost ? null : html`<span class="t-dim">${t('由创建者选择')}</span>`}
      </div>
    </div>`}
    <${AiTakeoverToggle} option=${takeoverOption} busy=${busy} onToggle=${onAiTakeover} />
    ${soloOption
      ? html`<${SoloUnlimitedToggle} option=${soloOption} busy=${busy} onToggle=${onSoloUnlimited} />`
      : html`<${AiLastToggle} option=${option} busy=${busy} onToggle=${onAiLast} />`}
    <${SpeedChoice} option=${speedOption(room, myId)} busy=${busy} onChange=${onSpeed} />
  </div>`;
}

/** A gear (the pill's ⚙, in the place of the event's 快速搜寻: matchmaking is dropped — the maintainer's PR #643 keep / drop list, 2026-10-15). */
function GearGlyph() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>`;
}

/**
 * The big button of the bottom right (开始模拟 / 准备就绪 / 已就绪 / 观战中), styled like 选择模拟协议's. A disabled reason goes in
 * the project's Tooltip around it (review of PR #813: a native title never shows on touch).
 */
function GoButton({ label, onClick, disabled, loading = false, ready = null, icon = null }) {
  return html`<button type="button" class=${`proto-start rs-go${ready ? ' is-ready' : ''}`} disabled=${disabled} onClick=${onClick}
      aria-busy=${loading ? 'true' : 'false'}>
    ${ready != null
      ? html`<span class="rs-go__box" aria-hidden="true">${ready ? html`<${Icon} name="check" />` : null}</span>`
      : icon
        // (a spectator's 观战中: its eye in the mark's place, so the label keeps the width — §35.18 review)
        ? html`<span class="rs-go__icon" aria-hidden="true"><${Icon} name=${icon} /></span>`
        : html`<span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>`}
    <span class="proto-start__label">${loading ? html`<${Spinner} size="sm" />` : null}${label}</span>
    <span class="proto-start__deco" aria-hidden="true"></span>
  </button>`;
}

/** How long a version proposal refused as too frequent (RATE) waits before it is sent once more [ASSUMED]. */
const PROPOSE_RETRY_MS = 1200;

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  // the 「原版 / 插件 ×N」 tag (ui/pluginTag.js): only on a server with plugins installed, or a room that has some on
  const installedPlugins = useStore((s) => s.installedPlugins);
  const showPlugins = installedPlugins > 0 || (Array.isArray(room?.content?.plugins) && room.content.plugins.length > 0);
  const conn = useStore((s) => s.connection, shallowEqual);
  const queue = useStore((s) => s.queue);
  const queued = queueActive(queue);
  const [busy, setBusy] = useState(null);
  const [opts, setOpts] = useState(false);
  const [experimentalOpen, setExperimentalOpen] = useState(false);
  const [bandSeat, setBandSeat] = useState(null);
  const gd = useGameData();
  const [since] = useState(() => Date.now());
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => { clearInterval(id); alive.current = false; }; }, []);
  // 名片干员: the operators a seat card can show and the default pool (ui/seatArt.js), one's own pick (a pref the sync
  // engine sends: ui/loadoutSync.js installCardSync), and the outfits the cards wear — this browser's choices and the
  // 「显示其他玩家的皮肤」 switch (docs/SKINS.md)
  useData('chess', 'assets', 'config');
  const chess = data.get('chess');
  const m = data.get('assets');
  const cardList = useMemo(() => cardOperators(data.list('chess')), [chess]);
  const cards = useMemo(() => cardContext(cardList), [cardList]);
  const myCard = useMyCard();
  const localSkins = useStore((s) => s[SKINS_KEY], Object.is, skinsStore);
  const otherSkins = useStore((s) => s.otherSkins !== false, Object.is, settingsStore);
  const portraits = useMemo(() => ({
    pool: cardList.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
    byChar: new Map(cardList.map((c) => [c.charId, c])), m, myId: me.playerId, myCard: myCard.charId, myLook: myCard.look,
  }), [cardList, m, me.playerId, myCard.charId, myCard.look]);
  // tell the server (teammates see the card) once it knows room.card; a server that refuses it keeps the card local
  const cardRefused = useRef(false);
  const mineCard = room ? roomFacts(room, me.playerId).mine?.card : null;
  const known = (id) => (id && portraits.byChar.has(id) ? id : '');
  const cardMsg = cardMessage({ ...myCard, charId: known(myCard.charId), avatar: known(myCard.avatar) });
  const cardKey = `${cardMsg.charId}|${cardMsg.avatar}|${cardMsg.bg}|${cardMsg.trophies}|${cardMsg.look}|${cardMsg.avatarLook}`;
  useEffect(() => {
    if (!CARD_SYNC || cardRefused.current || !room || room.inMatch || conn.status !== 'online' || myCard.trophies == null) return;
    if (!roomFacts(room, me.playerId).mine || seatCardMatches(mineCard, cardMsg)) return;
    net.request('room.card', cardMsg).catch(() => { cardRefused.current = true; });
  }, [room?.code, cardKey, JSON.stringify(mineCard ?? null), conn.status, myCard.trophies == null]);

  // the room whose seats are on screen: a seat card that mounts after its first render is new (an AI teammate added)
  const shownRoom = useRef('');
  useEffect(() => { shownRoom.current = room?.code || ''; });
  // 选择模拟协议 over the room — open, and the host's pick before 确认 (the others read it: the room's difficulty) — and
  // the ⚙ menu
  const [protoOpen, setProtoOpen] = useState(false);
  const [protoPick, setProtoPick] = useState(null);
  // the host's change of difficulty, told to the others (see the header); never on entering a room or switching rooms
  const seenDiff = useRef(room ? `${room.code}|${room.difficulty}` : '');
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}|${room.difficulty}`;
    const before = seenDiff.current;
    seenDiff.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`) || room.hostId === me.playerId) return;
    const name = DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : room.difficulty;
    toast(t('创建者已将模拟难度改为「{name}」', { name }), 'info');
  }, [room?.code, room?.difficulty]);
  // official versions (DESIGN §35.23): the room's switch is told to everybody (the host's own page included — a vote's
  // result arrives later than the pick); never on entering a room or switching rooms
  const versions = useStore((s) => s.versions);
  const myLobby = useStore(lobbyVersion);
  const serverDefault = useStore(serverDefaultVersion);
  const [versionOpen, setVersionOpen] = useState(false);
  const seenVersion = useRef(room ? `${room.code}|${roomVersion(room)}` : '');
  useEffect(() => {
    if (!room) return;
    const key = `${room.code}|${roomVersion(room)}`;
    const before = seenVersion.current;
    seenVersion.current = key;
    if (!before || before === key || !before.startsWith(`${room.code}|`)) return;
    setVersionOpen(false);
    toast(t('同盟已切换到「{version}」', { version: versionLabel(roomVersion(room)) }), 'success');
  }, [room?.code, room?.version]);
  // 单人房's account default speed (the lobby's ⚙, `lobby.soloSpeed`): applied once when the room comes up; the room stays
  // the authority afterwards, and a change made here is kept as the account default by setSpeed
  const speedSeeded = useRef('');
  useEffect(() => {
    if (!room || room.mode !== 'solo' || room.inMatch || conn.status !== 'online' || room.hostId !== me.playerId) return;
    const key = `${room.code}|${me.playerId}`;
    if (speedSeeded.current === key) return;
    speedSeeded.current = key;
    const want = loadPref('lobby.soloSpeed', PLAYBACK.FAST) === PLAYBACK.NORMAL ? PLAYBACK.NORMAL : PLAYBACK.FAST;
    const now = room.speed === PLAYBACK.NORMAL ? PLAYBACK.NORMAL : PLAYBACK.FAST;
    if (now !== want) net.request('room.setSpeed', { speed: want }).catch(() => {});
  }, [room?.code, room?.mode, room?.speed, room?.hostId, room?.inMatch, conn.status, me.playerId]);
  // the room sees one's pick once the server has it (seats[].card): ui/loadoutSync.js installCardSync sends it after
  // every pick, welcome and content change and retries a RATE / TIMEOUT / OFFLINE refusal (review of PR #813);
  // the card itself is edited in the lobby's 个人名片 (ui/profileCard.js)
  const [optsShown, optsLeaving] = usePresence(opts, 160);
  const [exiting, setExiting] = useState(false);
  // a draggable 2V2 seat keeps its own native drag (the row's sideways scroll must not take the press)
  const dragScroll = useDragScroll({ skip: 'select, input, textarea, [draggable=true]' });

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const versus = room.mode === 'versus';
  const facts = roomFacts(room, me.playerId);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);
  const big = facts.seats.length > MAX_SEATS;

  /** Runs one request at a time; resolves true once the server took it (false: not sent, or refused — toasted). */
  const run = async (kind, fn) => {
    if (inFlight.current) return false;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return false; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); return true; } catch (err) { toastError(err); return false; } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  // 准备 plays the official PLAYER_READY, cancelling it the plain button-up (feedback #10)
  const toggleReady = () => run('ready', async () => {
    const ready = !myReady;
    await net.request('room.ready', { ready });
    audio.sfx(ready ? 'ready' : 'back', { volume: 0.8 });
  });
  // 整队匹配中不能由创建者单独开局（本仓库的规则）：先取消匹配再开始
  const start = () => {
    if (queued) { toast(t('请先取消组队匹配，再开始模拟'), 'warn'); return false; }
    return run('start', () => net.request('room.start', {}));
  };
  const queueReason = partyQueueReason(room, me.playerId, online);
  const joinQueue = () => run('queue', () => net.request('queue.join', { difficulty: room.difficulty, party: true }));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setAiTakeover = (on) => run('aihandover', () => net.request('room.setAiTakeover', { on }));
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // the room is the authority; the lobby card reads the same pref the next time this browser creates a solo room
  const setSoloUnlimited = async (on) => {
    const sent = await run('solofree', () => net.request('room.setSoloUnlimited', { on }));
    if (sent) savePref('lobby.soloUnlimited', on === true);
  };
  // the room is the authority; a solo room's change is also kept as this account's default for the next one (lobby ⚙)
  const setSpeed = async (speed) => {
    const next = speed === PLAYBACK.NORMAL ? PLAYBACK.NORMAL : PLAYBACK.FAST;
    const sent = await run('speed', () => net.request('room.setSpeed', { speed: next }));
    if (sent && room.mode === 'solo') savePref('lobby.soloSpeed', next);
  };
  const setBotBand = (seat, bandId) => run(`band${seat}`, async () => { await net.request('room.setBotBand', { seat, bandId }); setBandSeat(null); });
  // 2V2: the host swaps two seats (a dragged occupied card; the team follows the seat index — server: room.swapSeats)
  const swapSeats = (a, b) => {
    if (!facts.seats[a]) return false;
    return run('swap', () => net.request('room.swapSeats', { a, b }));
  };
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code, ...(room.test ? { testAck: true } : {}) }));
  const leave = async () => {
    if (inFlight.current) return;
    if (queued) { toast(t('请先取消组队匹配，再离开同盟'), 'warn'); return; }
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    setExiting(true);
    await afterLeave(200);
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) { setBusy(null); setExiting(false); }
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : queued
      ? html`<span class="t-mint">${t('{n} 人好友小队 · 正在整队匹配', { n: facts.humans.length })}</span>`
    : facts.versionRoom && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入「{version}」的数据', { version: versionLabel(roomVersion(room)) })}</span>`
    : facts.needsContent && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${versus ? t('*狩猎人数达标，准许进入模拟') : t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;
  const modeName = versus ? t('狩猎模拟 2V2') : coop ? t('同盟模拟') : t('独立模拟');

  const copy = async (what) => {
    // the copied link carries an invitation line (#103): 「{name}邀请你加入卫戍协议：盟约【{difficulty}】」 — with the
    // version's name for another official version (DESIGN §35.23)
    const params = { name: me.name ?? '', difficulty: DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : '' };
    const invite = roomVersion(room) !== DEFAULT_VERSION
      ? t('{name}邀请你加入卫戍协议：盟约·{version}【{difficulty}】', { ...params, version: versionLabel(roomVersion(room)) })
      : t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', params);
    const ok = await copyText(what === 'code' ? room.code : `${inviteLink(room.code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code: room.code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  // 选择模拟协议 over the room: the host picks and sends the difficulty on 确认 (nothing to send when it did not change —
  // unless a plugin mode is on, which picking a difficulty leaves: server/lobby.js setDifficulty); it closes only once the
  // server took it, and the accepted pick becomes the remembered difficulty (`lobby.difficulty`, the one 创建同盟 and
  // 独立模拟's 选择模拟协议 start from — README / PLAYING 难度沿用上次选的). Everybody else opens it read-only.
  const openProto = () => { setOpts(false); setProtoPick(room.difficulty); setProtoOpen(true); };
  const closeProto = () => { setProtoOpen(false); setProtoPick(null); };
  const pluginMode = room.content?.modeId ? (room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId : null;
  const confirmDifficulty = async () => {
    const d = protoPick || room.difficulty;
    if (d === room.difficulty && !pluginMode) { closeProto(); return; }
    if (!(await setDifficulty(d))) return;
    savePref('lobby.difficulty', d);
    // the plugin mode is gone: said, as a same-difficulty 确认 changes nothing else the host sees (§35.51; §35.18's nit)
    if (pluginMode) toast(t('已退出插件模式「{name}」', { name: pluginMode }), 'info');
    if (alive.current) closeProto();
  };
  // the difficulties the room's version offers (its config's modes, versions.js) — the page shows that version's data
  // once it is loaded; until then (or for a gameplay plugin room's own modes) all four
  const protoDifficulties = offeredDifficulties(pageVersion() === roomVersion(room) ? getConfig() : null, room.mode);
  const protoHint = pluginMode
    ? t('确认后将退出插件模式「{name}」', { name: pluginMode })
    : facts.humans.length > 1 ? t('更改难度后，其他博士需要重新准备就绪') : '';
  const aiLast = aiLastOption(room, me.playerId);
  const soloTimed = soloTimedOf(pageVersion() === roomVersion(room) ? getConfig() : null, roomVersion(room));
  const soloOpt = soloUnlimitedOption(room, me.playerId, soloTimed);
  const soloBrief = soloTimeMsgid({ timed: soloTimed, unlimited: room.soloUnlimited === true });
  // the room's version (DESIGN §35.23): the pill and ⚙'s row on a server that enables versions (or in a version room)
  const vote = versionVoteOf(room);
  const curVersion = roomVersion(room);
  const showVersion = Array.isArray(versions) || curVersion !== DEFAULT_VERSION;
  const versionWhy = !online ? t('连接中断，请稍候重试')
    : vote ? t('切换版本投票进行中，请等投票结束')
    : facts.modded ? t('请先关闭改变玩法的插件')
    : !Array.isArray(versions) || versions.length < 2 ? t('本服务器只启用了这一个版本') : null;
  const versionEditable = facts.isHost && !facts.spectating && !room.inMatch;
  // the room's version is not this browser's lobby choice: the banner says leaving restores it (on a short screen, where
  // the banner gives its room to the seats, the pill's tooltip says it)
  const bannerText = curVersion !== myLobby && Array.isArray(versions) ? t('本房间为「{room}」，离开后恢复你的大厅版本「{mine}」', { room: versionLabel(curVersion), mine: versionLabel(myLobby) }) : null;
  const versionCtl = showVersion ? {
    id: curVersion, editable: versionEditable, why: [versionEditable ? versionWhy : t('由创建者发起'), bannerText].filter(Boolean).join(' · ') || null,
    disabled: versionEditable ? !!versionWhy || !!busy : !Array.isArray(versions),
    onOpen: () => { setOpts(false); setVersionOpen(true); },
  } : null;
  // (a switch makes every page send its settings again, which share the server's budget of heavy messages with
  // room.proposeVersion: a RATE right after one is tried once more a moment later; the server's own 5 s pause after a
  // declined or expired vote answers RATE again and is told)
  const proposeVersion = async (version) => {
    const send = () => net.request('room.proposeVersion', { version });
    const sent = await run('version', async () => {
      try { await send(); } catch (err) {
        if (err?.code !== 'RATE') throw err;
        await new Promise((r) => setTimeout(r, PROPOSE_RETRY_MS));
        await send();
      }
    });
    if (sent && alive.current) setVersionOpen(false);
  };
  // one seat card; the 2V2 layout reuses it inside its two team groups (a versus host may drag a seat onto another)
  const seatCard = (s, i) => {
    const op = seatOperator(s, cards, { myId: me.playerId, myCard: myCard.charId });
    // the player's outfit for that operator (header "Outfits"); null = the default art
    const skin = op ? seatCardSkin(s, op.chess.charId, { myId: me.playerId, localSkins, players: facts.occupied, otherSkins }) : null;
    return html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
      myId=${me.playerId} myCard=${myCard} busy=${busy} gd=${gd} queued=${queued} onKick=${kick} onInvite=${() => copy('code')}
      onAddBot=${addBot} onRemoveBot=${removeBot} onBotBand=${setBandSeat} portraits=${portraits}
      portrait=${op ? chessPortraitUrl(data.get('assets'), op.chess, { skin }) : null}
      portraitDefault=${op && skin ? chessPortraitUrl(data.get('assets'), op.chess) : null} operator=${op?.chess}
      drag=${versus && facts.isHost && !room.inMatch} onDrop=${swapSeats}
      fresh=${shownRoom.current === room.code} />`;
  };

  return html`<div class=${`screen room-screen rs${coop ? '' : ' rs--solo'}${big ? ' rs--big' : ''}${exiting ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[room.difficulty] || 'var(--amber)'}; --n:${facts.seats.length}`}>
    <div class="rs__bg" aria-hidden="true"></div>
    <header class="topbar rs-top">
      <div class="topbar__left rs-top__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <button type="button" class="rs-exit" disabled=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')}><${Icon} name="exit" /></button>
        <//>
        <div class="rs-clock">
          ${versus ? html`<${MicroLabel} tone="mint">VERSUS LOBBY<//>` : null}
          <b>${modeName}${room.test ? html` <${TestMark} />` : null}<${VersionTag} room=${room} class="rs-clock__ver" />
            ${pluginMode ? html`<span class="rs-clock__sep"></span><span class="room-mode" data-testid="room-mode">${pluginMode}</span>` : null}
            <span class="rs-clock__sep"></span>${t('同盟已等待')} <span class="num">${clock((Date.now() - since) / 1000)}</span></b>
          ${big ? html`<span class="room-capacity">${t('实验性同盟 · {n} 人模式 · 支持同模式匹配', { n: facts.seats.length })}</span>`
            : html`<span class="rs-clock__ping">${t('当前延迟')}<${PingPill} ms=${conn.ping} online=${online} /></span>`}
        </div>
        <div class="rs-tools">
          <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')} />
          <${SettingsButton} class="room-settings" variant="secondary" square=${true} />
          <${GuideButton} class="room-guide" variant="secondary" square=${true} />
        </div>
        ${showPlugins ? html`<${PluginTag} room=${room} myId=${me.playerId} />` : null}
      </div>
      <div class="rs-top__right">
        <${LoadoutButton} from="room" size="md" class="hub-plate hub-plate--loadout rs-loadout room-loadout" label=${t('干员调配')} />
        ${coop ? html`<div class="rs-key">
          <span class="rs-key__k">${versus ? t('房间密钥') : t('同盟密钥')}</span>
          <b class="rs-key__code num selectable" aria-label=${t('同盟密钥 {code}', { code: room.code })}>${room.code}</b>
          <button type="button" class="rs-key__copy" onClick=${() => copy('code')} title=${t('复制密钥')}>${t('复制')}</button>
          <button type="button" class="rs-key__link" onClick=${() => copy('link')} title=${t('复制链接')} aria-label=${t('复制链接')}><${Icon} name="link" /></button>
        </div>` : html`<div class="rs-key rs-key--solo"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class=${`seats rs-seats${coop ? '' : ' seats--solo'}${versus ? ' seats--versus' : ''}`} ...${dragScroll}>
      ${versus
        ? [0, 1].map((tm) => html`<section key=${tm} class=${`rs-tgroup rs-tgroup--${tm}`} aria-label=${t('队伍 {n}', { n: tm + 1 })}>
            <header class="rs-tgroup__head"><span class="rs-tgroup__dot" aria-hidden="true"></span>${t('队伍 {n}', { n: tm + 1 })}</header>
            <div class="rs-tgroup__seats">
              ${facts.seats.slice(tm * 2, tm * 2 + 2).map((s, k) => seatCard(s, tm * 2 + k))}
            </div>
          </section>`)
        : facts.seats.map((s, i) => seatCard(s, i))}
      ${coop ? null : html`<aside class="solo-brief rs-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''} <span class="num t-dim">${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          ${soloBrief ? html`<li>${t(soloBrief)}</li>` : null}
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />
    <${VersionVote} room=${room} />
    ${bannerText ? html`<p class="rs-verbanner" data-testid="version-banner"><${Icon} name="info" />${bannerText}</p>` : null}

    <footer class="room-bar rs-foot">
      <div class="rs-foot__left">
        <button type="button" class=${`rs-exp${experimentalChanged(room.experimental) ? ' is-on' : ''}`} disabled=${!!busy || queued} onClick=${() => setExperimentalOpen(true)}
          aria-haspopup="dialog" title=${experimentalSummary(room.experimental)}>
          <${Icon} name="edit" /><span><b>${t('实验性选项')}</b><small>${experimentalSummary(room.experimental)}</small></span></button>
      </div>
      <div class="rs-foot__center">
        <p class="rs-hint">${coop ? html`<span class="rs-ready num" title=${t('已就绪')}>${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}<b>${facts.readyHumans}</b>/${facts.humans.length}</span>` : null}<span class="room-bar__status">${statusLine}</span></p>
        <div class="rs-pill">
          <button type="button" class=${`rs-pill__diff${facts.isHost ? '' : ' is-ro'}`} disabled=${facts.isHost && (!!busy || queued)} onClick=${openProto}
            title=${facts.isHost ? t('更改模拟难度') : t('由创建者选择')}><${DifficultyIcon} difficulty=${room.difficulty} />${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span></button>
          ${versionCtl ? html`<${Tooltip} text=${versionCtl.why} class="rs-pill__version"><button type="button" class=${`rs-pill__ver${versionCtl.editable ? '' : ' is-ro'}`} data-testid="room-version"
            disabled=${versionCtl.disabled} onClick=${versionCtl.onOpen} aria-label=${t('游戏版本：{name}', { name: versionLabel(curVersion) })}><${Icon} name="book" /><span class="rs-pill__vername">${versionLabel(curVersion)}</span></button><//>` : null}
          ${aiLast || soloOpt ? html`<button type="button" class=${`rs-pill__gear${opts ? ' is-on' : ''}`} onClick=${() => setOpts((v) => !v)} title=${aiLast ? t('同盟设置') : t('模拟设置')} aria-label=${aiLast ? t('同盟设置') : t('模拟设置')}
            aria-expanded=${opts ? 'true' : 'false'}><${GearGlyph} /></button>` : null}
          ${optsShown && (aiLast || soloOpt) ? html`<${RoomOptions} takeoverOption=${aiTakeoverOption(room, me.playerId)} onAiTakeover=${setAiTakeover} option=${aiLast} soloOption=${soloOpt} room=${room} facts=${facts} myId=${me.playerId} isHost=${facts.isHost} busy=${busy}
            onAiLast=${setAiLast} onSpeed=${setSpeed} onSoloUnlimited=${setSoloUnlimited} onDifficulty=${openProto} onClose=${() => setOpts(false)} leaving=${optsLeaving} />` : null}
        </div>
      </div>
      <div class="room-bar__right rs-foot__right">
        ${coop && facts.isHost && !queued ? html`<${Tooltip} text=${queueReason ? t(queueReason) : t('整队寻找相同人数模式和难度的真人，确认后自动开局')}>
            <button type="button" class="proto-start rs-queue-go" data-testid="party-queue" disabled=${!!queueReason || !!busy} onClick=${joinQueue}>
              <span class="proto-start__label">${busy === 'queue' ? html`<${Spinner} size="sm" />` : null}${t('组队匹配')}</span>
            </button>
          <//>` : null}
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : vote ? t('切换版本投票进行中，请等投票结束') : !facts.contentReady ? (facts.versionRoom ? t('仍有博士未载入「{version}」的数据', { version: versionLabel(curVersion) }) : t('仍有博士未载入房间的插件内容')) : t('仍有博士未准备就绪')}>
              <${GoButton} label=${t('开始模拟')} loading=${busy === 'start'} disabled=${!facts.canStart || !online || busy === 'start' || !!vote} onClick=${start} />
            <//>`
          : facts.spectating
            ? html`<${GoButton} label=${t('观战中')} icon="eye" disabled=${true} />`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? (facts.versionRoom ? t('「{version}」的数据载入并通过校验后才能准备', { version: versionLabel(curVersion) }) : t('房间的插件内容载入并通过校验后才能准备')) : null}>
              <${GoButton} label=${myReady ? t('已就绪') : t('准备就绪')} ready=${myReady} loading=${busy === 'ready'}
                disabled=${!online || !facts.mine || busy === 'ready' || queued || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady} />
            <//>`}
      </div>
    </footer>

    ${queued ? html`<div class="rs-queue">
      <div class="rs-queue__team"><${MicroLabel} tone="mint">PARTY MATCHMAKING<//>
        <h2>${t('{n} 人好友小队', { n: facts.humans.length })}</h2>
        <p>${t('小队整体匹配相同人数模式和难度，不拆散队友。任一成员取消即可返回此房间；集齐 {n} 人后各自确认一次，直接开局。', { n: facts.seats.length })}</p>
      </div>
      <${QueueFlow} class="rs-searchpanel" queue=${queue} difficulty=${room.difficulty} experimental=${room.experimental} online=${online} party=${true} />
    </div>` : null}
    <${ExperimentalOptions} open=${experimentalOpen && !queued} value=${room.experimental} mode=${room.mode} source=${room.source} editable=${facts.isHost && online} busy=${!!busy}
      onChange=${experimental => run('experimental', () => net.request('room.setExperimental', { experimental }))} onClose=${() => setExperimentalOpen(false)} />
    ${bandSeat != null && facts.isHost && facts.seats[bandSeat]?.isBot ? html`<${BotBandPicker} seat=${facts.seats[bandSeat]} room=${room} gd=${gd}
      busy=${busy === `band${bandSeat}`} onClose=${() => setBandSeat(null)} onPick=${(bandId) => setBotBand(bandSeat, bandId)} />` : null}
    ${protoOpen ? facts.isHost
      ? html`<${ProtocolSelect} roomMode=${room.mode} difficulty=${protoPick || room.difficulty} onDifficulty=${setProtoPick} onClose=${closeProto}
          onCreate=${confirmDifficulty} busy=${busy === 'diff' ? 'create' : null} online=${online} action=${t('确认')} hint=${protoHint} difficulties=${protoDifficulties} />`
      : html`<${ProtocolSelect} roomMode=${room.mode} difficulty=${room.difficulty} onDifficulty=${() => {}} onClose=${closeProto}
          online=${online} readOnly=${true} difficulties=${protoDifficulties} />` : null}
    ${versionOpen && versionCtl ? html`<${VersionPicker} mode="room" versions=${versions || [{ id: curVersion, roomModes: [room.mode] }]} current=${curVersion}
      serverDefault=${serverDefault} roomMode=${room.mode} editable=${versionEditable && !versionWhy} busy=${busy === 'version'}
      note=${versionEditable ? versionWhy || (facts.humans.length > 1 ? t('其他博士同意后才会切换；切换后需要重新准备。') : null) : t('由创建者发起')}
      onPick=${proposeVersion} onClose=${() => setVersionOpen(false)} />` : null}
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
