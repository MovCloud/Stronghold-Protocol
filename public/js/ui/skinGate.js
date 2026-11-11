// 皮肤管理 (docs/CONTENT-ADMIN.md §9) — the client half of the admin's skin gate.
//
// Which skins this installation offers is the server's decision (runtime/skins.json, read once at boot); which skin a
// player wears is the browser's own (ui/skins.js: localStorage is the true source, the server only mirrors it so
// teammates see the same card). So the client reads the decision from GET /api/skins/gate and applies it to its own
// storage before the first render:
//
//   * the picker hides a stopped skin — ui/skins.js `availableSkins` filters through the same judgement, so the row
//     is simply absent and a player cannot pick it again;
//   * a choice this browser still holds is rewritten to that operator's default appearance and saved, so the sync
//     engine (ui/loadoutSync.js) sends the corrected choice instead of one the server would reject. The card's
//     立绘 / 头像 / 名片底图 and the two look fields go back to their default the same way; nothing else about the
//     player changes.
//
// The player is told once, on the page load that applies the gate. The server cleaned the persisted sessions at the
// restart (server/skinGate.js), but localStorage is the browser's, so this is the first moment the two agree again —
// which is why the notice is the client's, not the server's.
import { t } from '../../../shared/i18n.js';
import { setSkinGate, skinDenied } from '../../../shared/skins.js';
import { savePref } from '../store.js';
import { SKINS_KEY, skinsStore, setSkins } from './skins.js';
import { cardStore, AVATAR_PREF, CARD_LOOK_PREF, AVATAR_LOOK_PREF,
  setCardOperator, setCardAvatar, setCardLook, setAvatarLook, setCardBackground } from './playerCard.js';
import { CARD_PREF } from './seatArt.js';
import { NAMECARD_PREF } from './namecards.js';

const str = (v) => (typeof v === 'string' ? v : '');
/** The skin id a card field carries: the 名片底图 stores `skin:<id>`, the portrait and the avatar the bare id. */
const skinOf = (v) => (str(v).startsWith('skin:') ? str(v).slice(5) : str(v));

/** Each card field's own preference key — the setters update the store, the gate writes the storage behind it. */
const CARD_FIELD = { charId: CARD_PREF, avatar: AVATAR_PREF, look: CARD_LOOK_PREF, avatarLook: AVATAR_LOOK_PREF, bg: NAMECARD_PREF };

/**
 * Apply the gate to this browser's own storage and stores.
 * @param {Record<string, string[]>} disabled the gate the server published
 * @returns {Set<string>} the skin ids this browser had to give up
 */
export function applySkinGate(disabled) {
  setSkinGate(disabled);
  const dropped = new Set();

  const next = {};
  for (const [charId, skinId] of Object.entries(skinsStore.get()[SKINS_KEY] || {})) {
    if (skinDenied(skinId)) { dropped.add(skinId); continue; }
    next[charId] = skinId;
  }
  if (dropped.size) setSkins(next);

  for (const [field, set] of Object.entries({ charId: setCardOperator, avatar: setCardAvatar,
    look: setCardLook, avatarLook: setAvatarLook, bg: setCardBackground })) {
    const id = skinOf(cardStore.get()[field]);
    if (!id || !skinDenied(id)) continue;
    dropped.add(id);
    set('');
    savePref(CARD_FIELD[field], '');
  }
  return dropped;
}

/**
 * Fetch the gate, install it and correct this browser's stored choice. Never stops boot: without the gate the page
 * behaves exactly as it did before the feature existed.
 * @param {{ toast: (text: string, kind?: string) => void }} [deps]
 */
export async function installSkinGate({ toast } = {}) {
  let body;
  try {
    const res = await fetch('/api/skins/gate', { cache: 'no-store' });
    if (!res.ok) return null;
    body = await res.json();
  } catch { return null; }
  const disabled = body && typeof body.disabled === 'object' && body.disabled ? body.disabled : null;
  if (!disabled || !Object.keys(disabled).length) return null;

  const dropped = applySkinGate(disabled);
  if (dropped.size && toast) toast(t('部分皮肤已停止提供，已为你恢复默认外观'), 'info');
  return disabled;
}
