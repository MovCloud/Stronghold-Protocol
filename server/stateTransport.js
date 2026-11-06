// Server side of the state-delta transport (shared/stateDelta.js; after xinhai-ai/Stronghold-Protocol 2abc60f).
//
// Baselines live per socket: the browser's socket in a single process (server/net.js), the per-member game channel
// on a cluster game node (cluster/game-node.js; the ingress relays m.state untouched). A new socket starts from full
// frames, so a reconnect or a channel switch needs no reset message. A baseline moves only after the frame was queued
// (commit), and the transport is reliable and ordered, so the browser's baseline is always the one a delta names.
// Encoding is shared per message object: a broadcast parses its JSON once, and members whose last frame was the same
// snapshot share one delta string.
import { diffState, isStateKind, STATE_DELTA_VERSION } from '../shared/stateDelta.js';

/** @type {WeakMap<object, { room: string | null, kinds: Map<string, Snapshot> }>} socket → its baselines (cleared on a room change) */
const sockets = new WeakMap();
/** @type {WeakMap<object, Snapshot>} message object → its snapshot */
const snapshots = new WeakMap();
/** @type {WeakMap<object, { encoded: string, frame: { stream: string, seq: number, base: number|undefined, delta: string|null }, owner: any }>} message object → the frame its lane worker precomputed (server/workers/stateEncoder.js) */
const workerFrames = new WeakMap();
let sequence = 0;
const noop = () => {};
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Pre-encoded bytes only become this connection's baseline when they really are this message's own JSON (§35.89):
 * a lane worker can hand back anything, and garbage must not poison the chain the browser decodes. */
const isOwnJson = (view, kind) => record(view) && view.t === kind;
/** The ordinary encoding of `msg`, for bytes that cannot be a baseline. */
function plainEncoding(msg, fallback) {
  try { const s = JSON.stringify(msg); return typeof s === 'string' ? s : fallback; } catch { return fallback; }
}
// Terminal phases stay plain m.public: the cluster ingress drops those by type (only the coordinator's receipt
// delivers a result), which it could not do inside a delta.
const TERMINAL_PHASES = new Set(['RESULT', 'ENDED']);
// `{"t":"m.state","kind":"m.private","seq":<n>,"full":` + `}`, with room for a long seq
const FULL_OVERHEAD = 64;

/** Frames and bytes by encoding, for /metrics. */
export const stateDeltaStats = { full: 0, delta: 0, fullBytes: 0, deltaBytes: 0, plainBytesAvoided: 0 };

/**
 * @typedef {{ encoded: string, bytes: number, seq: number, kind: string, view: any, full: string | null,
 *   transitions: WeakMap<Snapshot, { data: string, bytes: number } | null> }} Snapshot
 */

/** hello.stateDelta (browser) or cluster.bind stateDelta (ingress): enable for this socket, or disable. */
export function negotiateStateDelta(ws, version) {
  if (!ws || typeof ws !== 'object') return;
  if (version === STATE_DELTA_VERSION) { if (!sockets.has(ws)) sockets.set(ws, { room: null, kinds: new Map() }); }
  else sockets.delete(ws);
}

/**
 * Attach the frame a lane worker precomputed for `msg` (server/workers/matchPool.js; the frame comes from
 * server/workers/stateEncoder.js, which owns the same encoded JSON). prepareStateFrame then sends the worker's own
 * delta when this socket's baseline is that stream's previous frame, and stores it as the baseline otherwise —
 * the main thread never re-diffs a worker-owned state.
 */
export function attachWorkerState(msg, encoded, frame, owner) {
  if (frame) workerFrames.set(msg, { encoded, frame, owner });
  return msg;
}

/** @returns {boolean} */
export const stateDeltaEnabled = (ws) => !!ws && typeof ws === 'object' && sockets.has(ws);

/** The already negotiated capability, for an internal identity handover on the same socket. */
export function stateDeltaVersion(ws) { return sockets.has(ws) ? STATE_DELTA_VERSION : undefined; }

/**
 * Pre-create the snapshot for a state frame about to be queued (the outbound pump's capture step): the
 * sequence number is reserved in ENQUEUE order — the order recipients will write in — so a later
 * coalescing or deferred write cannot reorder shared sequence numbers. Repeated calls with the same
 * encoding reuse the reservation (net-fanout: encode once, queue for every recipient).
 * @param {object} msg the state message ({ t: kind })
 * @param {string} encoded the encoded snapshot
 * @returns {string} the same encoded string
 */
export function reserveStateFrame(msg, encoded) {
  if (!msg || typeof msg !== 'object' || typeof encoded !== 'string') return encoded;
  const existing = snapshots.get(msg);
  if (existing && existing.encoded === encoded) return encoded;
  try {
    const view = JSON.parse(encoded);
    if (!isOwnJson(view, msg.t)) return encoded; // not this message's JSON: nothing to reserve, no sequence spent
    snapshots.set(msg, {
      encoded,
      bytes: Buffer.byteLength(encoded),
      seq: ++sequence,
      kind: typeof msg.t === 'string' ? msg.t : null,
      view,
      full: null,
      transitions: new WeakMap(),
    });
  } catch { /* not JSON (a plain encoded frame): no reservation needed */ }
  return encoded;
}

