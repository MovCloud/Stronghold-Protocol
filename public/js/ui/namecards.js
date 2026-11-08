// 名片底图 (2026-10-14, the owner's decision: the room design by 雨千代chiyo had name-card art from its account service;
// here the backgrounds come from material this server already has, no new art): the four simulation loading pictures
// (assets.json ui['loading/loading_ac_*']) and the faction emblems (ui['campLogo/logo_*'], white on the faction's
// colour). A card id is `loading:<key>` or `camp:<key>`; an unknown id (an older or newer client's) shows nothing.
// `skin:<skin id>` (feedback #24, the owner's decision of 2026-10-17): an operator skin's full illustration (assets.json
// skins[id].illustration, ~4 MB — only the plates that use it load it; the picker shows the skins' half-body art).
// The pick is kept in the browser (NAMECARD_PREF) and travels with room.card (ui/playerCard.js) so teammates see it.
// A 立绘 card also carries its crop anchor (bgShift, shared/playerCard.js): NameCardCrop plans which band of the art the
// plate shows, horizontal fixed / vertical draggable, and the anchor travels with the card too.
// Styles: css/screens/lobby.css (.has-nc / .nc-layer / .nc-pick / .nc-crop).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { OPERATOR_SKINS } from '../../../shared/skins.js';
import { CAMPS, LOADING } from '../../../shared/avatarSources.js';
import { BG_SHIFT_DEFAULT, isCardShift } from '../../../shared/playerCard.js';

export const NAMECARD_PREF = 'room.namecard';

/** The crop anchor clamped to the range shared/playerCard.js validates (an unknown card keeps the default). */
const clampShift = (v) => (isCardShift(v) ? v : BG_SHIFT_DEFAULT);

/** Every card: { id, kind, name, assetKey, tint? }. */
export const NAMECARDS = Object.freeze([
  ...LOADING.map((c) => Object.freeze({ id: `loading:${c.key}`, kind: 'loading', name: c.name, assetKey: `loading/loading_ac_${c.key}` })),
  ...CAMPS.map((c) => Object.freeze({ id: `camp:${c.key}`, kind: 'camp', name: c.name, tint: c.tint, assetKey: `campLogo/logo_${c.key}` })),
]);
const BY_ID = new Map(NAMECARDS.map((c) => [c.id, c]));
/** The skins' cards: { id: 'skin:<skin id>', kind: 'skin', name, skin, charId }. */
const SKIN_CARDS = new Map(OPERATOR_SKINS.map((s) => [`skin:${s.id}`, Object.freeze({ id: `skin:${s.id}`, kind: 'skin', name: s.name, skin: s.id, charId: s.charId })]));

/** The card of an id, or null (unknown / empty). @param {unknown} id */
export function namecardOf(id) {
  return typeof id === 'string' ? BY_ID.get(id) || SKIN_CARDS.get(id) || null : null;
}

const safeUrl = (src) => (typeof src === 'string' && src && !/["\\)]/.test(src) ? src : null);

/** The picture of a card in the loaded asset index, or null (a skin: its full illustration, `half` its half-body art). */
export function namecardSrc(card, m = data.get('assets'), half = false) {
  if (card?.kind === 'skin') {
    const s = m?.skins && typeof m.skins === 'object' && Object.hasOwn(m.skins, card.skin) ? m.skins[card.skin] : null;
    return safeUrl(half ? s?.portrait : s?.illustration);
  }
  return safeUrl(card && m?.ui && typeof m.ui === 'object' ? m.ui[card.assetKey] : null);
}

/**
 * The card behind a name plate (the room's seat cards, the 成就统计 card, the top bar's chip): put it inside a
 * `.has-nc` element; nothing for no / an unknown card. `shift` is the 立绘 crop anchor in percent (NameCardCrop):
 * only the vertical position moves, the horizontal framing is fixed by the plate's shape.
 * @param {{ card: string|null|undefined, shift?: number }} props
 */
export function NameCardLayer({ card, shift }) {
  useData('assets');
  const nc = namecardOf(card);
  const src = namecardSrc(nc);
  if (!nc || !src) return null;
  const p = clampShift(shift);
  return html`<span class=${`nc-layer nc-layer--${nc.kind}`} style=${`--nc:url("${src}")${nc.tint ? `; --nc-tint:${nc.tint}` : ''}${p !== BG_SHIFT_DEFAULT ? `; --nc-y:${p}%` : ''}`} aria-hidden="true"></span>`;
}

/**
 * 立绘截取 (the owner's decision of 2026-11-08): the window that plans which band of an illustration the plate shows.
 * The horizontal framing stays fixed — the plate is a wide band, so a portrait illustration is always scaled width-fit
 * and the only thing left to choose is this band — so the window can only be dragged up and down (pointer or the arrow
 * keys). The strip below is the plate itself, so what one drags is what the room sees; the anchor travels with the card
 * (shared/playerCard.js bgShift), teammates included.
 * @param {{ card: string, shift: number, onApply: (p: number) => void, onClose: () => void }} props
 */
export function NameCardCrop({ card, shift, onApply, onClose }) {
  useData('assets');
  const nc = namecardOf(card);
  const src = namecardSrc(nc);
  const [p, setP] = useState(clampShift(shift));
  const stage = useRef(null);
  const [drag, setDrag] = useState(false);
  if (!nc || !src) return null;
  const move = (clientY) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || !r.height) return;
    setP(Math.max(0, Math.min(100, Math.round(((clientY - r.top) / r.height) * 100))));
  };
  const win = html`<div class=${`nc-crop__win${drag ? ' is-drag' : ''}`} role="slider" tabindex="0"
    aria-label=${t('上下拖动选择截取范围')} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${p} style=${`top:${p}%`}
    onPointerDown=${(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(true); move(e.clientY); }}
    onPointerMove=${(e) => { if (drag) move(e.clientY); }}
    onPointerUp=${() => setDrag(false)} onPointerCancel=${() => setDrag(false)}
    onKeyDown=${(e) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowUp') { e.preventDefault(); setP((x) => Math.max(0, x - step)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setP((x) => Math.min(100, x + step)); }
    }}>
    <span class="nc-crop__grip" aria-hidden="true"></span></div>`;
  return html`<div class="nc-crop" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-crop__panel" role="dialog" aria-modal="true" aria-label=${t('立绘截取')}>
      <header class="nc-crop__head"><strong>ILLUSTRATION CROP</strong><span class="nc-crop__title">${t('立绘截取')}</span>
        <button type="button" class="nc-crop__x" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button></header>
      <div class="nc-crop__view">
        <div class="nc-crop__stage" ref=${stage}>
          <img class="nc-crop__art" src=${src} alt="" draggable=${false} />
          ${win}
        </div>
      </div>
      <div class="nc-crop__result has-nc"><${NameCardLayer} card=${nc.id} shift=${p} />
        <span class="nc-crop__result-name">${t('席位名牌')}</span></div>
      <footer class="nc-crop__foot">
        <${Button} variant="secondary" size="sm" onClick=${() => setP(BG_SHIFT_DEFAULT)}>${t('恢复默认')}<//>
        <${Button} variant="primary" onClick=${() => onApply(p)} data-testid="namecard-crop-confirm">${t('确认')}<//>
      </footer>
    </div>
  </div>`;
}

