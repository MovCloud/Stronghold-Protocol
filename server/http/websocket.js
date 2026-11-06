// server/http/websocket.js — the real-time side of the server:
//
//   * session wiring: SessionRegistry (reconnect tokens) → Lobby (rooms, server/lobby.js) → Network (the socket
//     protocol, server/net.js), built from the startServer() options (config.js decides which go where);
//   * WebSocket (ws) at /ws, maxPayload 1 MiB (WS_MAX_PAYLOAD below, inflated size included), permessage-deflate only
//     when SP_WS_COMPRESSION=on
//     (server/wsCompression.js: the bounded preset and the per-type allowlist) → Network.handleConnection. Refused at
//     the upgrade: any other path 404; per-network socket limit for internet clients (maxConnectionsPerAddr, see net.js
//     clientAddress; local/LAN peers are exempt) 429; server full (maxConnections) or shutting down 503. A generation
//     prefix is accepted (`/_build/<gen>/_/ws`, shared/gen.js).

import { WebSocketServer } from 'ws';
import { Network, SessionRegistry, NET_DEFAULTS } from '../net.js';
import { Lobby } from '../lobby.js';
import { splitGenPath } from '../../shared/gen.js';
import { splitUrl } from './common.js';
import { netOptionsFrom, lobbyOptionsFrom } from './config.js';

/** Inbound WebSocket frame limit (DESIGN §8). Must exceed every frame the C2S schema allows: an oversized frame is
 *  answered by closing the socket with 1009, which a client reads as a drop and reconnects into. */
export const WS_MAX_PAYLOAD = 1 << 20; // 1 MiB

/** A cap as printed on boot: 0 is unlimited in this fork (lobby.js / net.js guard only positive caps). */
function capText(n) { return n > 0 ? n : 'unlimited'; }

/**
 * The session stack of one server.
 * @param {{ MatchClass?: Function, seedFn?: () => number, [option: string]: any }} opts startServer() options
 * @param {{ data: object, log: object, content?: { cs: string } | null,
 *   plugins?: ReturnType<typeof import('../plugins/roomSets.js').createRoomSets> | null,
 *   hosts?: ReturnType<typeof import('../match/host/index.js').createMatchHosts> | null,
 *   versions?: ReturnType<typeof import('../versions.js').createVersionSets> | null,
 *   versionHosts?: ReturnType<typeof import('../match/host/index.js').createMatchHosts> | null }} deps the game data the lobby's
 *   matches use, the logger, the vanilla content (server/plugins/identity.js: welcome / room.state content, BattleSpec
 *   cs), the room sets a room's host chooses from (room.setPlugins: visual and content sets), the match hosts a room with
 *   gameplay plugins plays in (DESIGN §32.6), the simulation pool the bot rehearsals are submitted to
 *   (server/workers/roomPool.js), the official versions and their match hosts (DESIGN §35.23)
 * @returns {{ registry: SessionRegistry, lobby: Lobby, network: Network }}
 */
export function createSessionStack(opts, { data, log, combatPool = null, trialPool = null, simPool = null, getLoadState, getLoadDetails, onlineLimit = null, ownerFile = null,
  content = null, plugins = null, hosts = null, versions = null, versionHosts = null }) {
  if (opts.lobbyFactory != null && typeof opts.lobbyFactory !== 'function') throw new TypeError('invalid lobby factory');
  if (opts.getClusterLoad != null && typeof opts.getClusterLoad !== 'function') throw new TypeError('invalid cluster load provider');
  const netOptions = netOptionsFrom(opts, log);
  // a room whose match runs in a match host (DESIGN §32.6) answers once the host has: promise answers (≤ 64 per socket)
  if (hosts && netOptions.allowAsyncHandlers === undefined) netOptions.allowAsyncHandlers = true;
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs });
  const lobbyOptions = lobbyOptionsFrom(opts, log);
  const createLobby = opts.lobbyFactory || (params => new Lobby(params));
  // Optional coordinator phase recorder (server/phaseMetrics.js); absent everywhere else.
  const metrics = opts.phaseMetrics ? { metrics: opts.phaseMetrics } : {};
  // The limits file (server/onlineLimit.js) also carries the lobby's hot-reloadable room / AI caps (Lobby.cap).
  const lobby = createLobby({ registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, combatPool, trialPool, simPool, options: lobbyOptions,
    limits: onlineLimit, content, plugins, hosts, versions, versionHosts, ...metrics });
  // The owner file (server/ownerFile.js): the 服主 key every hello may carry and the owner's reserved names.
  const network = new Network({ registry, handler: lobby, log, options: netOptions, getLoadState, getLoadDetails, getClusterLoad: opts.getClusterLoad, onlineLimit, ownerFile, ...metrics });
  // The caps in effect, printed once when the stack is built, so the deploy log states the configuration the server is
  // actually running with. In this fork a 0 cap is unlimited — lobby.js and net.js only guard when a cap is positive —
  // so every 0 prints as "unlimited". `log` is the quiet-aware logger, so a test server stays silent.
  log.info(`[http] limits: rooms ${capText(lobby.opts.maxRooms)} (${capText(lobby.opts.maxRoomsPerAddr)}/network), `
    + `matches ${capText(lobby.opts.maxMatchesPerAddr)}/network, `
    + `sockets ${capText(network.opts.maxConnections)} (${capText(network.opts.maxConnectionsPerAddr)}/network)`);

  lobby.network = network;
  return { registry, lobby, network };
}

/**
 * Count a socket in the traffic counters (traffic.js): its wire bytes from now until it closes, the payload of every
 * message it sends (ws.send wrapped) and receives.
 * @param {import('ws').WebSocket} ws
 * @param {import('node:http').IncomingMessage} req
 * @param {ReturnType<typeof import('./traffic.js').createTrafficCounter>} traffic
 */
function meterSocket(ws, req, traffic) {
  const socket = req.socket;
  traffic.wsOpen(socket);
  const send = ws.send;
  ws.send = function meteredSend(data, ...rest) {
    traffic.wsSent(data);
    return send.call(this, data, ...rest);
  };
  ws.on('message', (data) => traffic.wsReceived(data));
  ws.once('close', () => traffic.wsClose(socket));
}

/**
 * Serve the WebSocket endpoint /ws on `server` (its 'upgrade' event).
 * @param {import('node:http').Server} server
 * @param {{ network: Network, log: object, wsCompression?: false | object,
 *   traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter> }} deps
 *   wsCompression: the resolved permessage-deflate options (wsCompression.js resolveWsCompression), false: none
 * @returns {WebSocketServer}
 */
export function attachWebSocket(server, { network, log, wsCompression = false, traffic = null }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: wsCompression, clientTracking: false });
  wss.on('connection', (ws, req) => {
    if (traffic) meterSocket(ws, req, traffic);
    network.handleConnection(ws, req);
  });
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || splitGenPath(parts.rawPath).rest !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });
  return wss;
}
