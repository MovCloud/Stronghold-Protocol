import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GAME_NODES, STATUS_ORIGIN, nodeForHost, normalizeNodeStatus, recommendNode } from '../../../shared/serverSelection.js';
import { N_ } from '../../../shared/i18n.js';

export const currentGameNode = () => nodeForHost(globalThis.location?.hostname);
const PRESSURE = { low: N_('流畅'), moderate: N_('中等'), busy: N_('繁忙'), unknown: N_('检查中') };

export async function probeNode(node, fetchFn = globalThis.fetch) {
  return { available: false, receivedAt: Date.now() };
}

export function ServerPicker({ selected = currentGameNode(), onSelect, locked = false, compact = false }) {
  return null;
}
