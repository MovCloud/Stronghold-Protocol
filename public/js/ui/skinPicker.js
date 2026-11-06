// Display-only appearance editing; import/export belongs to the parent operator preset toolbar.
// docs/SKINS.md: the choices are the manifest's own skin keys (`chars[charId].skins`), resolved by assets.js
// (skinsOf / skinHasModel) — the same records the battle renderer wears, so what the picker shows is what is drawn.
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, Modal, Fragment } from './components.js';
import { Img } from './gameComponents.js';
import { chessPortraitUrl } from './assetUrls.js';
import { skinsOf, skinHasModel, registeredDynamicArt } from '../assets.js';
import { hasAnySkinChoices } from './skins.js';
import { t, N_ } from '../../../shared/i18n.js';

const syncLabels = { idle: N_('未连接'), pending: N_('等待同步'), sending: N_('正在同步'), synced: N_('外观已同步'), locked: N_('下一局生效'), error: N_('同步失败') };
// The section's display rule (docs/SKINS.md) is GLOBAL and comes from ui/skins.js `hasAnySkinChoices`: while no
// operator has a wear-able skin the section is left out; as soon as one has, EVERY operator shows it — a lone 默认 tile
// is the proof the cosmetic layer is on. A missing piece of art falls back to the operator's own, never to a
// placeholder, so a picture-only plugin draws the picture that plugin wrote.

/**
 * The enlarged preview of one appearance: its 立绘 (the whole picture, not the cropped tile) inside a modal.
 * A plain component taking a URL rather than reading the store, so its markup can be tested without a browser.
 * `fallbackSrc` / `fallback` are the fork's degradation path (a picture that fails to load falls back to the
 * operator's own art); without them this is the main-line markup, one plain `img`.
 * @param {{ art?: string|null, name?: string, fallbackSrc?: string|null, fallback?: any }} props
 */
export function SkinPreview({ art = null, name = '', fallbackSrc = null, fallback = null }) {
  if (!art) return null;
  if (fallbackSrc || fallback) return html`<div class="lo-skin-preview"><${Img} src=${art} fallbackSrc=${fallbackSrc} fallback=${fallback} /></div>`;
  return html`<div class="lo-skin-preview"><img src=${art} alt=${name} /></div>`;
}

