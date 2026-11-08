// Room display metadata only. Never accept URLs, identity, stats or gameplay settings.
import { isSkinId } from './skins.js';
import { parseAvatarId } from './avatarSources.js';

export const isCardOperatorId = (v) => typeof v === 'string' && (v === '' || (v.length <= 80 && /^char_[a-zA-Z0-9_]+$/.test(v)));

/** Avatar choice: a legacy operator id, or that operator's skin id (char_…@series#n). Never a URL. */
export function cardAvatarOperatorId(v) {
  if (isCardOperatorId(v)) return v;
  if (!isSkinId(v)) return '';
  const at = v.indexOf('@');
  const owner = v.slice(0, at);
  return at > 0 && at < v.length - 1 && v.indexOf('@', at + 1) < 0 && isCardOperatorId(owner) ? owner : '';
}

/** A source avatar (shared/avatarSources.js): `bond:…` / `band:…` / `enemy:…` / `camp:…` / `loading:…` — no operator behind it. */
export const isAvatarSourceId = (v) => {
  const p = parseAvatarId(v);
  return !!p && p.kind !== 'operator';
};

export const isCardAvatarId = (v) => v === '' || !!cardAvatarOperatorId(v) || isAvatarSourceId(v);
// Portraits preserve the old charId field; it can now also carry an operator-owned skin id, but never a source avatar.
export const cardPortraitOperatorId = cardAvatarOperatorId;
export const isCardPortraitId = (v) => v === '' || !!cardAvatarOperatorId(v);

/**
 * 立绘截取 (the owner's decision of 2026-11-08): the vertical anchor of a 名片底图 crop in percent — which band of the
 * illustration the plate shows. The horizontal framing is fixed (the plate is a wide band, so a portrait illustration
 * is always scaled width-fit), so this number is the only thing the player can choose. 24 is the anchor the layer had
 * before the crop window existed: an unadjusted card stores nothing, so room.state stays exactly as it was.
 */
export const BG_SHIFT_DEFAULT = 24;
export const BG_SHIFT_MAX = 100;

/** The crop anchor of a 名片底图: an integer percent 0–100. */
export function isCardShift(v) {
  return Number.isInteger(v) && v >= 0 && v <= BG_SHIFT_MAX;
}

/**
 * Old or damaged saves degrade to defaults; unknown fields are not forwarded.
 * @param {any} v
 * @param {(id: string) => boolean} [isOperator]
 */
export function cleanPlayerCard(v, isOperator = () => true) {
  const id = (s) => isCardPortraitId(s) && s && isOperator(cardPortraitOperatorId(s)) ? s : '';
  const avatar = isCardAvatarId(v?.avatar) && (isAvatarSourceId(v.avatar) || isOperator(cardAvatarOperatorId(v.avatar))) ? v.avatar : '';
  return Object.freeze({ charId: id(v?.charId), avatar });
}
