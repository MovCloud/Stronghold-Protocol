// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (the error pages are bilingual by design, 中文 · English)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` — DESIGN §32 —, sockets, sessions,
//     rooms, matches; `versions: { enabled, default, hosts }` only when the server enables another official version
//     than 第二期下半 — DESIGN §35.23), the room / AI caps in force with the largest per-network use and the refusals (`limits`,
//     lobby.js limitStats), the hello outcomes and match-seat departures since start (`reconnect`), the cached
//     `performance` sample — a cluster coordinator adds `performance.phases`,
//     server/phaseMetrics.js), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category
//     since the start, WebSocket wire and payload bytes) for a loopback or private-network client only — the
//     maintainer's decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy
//     on this machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket
//     limits);
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { readFile, stat } from 'node:fs/promises';
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { PERFORMANCE_UNAVAILABLE } from '../healthMetrics.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { ASSET_CACHE_PREFIX } from './assetCache.js';
import { clientAddress, isLocalIp, netCounters } from '../net.js';
import { stateDeltaStats } from '../stateTransport.js';
import { createPublicApi } from '../publicApi.js';
import { t } from '../../shared/i18n.js';

const MAX_URL_LENGTH = 4096;
const BOARD_MAX_BYTES = 256 * 1024;

/**
 * The operator's lobby announcement board (SP_ANNOUNCEMENTS_BOARD_FILE): the same shape as data/announcements.json.
 * Re-read only when the file changes; a missing, oversized or malformed file keeps the last valid list, an absent one
 * is an empty board — never an error page. The client already treats a non-array as "unavailable", so [] is the
 * safe default (no notices, no auto-popup).
 * @param {string} file
 * @param {object} log
 */
function createAnnouncementBoardReader(file, log) {
  let cached = [], stamp = null, lastError = null;
  return async () => {
    try {
      const info = await stat(file);
      const key = `${info.mtimeMs}:${info.size}`;
      if (key !== stamp) {
        if (info.size > BOARD_MAX_BYTES) throw new Error('board file exceeds 256 KiB');
        const value = JSON.parse(await readFile(file, 'utf8'));
        if (!Array.isArray(value)) throw new Error('board must be a JSON array');
        cached = value; stamp = key;
      }
      lastError = null;
      return cached;
    } catch (e) {
      if (e?.code === 'ENOENT') { cached = []; stamp = null; lastError = null; return cached; }
      const message = e?.message || String(e);
      if (message !== lastError) {
        lastError = message;
        log?.warn?.(`[announcements] board rejected (${message}); serving the last valid list`); // i18n-ignore: operator log
      }
      return cached;
    }
  };
}

/**
 * Paths that stay available while a bandwidth emergency is active: the page shell and the runtime code a
 * match view needs (the dynamic `import('../render/app.js')` graph and PIXI under /vendor). Bulk art/audio
 * under /assets, /fonts, /media and the asset-cache fill API stay gated so the egress budget goes to the
 * matches already running. `/` is included so a reload during the emergency can still get a working client
 * instead of a 503 body (SiderLock).
 */