export function SkinSection({ m, charId, record, choices = {}, sync = 'idle', onChange, locked = false }) {
  const [preview, setPreview] = useState(false);
  const map = skinsOf(m, charId);
  // A skin is wearable with a battle model of its own OR with any picture slot: a registered static skin (the skin
  // registry, public/js/skinRegistry.js) carries pictures only, and the renderer then falls back to the operator's own
  // model (assets.js spineEntry) — its pictures are the point. Neither pictures nor a model → listed, not offered.
  const wearable = (s) => skinHasModel(s) || !!(s && (s.avatar || s.avatarE2 || s.portrait || s.portraitE2 || s.illust));
  const list = Object.entries(map).map(([id, s]) => ({ id, name: (s && s.name) || id, group: (s && s.group) || '', art: (s && s.portrait) || (s && s.illust) || null, wearable: wearable(s) }));
  // the choice is only shown once the manifest still holds that skin (a plugin removed it → back to the default look)
  const chosen = typeof choices?.[charId] === 'string' && choices[charId] && map[choices[charId]] ? choices[charId] : null;
  const art = chosen ? map[chosen] : null;
  const illustration = art ? (art.illust || null) : null;
  // A REGISTERED dynamic (spine) skin (the skin registry, P6 §3.3) previews through the shared player; its failure
  // degrades to the skin's own static slots, then the operator's own art (registeredDynamicArt). Official skins are
  // never mapped, and with no dynamic skin previewed neither the player import nor the DOM changes — the main-line
  // path stays byte for byte.
  const dynamic = registeredDynamicArt(m, charId, chosen);
  const hasDynamic = !!dynamic;
  const [Dynamic, setDynamic] = useState(null);
  useEffect(() => {
    if (!preview || !hasDynamic || Dynamic) return;
    let live = true;
    import('./dynamicIllustration.js').then((mod) => { if (live) setDynamic(() => mod.DynamicIllustration); }).catch(() => { /* the static preview stands */ });
    return () => { live = false; };
  }, [preview, hasDynamic, Dynamic]);
  // the GLOBAL gate (docs/SKINS.md): shown for every operator as soon as any operator of the manifest has a wear-able
  // skin, and for none while none has. A per-operator gate lived here and was removed on purpose — see the header.
  if (!hasAnySkinChoices()) return null;
  const defaultArt = chessPortraitUrl(m, { ...record, skin: null });
  const noArt = html`<p>${t('立绘暂时无法载入')}</p>`;
  // An operator the composed manifest does not hold at all has nothing to draw — not even a 默认 tile — so it gets no
  // section rather than an empty grid: the global rule can only show what the manifest has.
  const rows = m && m.chars && m.chars[charId] ? [{ id: null, name: t('默认外观'), group: t('随普通／精锐状态显示'), art: defaultArt, wearable: true }, ...list] : [];
  if (!rows.length) return null;
  const pick = (id) => {
    const next = { ...(choices || {}) };
    if (id) next[charId] = id; else delete next[charId];
    onChange?.(next);
  };
  return html`<${Fragment}>
    <section class="lo-sec lo-sec--skins" aria-label=${t('干员外观')} data-testid="skin-picker">
      <header class="lo-sec__head">
        <h3>${t('外观')}<${MicroLabel}>APPEARANCE<//></h3>
        <span class="lo-skin-sync" role="status" data-testid="skin-sync">${t(syncLabels[sync] || syncLabels.idle)}</span>
      </header>
      <div class="lo-skins" role="radiogroup" aria-label=${t('选择干员外观')}>
        ${rows.map((s) => {
          const on = chosen === s.id;
          return html`<button key=${s.id || 'default'} type="button" role="radio" aria-checked=${on ? 'true' : 'false'} data-skin=${s.id || 'default'}
              class=${`lo-skin${on ? ' is-on' : ''}`} disabled=${!s.wearable} onClick=${() => pick(s.id)}>
            <span class="lo-skin__art"><${Img} src=${s.art} fallbackSrc=${defaultArt} fallback=${html`<span class="t-dim">${t('暂无预览')}</span>`} /></span>
            <span class="lo-skin__name">${t(s.name)}</span>
            <span class="lo-skin__brand">${s.wearable ? t(s.group) : t('素材未安装')}</span>
            ${on ? html`<span class="lo-skin__mark"><${Icon} name="check" />${t('已选择')}</span>` : null}
          </button>`;
        })}
      </div>
      <p class="lo-skin__note">${!list.length ? t('当前干员暂无已收录时装。') : t('仅改变头像、立绘和战斗本体，不改变属性、技能或伤害。')}
        ${locked ? t('本局外观已锁定，修改将在下一局生效。') : ''}</p>
      <div class="lo-skin__tools">
        ${illustration || dynamic ? html`<${Button} variant="secondary" size="sm" data-testid="skins-preview" onClick=${() => setPreview(true)}>${t('查看立绘')}<//>` : null}
      </div>
    </section>
    ${preview ? html`<${Modal} open=${true} onClose=${() => setPreview(false)} title=${t(list.find((s) => s.id === chosen)?.name || N_('干员立绘'))} micro="OPERATOR ARTWORK"
        actions=${html`<${Button} variant="secondary" onClick=${() => setPreview(false)}>${t('关闭')}<//>`}>
      ${Dynamic && dynamic ? html`<${Dynamic} entry=${dynamic.entry} staticSrc=${dynamic.staticSrc || defaultArt} />`
        : SkinPreview({ art: illustration, name: list.find((s) => s.id === chosen)?.name || '', fallbackSrc: defaultArt, fallback: noArt })}
    <//>` : null}
  <//>`;
}
