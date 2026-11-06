import { html, Button } from './components.js';
import { copyText } from './clipboard.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';

// The feedback QQ group the lobby shows. Shipped default; an installation can point it at its own group with
// /data/site.json (ui/siteConfig.js) — or hide the button by setting an empty value there. A live binding so the
// component picks up an override applied at boot.
export let FEEDBACK_GROUP = '243859707';

/**
 * Override the feedback group (ui/siteConfig.js). An explicit null hides the button (空值隐藏); a non-empty string
 * replaces the default; a missing/blank-unless-explicit value keeps what is set.
 * @param {string|null} group
 */
export function setFeedbackGroup(group) {
  if (group === null) FEEDBACK_GROUP = null;
  else if (typeof group === 'string' && group.trim()) FEEDBACK_GROUP = group.trim();
}

export async function copyFeedbackGroup(copy = copyText, notify = toast) {
  if (!FEEDBACK_GROUP) return false;
  let copied = false;
  try { copied = await copy(FEEDBACK_GROUP); } catch { /* manual copy remains available */ }
  notify(copied ? t('已复制反馈群号 {group}', { group: FEEDBACK_GROUP }) : t('复制失败，请手动复制'), copied ? 'success' : 'warn');
  return copied;
}

export function LobbyFeedback() {
  if (!FEEDBACK_GROUP) return null; // an installation may opt out of the entry (site.json feedbackGroup: "")
  return html`<${Button} class="lobby-feedback num selectable" variant="secondary" size="sm" icon="copy"
    title=${t('反馈 QQ 群：{group}，点击复制群号', { group: FEEDBACK_GROUP })}
    aria-label=${t('反馈 QQ 群：{group}，点击复制群号', { group: FEEDBACK_GROUP })}
    onClick=${() => copyFeedbackGroup()}><span class="lobby-feedback__label">${t('反馈群')}</span>${FEEDBACK_GROUP}<//>`;
}
