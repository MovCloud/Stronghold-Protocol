import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

// The edge host's own page (deploy/stardust/feedback), beside the feedback group: the public feedback board. Same origin
// and the same password gate as the game; it opens in a new tab so the lobby and its connection stay where they are (the
// owner's request of 2026-10-16). This branch shows no server-status page anywhere (the owner's request of 2026-10-25).
// Shipped default; an installation can point it at its own page with /data/site.json (ui/siteConfig.js). Kept as a live
// binding so the component picks up an override applied at boot.
// Three-state: a missing key keeps the shipped default, an explicit empty value hides the link (an installation that
// does not run that service), a non-empty string points it at the installation's own page.
export let FEEDBACK_BOARD = '/feedback/';

/** Override the board link (ui/siteConfig.js); an empty value hides it. @param {{feedbackBoard?: string}} [urls] */
export function setSiteBoards({ feedbackBoard } = {}) {
  if (typeof feedbackBoard === 'string') FEEDBACK_BOARD = feedbackBoard.trim() || null;
}

export function SiteBoards() {
  if (!FEEDBACK_BOARD) return null; // an installation without that page renders nothing
  return html`<nav class="hub-boards" aria-label=${t('反馈板')}><a class="btn btn--secondary btn--sm hub-board" href=${FEEDBACK_BOARD} target="_blank" rel="noopener"
      title=${t('反馈板：提交 Bug 与玩法建议，查看回复和处理状态（新标签页打开）')}><${Icon} name="edit" class="btn__icon" /><span class="btn__label">${t('反馈板')}</span></a></nav>`;
}