/** Clear a socket's state baselines: the next m.state goes out as a full recovery frame. */
export function resetStateDelta(ws) {
  if (!ws || typeof ws !== 'object') return;
  const entry = sockets.get(ws);
  if (entry) entry.kinds.clear();
}

/**
 * The bytes to queue for `msg` (already encoded as `encoded`) on `ws`, and commit() to call once they were queued.
 * Plain `encoded` for a socket without the transport and for any other message.
 * @param {import('ws').WebSocket | null | undefined} ws
 * @param {object} msg @param {string} data encode(msg)
 * @param {string | null} [roomKey] the room this session is in; a change clears the baselines on both endpoints
 *   (§35.89 — the browser resets its receiver when room.state names another room), so a delta never names a
 *   baseline the client no longer has.
 * @returns {{ data: string, commit: () => void }}
 */
export function prepareStateFrame(ws, msg, encoded, roomKey = null) {
  const entry = ws && typeof ws === 'object' ? sockets.get(ws) : undefined;
  const kind = msg?.t;
  if (!entry || !isStateKind(kind) || typeof encoded !== 'string'
    || (kind === 'm.public' && TERMINAL_PHASES.has(msg.phase))) return { data: encoded, commit: noop };
  if (roomKey && entry.room !== roomKey) { entry.kinds.clear(); entry.room = roomKey; }
  const states = entry.kinds;
  // A lane worker precomputed this frame (attachWorkerState): trust it — it owns the same encoded JSON.
  const prepared = workerFrames.get(msg);
  if (prepared?.encoded === encoded) {
    const { frame, owner } = prepared;
    const previous = states.get(kind);
    const sameStream = previous?.owner === owner && previous?.stream === frame.stream;
    const delta = sameStream && previous.seq === frame.base && frame.delta
      ? { data: frame.delta, bytes: Buffer.byteLength(frame.delta) } : null;
    const data = delta?.data ?? `{"t":"m.state","kind":"${kind}","seq":${frame.seq},"full":${encoded}}`;
    return {
      data,
      commit() {
        // Store a snapshot-shaped baseline (view included) so a later main-thread encode can diff against it.
        try {
          const bytes = Buffer.byteLength(encoded);
          states.set(kind, {
            encoded, bytes, seq: frame.seq, owner, stream: frame.stream, kind,
            view: JSON.parse(encoded), full: null, transitions: new WeakMap(),
          });
          if (delta) { stateDeltaStats.delta++; stateDeltaStats.deltaBytes += delta.bytes; stateDeltaStats.plainBytesAvoided += bytes; }
          else { stateDeltaStats.full++; stateDeltaStats.fullBytes += bytes; }
        } catch { /* a bad worker encoding cannot become a baseline */ }
      },
    };
  }
  let snapshot = snapshots.get(msg);
  // The encoding, not the (mutable) game object, is the immutable baseline.
  if (!snapshot || snapshot.encoded !== encoded) {
    let view;
    try { view = JSON.parse(encoded); } catch { return { data: plainEncoding(msg, encoded), commit: noop }; }
    if (!isOwnJson(view, kind)) return { data: plainEncoding(msg, encoded), commit: noop };
    snapshot = { encoded, bytes: Buffer.byteLength(encoded), seq: ++sequence, kind, view, full: null, transitions: new WeakMap() };
    snapshots.set(msg, snapshot);
  }
  const previous = states.get(kind);
  /** @type {{ data: string, bytes: number } | null | undefined} */
  let delta = null;
  if (previous && previous !== snapshot) {
    delta = snapshot.transitions.get(previous);
    if (delta === undefined) {
      const patch = diffState(previous.view, snapshot.view);
      const data = patch && JSON.stringify({ t: 'm.state', kind, seq: snapshot.seq, base: previous.seq, patch });
      // UTF-8 bytes, not string length; a large change goes out full.
      const bytes = data ? Buffer.byteLength(data) : Infinity;
      delta = bytes < snapshot.bytes + FULL_OVERHEAD ? { data, bytes } : null;
      snapshot.transitions.set(previous, delta);
    }
  }
  const data = delta?.data ?? (snapshot.full ??= `{"t":"m.state","kind":"${kind}","seq":${snapshot.seq},"full":${encoded}}`);
  return {
    data,
    commit() {
      states.set(kind, snapshot);
      if (delta) { stateDeltaStats.delta++; stateDeltaStats.deltaBytes += delta.bytes; stateDeltaStats.plainBytesAvoided += snapshot.bytes; }
      else { stateDeltaStats.full++; stateDeltaStats.fullBytes += snapshot.bytes; }
    },
  };
}
