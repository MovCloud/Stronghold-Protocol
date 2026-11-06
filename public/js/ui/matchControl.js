// 比赛控制 (server/match/match/matchControl.js): 暂停 / 快进 / 跳过 are requests the connected humans must all agree to.
// MatchControlNotice is the open vote (m.public.matchControl) — 同意 / 反对 for the voters, 撤回 for the proposer; when the
// match has no other connected human the server settles the request at once, so there is nothing to show. UI hints only:
// the authority rechecks every rule.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Countdown } from './components.js';
import { act } from './gameActions.js';
import { useStore } from '../store.js';
import { t, N_ } from '../../../shared/i18n.js';

/** The display name of a control action; the same msgid as the button it is requested from. */
const ACTION_NAME = { pause: N_('暂停'), resume: N_('继续作战'), fast: N_('快进'), skip: N_('跳过') };
export const controlActionName = (action) => t(ACTION_NAME[action] || String(action));

function useSend() {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  return [busy, send];
}

export function MatchControlNotice({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, send] = useSend();
  const vote = pub?.matchControl;
  if (!vote) return null;
  const players = pub.players || [];
  const nameOf = (id) => players.find((p) => p.playerId === id)?.name || t('博士');
  const voter = vote.voters.includes(myId);
  const agreed = vote.agreed.includes(myId), rejected = vote.rejected.includes(myId);
  const proposer = vote.proposerId === myId;
  const ballot = (agree) => send(() => act('g.matchControlBallot', { voteId: vote.id, agree }, { sfx: agree ? 'confirm' : 'back' }));
  return html`<div class="team-rescue team-control" role="status" aria-live="polite">
    <strong><${Icon} name="fastForward" /> ${t('{action} 投票', { action: controlActionName(vote.action) })}</strong>
    <${Countdown} deadline=${vote.deadline} size="sm" gauge=${false} label=${t('投票剩余')} />
    <small>${t('同意 {agreed}/{need} · 反对 {rejected}', { agreed: vote.agreed.length, need: vote.need, rejected: vote.rejected.length })}
      · ${t('{name} 发起', { name: nameOf(vote.proposerId) })}</small>
    ${voter ? html`<div class="team-kick__actions">
      ${proposer ? html`<${Button} size="sm" disabled=${busy || !online} onClick=${() => ballot(false)}>${t('撤回')}<//>`
        : html`<${Button} variant="primary" size="sm" disabled=${busy || !online || agreed} onClick=${() => ballot(true)}>${agreed ? t('已同意') : t('同意')}<//>
          <${Button} variant="danger" size="sm" disabled=${busy || !online || rejected} onClick=${() => ballot(false)}>${rejected ? t('已反对') : t('反对')}<//>`}
    </div>` : null}
  </div>`;
}