/** 名片底图 picker: 不使用底图 and every card; picking closes it. Esc / the backdrop close it too. */
export function NameCardPicker({ current, onPick, onClose }) {
  useData('assets');
  const m = data.get('assets');
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const pick = (id) => { onPick(id); onClose(); };
  const card = (c) => html`<button key=${c.id} type="button" class=${`nc-pick__card${current === c.id ? ' is-on' : ''}`} onClick=${() => pick(c.id)} title=${t(c.name)}>
    <span class="nc-pick__art has-nc"><${NameCardLayer} card=${c.id} /><span class="nc-pick__name">${t(c.name)}</span></span>
    ${current === c.id ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`;
  // the skins in the art index, searchable by skin, brand or operator name; tiles show the half-body art (lazy)
  const needle = q.trim().toLowerCase();
  const charName = (s) => String(s.charName || '');
  const skins = OPERATOR_SKINS.filter((s) => m?.skins?.[s.id]?.illustration)
    .filter((s) => !needle || [t(s.name), t(s.brand || ''), charName(s)].some((x) => x.toLowerCase().includes(needle)));
  const skinCard = (s) => { const id = `skin:${s.id}`, src = namecardSrc(namecardOf(id), m, true);
    return html`<button key=${id} type="button" class=${`nc-pick__card nc-pick__card--skin${current === id ? ' is-on' : ''}`} onClick=${() => pick(id)} title=${`${charName(s)} · ${t(s.name)}`}>
      <span class="nc-pick__art nc-pick__art--skin">${src ? html`<img src=${src} alt="" loading="lazy" draggable=${false} />` : null}
        <span class="nc-pick__name">${t(s.name)}<small>${charName(s)}</small></span></span>
      ${current === id ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`; };
  return html`<div class="nc-pick" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-pick__panel" role="dialog" aria-modal="true" aria-label=${t('名片底图')}>
      <header class="nc-pick__head"><strong>NAME CARD</strong><span class="nc-pick__title">${t('名片底图')}</span>
        <button type="button" class="nc-pick__x" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button></header>
      <div class="nc-pick__grid">
        <button type="button" class=${`nc-pick__card nc-pick__card--none${!namecardOf(current) ? ' is-on' : ''}`} onClick=${() => pick('')}>
          <span class="nc-pick__art"><${Icon} name="close" /><span class="nc-pick__name">${t('不使用底图')}</span></span></button>
        <h4 class="nc-pick__theme">${t('模拟场景')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'loading').map(card)}
        <h4 class="nc-pick__theme">${t('阵营徽记')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'camp').map(card)}
        <h4 class="nc-pick__theme nc-pick__theme--skins">${t('干员皮肤立绘')}
          <input type="search" class="nc-pick__search" value=${q} placeholder=${t('搜索皮肤或干员')} onInput=${(e) => setQ(e.currentTarget.value)} /></h4>
        ${skins.map(skinCard)}
      </div>
      <footer class="nc-pick__foot"><small>${t('名片底图显示在同盟席位的名牌后面，同盟里的博士都能看到')}</small></footer>
    </div>
  </div>`;
}
