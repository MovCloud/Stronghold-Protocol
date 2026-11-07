// 娱乐模式 (arcade modes): a page of its own behind the lobby's 娱乐模式 entry.
//
// The main line is the official 卫戍协议：盟约 rule set; everything that does not follow it (2V2 狩猎模拟 and the modes
// added later, e.g. 危机合约) lives here instead of in the 独立模拟 / 同盟模拟 flow. Each entry is a card of the same
// shape no matter what backs it (a built-in mode today, a plugin later): id, name, EN subtitle, icon, status and a
// one-line description.
//
// Lifecycle (owner 2026-11-07): a mode still in development / being reworked is a yellow 敬请期待 card and cannot be
// opened. A COMPLETED mode is switched by the admin panel per mode (server/playerAdmin.js /admin/api/arcade, persisted
// in state.json): open = green 开放中 and the card opens its room; closed = red 暂未开放 and the server refuses its new
// rooms and match starts while running matches drain (the maintenance idea, per mode). The state arrives in
// welcome.arcade and follows presence.state.arcade, so an open page updates without a reconnect.
//
// Wired through the store's small UI slice (`ui.arcade`), not a URL route: the router in main.js derives the screen
// from state (store.js selectRoute), and a room or match always wins over this page.

import { html, Icon, MicroLabel } from '../ui/components.js';
import { store, useStore } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';

export const openArcade = () => store.patch('ui', { arcade: true });
export const closeArcade = () => store.patch('ui', { arcade: false });

/**
 * 「狩猎模拟 2V2」 opens a versus room at the 同盟模拟 difficulty the lobby remembers: the ask is handed back to the
 * lobby screen (ui.versusLaunch), which owns room.create (version, difficulty, test room) — this page never talks to
 * the wire itself. With the mode closed (store.arcade.hunt2v2) the card stays locked and this is never called.
 */
export const requestVersus = () => store.patch('ui', { arcade: false, versusLaunch: true });

/**
 * 「同盟狩猎」 opens the opt-in co-op hunt room (room.create { mode: 'coop', hunt: true }): the system-run 狩猎期,
 * while the ordinary 同盟模拟 room keeps the official rules. Handed to the lobby (ui.huntLaunch) for the same reason;
 * a closed mode keeps the card locked.
 */
export const requestCoopHunt = () => store.patch('ui', { arcade: false, huntLaunch: true });

/** The lobby's entry card (screens/lobby.js renders it beside the official modes). */
export const ARCADE_CARD = {
  id: 'arcade', name: N_('娱乐模式'), en: 'ARCADE MODES', icon: 'dice',
  desc: N_('2V2 狩猎模拟与其他不跟随主线规则的玩法，集中在这里。'),
};

/** status: 'soon' (开发中，敬请期待) | 'ready' (admin 开放) | 'off' (admin 暂未开放) — only 'ready' can open a room. */
export const ARCADE_MODES = [
  {
    id: 'hunt2v2', name: N_('狩猎模拟 2V2'), en: 'HUNT SIMULATION 2V2', icon: 'sword', status: 'ready',
    desc: N_('两支双人小队在同一局里对抗：休整期结束后进入狩猎期，向对手派去猎物，击杀猎物为己方赢得赏金。人数不足时空位由 AI 补齐，一个人也能开局。'),
  },
  {
    id: 'alliancehunt', name: N_('同盟狩猎'), en: 'ALLIANCE HUNT', icon: 'users', status: 'ready',
    desc: N_('四人合作的狩猎变体：狩猎期由系统往你自己波次里投放悬赏猎物，击杀赏金记在坎诺特；主线同盟模拟保持官方规则。'),
  },
  {
    id: 'contract', name: N_('危机合约'), en: 'CONTINGENCY CONTRACT', icon: 'shield', status: 'soon',
    desc: N_('在更严苛的合约条件下坚守指定回合，按完成度结算。'),
  },
];

const STATUS_TEXT = {
  soon: N_('敬请期待'),
  ready: N_('开放中'),
  off: N_('暂未开放'),
};

/**
 * One arcade card. Locked modes stay visible (the page doubles as a roadmap) but disabled, with a reason in the
 * badge instead of a half-working button.
 */
function ArcadeCard({ mode }) {
  const ready = mode.status === 'ready';
  return html`<button type="button" class=${`arcade__card${ready ? '' : ' is-locked'}`} data-mode=${mode.id}
      disabled=${!ready} aria-disabled=${!ready || null} onClick=${ready ? () => mode.onOpen?.() : null}>
    <span class="arcade__card-icon" aria-hidden="true"><${Icon} name=${mode.icon} /></span>
    <span class="arcade__card-en">${mode.en}</span>
    <span class="arcade__card-name">${t(mode.name)}</span>
    <span class="arcade__card-desc">${t(mode.desc)}</span>
    <span class=${`arcade__card-badge arcade__card-badge--${mode.status}`}>${t(STATUS_TEXT[mode.status] || mode.status)}</span>
  </button>`;
}

export function ArcadeScreen() {
  // The completed modes follow the admin panel (store.arcade, welcome / presence); a development card keeps its
  // 敬请期待 status and has no switch.
  const arcade = useStore((s) => s.arcade);
  const modes = ARCADE_MODES.map((m) => {
    if (m.id === 'contract') return m;
    const open = arcade?.[m.id] === true;
    return {
      ...m, status: open ? 'ready' : 'off',
      ...(open ? { onOpen: m.id === 'hunt2v2' ? requestVersus : requestCoopHunt } : {}),
    };
  });
  return html`<div class="arcade">
    <header class="arcade__head">
      <button type="button" class="arcade__back" onClick=${closeArcade} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span>${t('返回大厅')}</span>
      </button>
      <div class="arcade__titles">
        <${MicroLabel} tone="mint">ARCADE MODES<//>
        <h1 class="arcade__title">${t('娱乐模式')}</h1>
      </div>
    </header>
    <p class="arcade__hint">${t('这里的玩法各自独立，不改变主线（独立模拟 / 同盟模拟）的规则与结算。')}</p>
    <div class="arcade__grid">
      ${modes.map((m) => html`<${ArcadeCard} key=${m.id} mode=${m} />`)}
    </div>
    <footer class="arcade__foot">${t('更多玩法会随插件包加入；每个玩法单独开关。')}</footer>
  </div>`;
}
