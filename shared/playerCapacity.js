import { MAX_SEATS, MAX_DRAFT_CARDS } from './constants.js';

// Larger rooms and same-capacity party matchmaking are explicit opt-in experiments.
export const PLAYER_CAPACITIES = Object.freeze([MAX_SEATS, 8, 12, 16, 20]);
export const MAX_PLAYER_CAPACITY = 20;
export const PLAYER_CAPACITY_VERSION = 'capacity-3';
export const isPlayerCapacity = value => Number.isInteger(value) && PLAYER_CAPACITIES.includes(value);

export function roomCapacity(mode, experimental) {
  if (mode === 'solo') return 1;
  const capacity = experimental && typeof experimental === 'object'
    ? Object.getOwnPropertyDescriptor(experimental, 'playerCapacity')?.value : undefined;
  return isPlayerCapacity(capacity) ? capacity : MAX_SEATS;
}

// ---- grouped co-op pools (docs/PLAYER_CAPACITY.md) ------------------------------------------------------------
// A room of six seats and above splits into fixed, seat-ordered groups, each with its own full chess pool. The
// baseline is MAX_SEATS (the ordinary room); a three-player group keeps the original pool, only a five-player
// group expands it. Group sizes follow the user-approved seat-ordered layouts and never rebalance after a death.

export const MIN_COOP_DRAFT_CARDS = MAX_DRAFT_CARDS;
export const GROUPED_POOL_MIN_PLAYERS = 6;
export const MAX_UNITE_ROUNDS = 5;
export const MAX_UNITE_HELPERS = MAX_UNITE_ROUNDS * 2;

/** Each fixed co-op group has its own six-card page, independent of room or living-player count. */
export function coopDraftCardCount() { return MIN_COOP_DRAFT_CARDS; }

const POOL_GROUP_LAYOUTS = {
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
  9: [4, 5],
  10: [4, 3, 3],
  11: [4, 4, 3],
  12: [4, 4, 4],
  13: [5, 4, 4],
  14: [4, 4, 3, 3],
  15: [4, 4, 4, 3],
  16: [4, 4, 4, 4],
  17: [5, 4, 4, 4],
  18: [4, 4, 4, 3, 3],
  19: [4, 4, 4, 4, 3],
  20: [4, 4, 4, 4, 4],
};

/** One shared pool for up to five; six or more use fixed groups of three, four or five. Returns a copy. */
export function poolGroupSizes(players) {
  if (!Number.isInteger(players) || players < 1 || players > MAX_PLAYER_CAPACITY) throw new RangeError('invalid player count');
  if (players < GROUPED_POOL_MIN_PLAYERS) return [players];
  return POOL_GROUP_LAYOUTS[players].slice();
}

/** A three-player group keeps the complete original pool; only a five-player group expands. */
export const poolCopyScale = (groupSize) => Math.max(1, groupSize / MAX_SEATS);

/** The opening pool-group count sets the Unite limit; later departures never lower it. */
export const uniteRoundLimit = (poolGroupCount) => Number.isInteger(poolGroupCount)
  ? Math.max(1, Math.min(MAX_UNITE_ROUNDS, poolGroupCount)) : 1;

/** Keep the original <=4 player unlock requirement; larger teams need proportionally more layers. */
export const coopHiddenLayerThreshold = (baseline, players) => Math.ceil(baseline * Math.max(1, players / MAX_SEATS));