export function isEmergencyShellPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return false;
  if (rawPath === '/' || rawPath === '/index.html' || rawPath === '/data.js') return true;
  return rawPath.startsWith('/js/') || rawPath.startsWith('/css/')
    || rawPath.startsWith('/vendor/') || rawPath.startsWith('/shared/')
    || rawPath.startsWith('/sim/') || rawPath.startsWith('/data/');
}

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  let notices = false;
  try { notices = lobby?.plugins?.hasNotices?.() === true; } catch { /* optional catalogue hint */ }
  return { ...(n > 0 ? { plugins: n } : {}), ...(notices ? { notices: true } : {}) };
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null, trusted?: any,
 *           versions?: ReturnType<typeof import('../versions.js').createVersionSets> | null,
 *           versionHosts?: { stats: () => object } | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js); versions / versionHosts: the official versions
 *   and their match hosts (DESIGN §35.23)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, browserBuild, combatPool, trialPool, trialStartupFailed, getHealthMetrics,
  traffic, assetIndex, views, trusted, persistence = null, bandwidthEmergency = null, versions = null, versionHosts = null }, withTraffic = false) {
  const combat = combatPool ? { backend: 'workers', scope: 'server-streaming', ...combatPool.stats() } : { backend: 'inline', workers: 0 };
  const ok = !combatPool || (combat.status === 'ready' && combat.ready > 0);
  const trial = trialPool ? { backend: 'workers', scope: 'bot-rehearsal', ...trialPool.stats() }
    : { backend: 'inline', scope: 'bot-rehearsal', workers: 0, status: trialStartupFailed ? 'degraded' : 'disabled' };
  const report = {
    ok, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    build: browserBuild,
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
    // the bandwidth protection state (bandwidthEmergency.js): absent while the feature has never transitioned
    ...(bandwidthEmergency ? { bandwidthEmergency: bandwidthEmergency.status() } : {}),
    maxRooms: lobby.opts?.maxRooms, limits: lobby.limitStats?.() ?? null, combat, trial,
    // since start: hello outcomes (net.js helloStats) and the human seats that left a running match (lobby.js departureStats)
    reconnect: { hello: network.helloStats?.() ?? null, matchSeats: lobby.departureStats?.() ?? null },
    performance: getHealthMetrics?.()?.snapshot() ?? PERFORMANCE_UNAVAILABLE,
    // since start: backpressure (net.js netCounters) and the m.state transport (stateTransport.js)
    net: { ...netCounters, stateDelta: { ...stateDeltaStats } },
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  // the official versions (DESIGN §35.23): only when another one than 第二期下半 is enabled
  if (versions && versions.nonDefault.length) {
    report.versions = { enabled: [...versions.ids], default: versions.defaultId,
      hosts: versionHosts ? versionHosts.stats() : { workers: 0, matches: 0, transport: 'process' } };
  }
  // checkpoints (SP_REDIS_URL, server/persist/): writes, failures, restores since start — absent when off
  if (persistence) { try { report.persistence = persistence(); } catch { report.persistence = null; } }
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null, emergency = () => null, assetCache = null,
  announcementReader = null, announcementSource = null, announcements = null, announcementScheduleApi = false, announcementBoardFile = null,
  skinGate = null }) {
  // The operator board replaces the shipped data file on the same public URL; unset keeps the static file.
  const readAnnouncementBoard = announcementBoardFile ? createAnnouncementBoardReader(announcementBoardFile, log) : null;
  // Read-only public APIs (server/publicApi.js, xinhai chain): room status, ping and the popup projection. The
  // schedule projection owns /api/announcement only when the installation explicitly runs the site-notice store;
  // otherwise the §45 managed-agent projection (server/announcement.js) keeps the path.
  const publicApi = createPublicApi({ lobby: health.lobby, announcements, trustProxy, sendJson, sendError,
    ownsAnnouncement: announcementScheduleApi, skinGate });
  // In-flight ordinary assets/runtime responses (SiderLock): an emergency trip releases them too, so a cold
  // visitor cannot retain its old streaming budget.
  const publicResponses = new Set();
  function track(res) {
    publicResponses.add(res);
    const done = () => { publicResponses.delete(res); res.off('finish', done); res.off('close', done); };
    res.once('finish', done); res.once('close', done);
  }
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, t('请求地址过长 · URI too long')); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, t('请求地址无效 · Bad request')); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    // The reserved OAuth seam (server/identity.js): no provider is wired on a plain installation, so every /auth/*
    // path answers 501 for any method instead of 404 HTML — clients and future providers can probe it without guessing.
    if (parts.rawPath === '/auth/' || parts.rawPath.startsWith('/auth/')) {
      sendJson(req, res, 501, { error: t('此安装未配置 OAuth 登录') });
      return;
    }
    // The public API router (server/publicApi.js) answers /api/ping, /api/rooms/… and the announcement
    // projections for any method — its own OPTIONS and 405 semantics come before the global GET/HEAD guard.
    if (await publicApi(req, res, parts.rawPath)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, t('不支持的请求方法 · Method not allowed'));
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      const report = healthReport(health, withTraffic);
      sendJson(req, res, report.ok ? 200 : 503, report);
      return;
    }
    if (parts.rawPath === '/client-build') {
      sendJson(req, res, 200, { build: health.browserBuild });
      return;
    }
    // The read-only maintenance-notice projection (server/announcement.js, Misyra chain): JSON only, never cached,
    // HEAD answers with headers but no body; other methods were rejected by the 405 guard above.
    if (parts.rawPath === '/api/announcement' && announcementReader) {
      const notice = await announcementReader();
      const delivery = announcementReader.delivery();
      sendJson(req, res, 200, { announcement: notice, serverTime: Date.now(), source: announcementSource,
        observedRevision: delivery.revision, observedAt: delivery.observedAt });
      return;
    }
    // Live operations snapshot (xinhai chain): the announcement poller's view plus the online counts.
    if (parts.rawPath === '/metrics') {
      sendJson(req, res, 200, { online: health.lobby?.onlineCount?.() ?? null, announcements: announcements?.stats?.() ?? null });
      return;
    }
    const protection = emergency();
    if (protection?.active && !isEmergencyShellPath(parts.rawPath)) {
      // Small JSON body with a bounded retry hint: the egress budget must go to the running matches.
      const seconds = protection.retryAt ? Math.max(1, Math.ceil((protection.retryAt - Date.now()) / 1000)) : 120;
      res.setHeader('Retry-After', String(seconds));
      res.setHeader('Connection', 'close');
      sendJson(req, res, 503, { error: parts.rawPath.startsWith(ASSET_CACHE_PREFIX)
        ? 'ASSET_CACHE_EMERGENCY' : 'SERVER_EMERGENCY', emergency: true, retryAfterSec: seconds });
      return;
    }
    track(res);
    // The explicit pre-cache fill API (SiderLock): its handler owns the limiter, catalog and streaming.
    if (parts.rawPath.startsWith(ASSET_CACHE_PREFIX)) {
      if (!assetCache) { sendJson(req, res, 503, { error: 'ASSET_CACHE_UNAVAILABLE' }); return; }
      await assetCache.serve(req, res, parts.rawPath, parts.query);
      return;
    }
    // The operator board file takes over this URL before the static handler sees data/announcements.json.
    if (readAnnouncementBoard && parts.rawPath.toLowerCase() === '/data/announcements.json') {
      sendJson(req, res, 200, await readAnnouncementBoard());
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  const listener = (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    // health is optional (an asset-cache-only handler builds none); the traffic meter needs the counter object
    if (health?.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, t('服务器内部错误 · Internal error'));
    });
  };
  /** Bandwidth protection (SiderLock): destroy the tracked in-flight public responses mid-stream. */
  listener.abortPublicRequests = () => {
    for (const res of publicResponses) res.destroy();
    publicResponses.clear();
  };
  return listener;
}
