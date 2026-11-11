// server/index.js — process boot; HTTP routes, static delivery and WebSocket wiring live in server/http/.
// Worker pools are process-owned loans to matches. Startup and shutdown keep diagnostics separate from readiness.
// Process-entry boot checks a pending update package before listening (server/update.js).
// The default dual-stack bind may fall back to IPv4; explicit hosts remain literal.
// Art under public/assets and public/fonts is served with content-hash URLs once the background index is ready
// (http/assetIndex.js, http/assetViews.js; SP_ASSET_INDEX=0: off); GET /healthz?traffic=1 adds the traffic counters
// (http/traffic.js) for a local client.
// The official versions (DESIGN §35.23, M1): the enabled ones (SP_VERSIONS / SP_VERSION_DEFAULT /
// SP_MAX_VERSION_HOSTS) get their own match hosts of kind 'version' and their data is served from /data/versions/.
// Plugins (DESIGN §32, docs/PLUGINS.md): the registry, the vanilla content hash, the visual and content sets, the room
// policy, the match hosts of rooms with gameplay plugins and the plugin studio are wired in startServer below
// (server/plugins/, server/match/host/, server/studio/); SP_CSP=off drops the site-wide Content-Security-Policy.

import http from 'node:http';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { getData, loadData } from './data.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom, assetOriginFrom, assetSourceFrom, versionsFrom, parseRoomCode, announcementBoardFileFrom } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS } from './http/static.js';
// The fork's static handler: the upstream one plus the runtime resource manifest (server/resources.js) and the
// browser-safe /sim/simdata.js. index.js is the only place that wires it, so the route is reachable in production.
import { createStaticHandler } from './http/customStatic.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createPackPolicy } from './pluginPolicy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { createVersionSets } from './versions.js';
import { versionById } from '../shared/versions.js';
// 内容管理 (docs/CONTENT-ADMIN.md): the runtime documents the panel writes. index.js reads the enabled set once here,
// which is why the panel says a change takes effect after a restart.
import { RUNTIME_DIR, VERSIONS_FILE, WILD_FILE, SKINS_FILE, registryIds, validateVersions } from './contentConfig.js';
import { createSkinGate } from './skinGate.js';
import { synthesizeWild } from './contentMerge.js';
import { t } from '../shared/i18n.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createAnnouncementReader } from './announcement.js';
import { announcementOptionsFrom } from './http/config.js';
import { bandwidthEmergencyOptions, createBandwidthEmergencyController } from './bandwidthEmergency.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createAssetCacheHandler } from './http/assetCache.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError } from './http/common.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';
import { CombatWorkerPool } from './match/combat/pool.js';
import { createRoomWorkerPool } from './workers/roomPool.js';
import { createHealthMetrics, serverLoadState, publicLoadDetails } from './healthMetrics.js';
import { createEventLoopMonitor } from './health/eventLoop.js';
import { resolveWsCompression } from './wsCompression.js';
import { createOnlineLimit } from './onlineLimit.js';
import { createOwnerFile } from './ownerFile.js';
import { parseSnapshotHz } from './match/fields.js';
import { getBotStrategy } from './match/botStrategies.js';
import { llmIntegrationEnabledNow, validateExternalConfig } from './match/llmGate.js';
import { createPersistence } from './persist/index.js';
import { Announcements } from './announcements.js';
import { sendSession } from './net.js';
import { mountPlayerAdmin } from './playerAdmin.js';
import { mountFeedbackBoard } from '../deploy/stardust/feedback/server.mjs';

export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/** Zero retains the synchronous backend; malformed pool configuration fails before listening. */
export function parseCombatWorkers(value) {
  if (value == null || value === '') return 0;
  if (typeof value !== 'number' && typeof value !== 'string') throw new RangeError('SP_COMBAT_WORKERS must be an integer from 0 to 32');
  const s = String(value).trim();
  if (!/^(0|[1-9]\d*)$/.test(s) || Number(s) > 32) throw new RangeError('SP_COMBAT_WORKERS must be an integer from 0 to 32');
  return Number(s);
}

export function parseTrialWorkers(value) {
  if (value == null || value === '') return 1;
  if (typeof value !== 'number' && typeof value !== 'string') throw new RangeError('SP_TRIAL_WORKERS must be an integer from 0 to 2');
  const s = String(value).trim();
  if (!/^[0-2]$/.test(s)) throw new RangeError('SP_TRIAL_WORKERS must be an integer from 0 to 2');
  return Number(s);
}

/**
 * The AI implementation selection (DESIGN §6.1, META §1.6): unset or empty is the original bot, anything else must
 * be a registered ID. Checking it here — before data loading or listening — is what turns a typo into a startup
 * diagnostic instead of a failure inside the first match. A dev checkout that selects the external host also needs
 * its transport configured; a release package has no host and maps the id back to the built-in bot (§35.66).
 */
export function validateBotStrategy(selection, envName = 'SP_BOT_STRATEGY') {
  if (selection == null || selection === '' || typeof selection === 'object') return selection;
  try {
    getBotStrategy(selection);
  } catch (e) {
    throw new Error(`Invalid ${envName}: ${e.message} Unset ${envName} to restore the default (legacy).`);
  }
  if (selection === 'external' && llmIntegrationEnabledNow) validateExternalConfig();
  return selection;
}

/**
 * First-boot announcement seed: copy each document only when its target is missing. An existing (even emptied)
 * file is never overwritten, so deleting the injected notice stays permanent across restarts.
 * @param {string} seedDir directory holding schedule.json / board.json
 * @param {(string|null)[]} targets resolved target paths
 * @param {object} log
 */
async function seedAnnouncementFiles(seedDir, targets, log) {
  const root = path.resolve(seedDir);
  for (const target of targets.filter(Boolean)) {
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, path.basename(target)), target, fsConstants.COPYFILE_EXCL);
      log.info(`[announcements] seeded ${target}`); // i18n-ignore: operator log
    } catch (e) {
      if (e.code === 'ENOENT') continue; // no seed for this document: nothing to inject
      if (e.code === 'EEXIST') continue; // target already exists: never re-seed
      log.warn(`[announcements] seed failed for ${target}: ${e.message}`); // i18n-ignore: operator log
    }
  }
}

/**
 * The panel's runtime documents (docs/CONTENT-ADMIN.md), read once at boot — which is why the panel says a change
 * takes effect after a restart. A missing file is the default (every registered version); an invalid one is reported
 * and ignored rather than refusing to start, because the panel can still fix it. `SP_VERSIONS` wins over the file, so
 * the enabled card is read-only when the environment decided the set.
 * @param {{ dir?: string, ids?: readonly string[], envEnabled?: boolean, log?: object }} o
 * @returns {Promise<{ versionsFile: string, wildFile: string, ids: readonly string[], envEnabled: boolean, enabled: string[]|null }>}
 */
export async function contentAdminOptions({ dir = RUNTIME_DIR, ids = registryIds(), envEnabled = false, log = console } = {}) {
  const versionsFile = path.join(dir, VERSIONS_FILE);
  const state = { versionsFile, wildFile: path.join(dir, WILD_FILE), skinsFile: path.join(dir, SKINS_FILE), ids, envEnabled, enabled: null };
  if (envEnabled) return state;
  try {
    const doc = JSON.parse(await readFile(versionsFile, 'utf8'));
    const errors = validateVersions(doc, ids);
    if (errors.length) log.warn(`[content] ${VERSIONS_FILE} ignored: ${errors.join('; ')}`); // i18n-ignore: operator log
    else state.enabled = [...doc.enabled];
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn(`[content] ${VERSIONS_FILE} unreadable: ${e.message}`); // i18n-ignore: operator log
  }
  return state;
}

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, emptyRoomMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object,
 * }} [opts]
 *   client: 'build' or 'source' — which page `/` is (default SP_CLIENT; http/static.js clientModeFromEnv);
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests);
 *   loopSample: overrides SP_LOOP_WINDOW_MS for the event-loop sampler (server/health/eventLoop.js; off unless
 *   SP_LOOP_SAMPLE=1)
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     eventLoop: ReturnType<typeof createEventLoopMonitor>, close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  // Validate operator options before starting any session/watch timers (SiderLock).
  const emergencyOptions = bandwidthEmergencyOptions(opts.bandwidthEmergency === false ? { enabled: false } : opts.bandwidthEmergency || {});
  const { port, host } = listenAddress(opts);
  const log = opts.log || makeLogger(!!opts.quiet);
  const wsCompression = resolveWsCompression(opts.wsCompression ?? process.env.SP_WS_COMPRESSION ?? 'off');
  const snapshotHz = parseSnapshotHz(opts.snapshotHz ?? process.env.SP_SNAPSHOT_HZ);
  const combatWorkers = parseCombatWorkers(opts.combatWorkers ?? process.env.SP_COMBAT_WORKERS);
  const trialSetting = opts.trialWorkers ?? process.env.SP_TRIAL_WORKERS;
  const requestedTrials = parseTrialWorkers(trialSetting);
  const trialWorkers = combatWorkers && (trialSetting != null && trialSetting !== '' || String(process.env.SP_COMBAT || '').toLowerCase() === 'server')
    ? requestedTrials : 0;
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // The AI implementation the matches use (DESIGN §6.1, META §1.6): the operator selection is checked here, before
  // any data is read or a port is opened, so a typo stops the boot with a diagnostic instead of failing in the
  // first match.
  validateBotStrategy(opts.botStrategy ?? process.env.SP_BOT_STRATEGY);

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const combatPool = combatWorkers ? new CombatWorkerPool({ size: combatWorkers, data, log }) : null;
  // The simulation pool the bot rehearsals are submitted to (server/workers/roomPool.js). This fork derives its size
  // from the CPU count, so it exists unless SP_WORKERS says the explicit 0; SP_ROOM_WORKERS splits it into lanes.
  const simPool = createRoomWorkerPool({ data });
  let trialPool = null, trialStartupFailed = false, healthMetrics = null;
  const closePools = () => Promise.all([trialPool?.close(), combatPool?.close(), simPool?.close()]);
  if (combatPool) {
    try { await combatPool.start(); } catch (e) { await closePools(); throw e; }
    log.info(`[combat] fixed worker pool ready (${combatWorkers} workers; server streaming only)`);
  }
  if (trialWorkers) {
    try {
      trialPool = new CombatWorkerPool({ role: 'trial', size: trialWorkers, data, log });
      await trialPool.start();
      log.info(`[trial] dedicated rehearsal pool ready (${trialWorkers} workers)`);
    } catch (e) {
      try { await trialPool?.close(); } catch (closeError) { await combatPool?.close(); throw closeError; }
      trialPool = null;
      trialStartupFailed = true;
      log.warn?.(`[trial] worker startup failed; rehearsal stays inline: ${e.message}`);
    }
  }
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  let registry, lobby, network, packs, serveStatic, browserBuild, assetIndex = null, views = null, assetCache = null;
  let content = null, visual = null, contents = null, hosts = null, studio = null, trustedRuntime = null, persistence = null, contentAdmin = null;
  let versions = null, versionHosts = null, packPolicy = null;
  let announcementReader = null, announcementSource = null;
  // Admin-published site notices (xinhai chain) and the private player-management dashboard; both optional.
  // The players' feedback board is optional too and shares the dashboard's session for its admin API.
  let announcements = null, playerAdmin = null, feedbackBoard = null, skinGate = null;
  const announcementFile = opts.announcementsFile === null ? null
    : path.resolve(ROOT, opts.announcementsFile || process.env.SP_ANNOUNCEMENTS_FILE || 'config/announcements.json');
  // The lobby board lives outside the image when the installation names a file; the shipped data file stays the default.
  const announcementBoardFile = announcementBoardFileFrom(opts);
  const announcementSeedDir = opts.announcementSeedDir ?? process.env.SP_ANNOUNCEMENT_SEED_DIR ?? null;
  const startedAt = Date.now();
  // The online cap and the lobby's room / AI caps (server/onlineLimit.js): a JSON file re-read while the server runs; none = no cap.
  const onlineLimit = createOnlineLimit({ file: opts.onlineLimitFile ?? process.env.SP_ONLINE_LIMIT_FILE ?? null, log });
  // The owner (服主) mark (server/ownerFile.js): the owner key's hash and reserved names, re-read while the server runs; none = off.
  const ownerFile = createOwnerFile({ file: opts.ownerFile ?? process.env.SP_OWNER_FILE ?? null, log });
  await ownerFile.refresh(); // the first read before any hello: reserved names hold from the start (never rejects)
  try {
    // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
    // like the data the matches use and the build tag below
    content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
    log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
    // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
    // whenever their folders change
    // the admin's runtime pack switches (server/pluginPolicy.js): paid entries default to disabled — the fork must not
    // hand paid content to players (NOTICE.md); the persisted state is restored by playerAdmin.start() below
    packPolicy = createPackPolicy({ paid: opts.paidPacks || [], log });
    packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost: host, scriptMode, policy: packPolicy });
    packs.refresh(true);
    // the content hashes of the art (built in the background once listening) and the manifests served with them
    const indexOptions = assetIndexOptionsFrom(opts, publicDir);
    assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
    views = createManifestViews({ dataDir, index: assetIndex, log });
    // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
    visual = createVisualSets({ registry: packs, log });
    // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
    // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
    const policy = createPluginPolicy({ pluginsDir, log });
    contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
    const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
    // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
    // an out-of-memory abort in a worker thread ends the whole server)
    const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
    hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
    // the official versions (DESIGN §35.23, M1): which ones (the option, else SP_VERSIONS …), their content, and — only
    // when one beyond 第二期下半 is enabled — the match hosts their rooms play in (counted apart from the plugin hosts)
    // 内容管理 (docs/CONTENT-ADMIN.md): the panel's runtime file decides the set when neither the option nor the
    // environment already did. versionsFrom gives the option priority, so nothing is passed when SP_VERSIONS is set.
    contentAdmin = await contentAdminOptions({ envEnabled: String(process.env.SP_VERSIONS ?? '').trim() !== '', log });
    // 狂野模式 (docs/CONTENT-ADMIN.md §5): runtime/wild.json is synthesized into data/versions/wild/ at boot. No file
    // means no wild set; an unresolvable reference refuses the boot instead of serving half a data set.
    const wild = await synthesizeWild({ log });
    if (wild && !wild.ok) throw new Error(`[content] wild ${t('合成失败')}: ${wild.errors.join('; ')}`); // i18n-ignore: operator log
    const runtimeEnabled = contentAdmin.enabled && !(opts.versions && opts.versions.enabled);
    const versionCfg = versionsFrom(runtimeEnabled ? { ...opts, versions: { ...(opts.versions || {}), enabled: contentAdmin.enabled } } : opts, log);
    versions = createVersionSets({ enabled: versionCfg.enabled, defaultId: versionCfg.default, dataDir, vanilla: content, defaultData: data, log });
    // (the test options of matchHost apply to both pools, but never the version pool's kind or its own SP_MAX_VERSION_HOSTS)
    versionHosts = versions.nonDefault.length
      ? createMatchHosts({ contents: versions, log, options: { transport, ...(opts.matchHost || {}), kind: 'version', maxWorkers: Math.max(1, versionCfg.maxHosts) } })
      : null;
    log.info(`[versions] enabled: ${versions.ids.map((id) => `${id} (${t(/** @type {any} */ (versionById(id)).label)}${id === versions.defaultId ? ', default' : ''})`).join(', ')}`);
    ({ registry, lobby, network } = createSessionStack({ ...opts, snapshotHz }, {
      data, log, combatPool, trialPool, simPool, onlineLimit, ownerFile, content, plugins: roomSets, hosts, versions, versionHosts,
      getLoadState: () => serverLoadState(healthMetrics?.snapshot?.()),
      getLoadDetails: () => publicLoadDetails(healthMetrics?.snapshot?.()),
    }));
    const assetSource = assetSourceFrom(opts);
    serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, metrics: opts.phaseMetrics,
      assetIndex, views, visual, contents, versions, assetOrigin: assetSource.origin, assetDisabled: assetSource.disabled,
      ...(opts.client ? { client: opts.client } : {}) });
    // the explicit pre-cache fill API (SiderLock): one limiter for filling and manual catalog updates; the admission
    // flag follows the lobby's runtime owner policy (requireAssetCache, off by default — every client admitted)
    assetCache = createAssetCacheHandler({ publicDir, dataDir, log, limits: opts.assetCacheLimits, trustProxy: network.opts.trustProxy,
      buildCatalog: opts.assetCacheBuildCatalog, requireAssetCache: () => lobby.requireAssetCache });
    // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
    // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
    studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch,
      // the console's login is the studio's other door (server/studio/index.js): read at request time, after the console mounts
      isAdmin: (req) => !!playerAdmin?.admin?.session?.(req) });
    trustedRuntime = await createTrustedRuntime({ registry: packs, log });
    lobby.trustedRuntime = trustedRuntime;
    // the served official versions' data counts in the tag only for the ones this instance serves (DESIGN §35.23)
    browserBuild = computeBuildTag(ROOT, { publicDir, servedVersionDirs: versions.servedDirs() });
    // checkpoints (SP_REDIS_URL, server/persist/): the saved lobby and its matches come back before the server listens
    persistence = await createPersistence({ opts, registry, lobby, log });
    // the optional first-boot seed runs before any reader: an existing (even emptied) file is never rewritten
    if (announcementSeedDir) await seedAnnouncementFiles(announcementSeedDir, [announcementFile, announcementBoardFile], log);
    // site notices (server/announcements.js): poll config/announcements.json and push `site.announcement` frames
    announcements = announcementFile === null ? null : new Announcements({ file: announcementFile, pollMs: opts.announcementPollMs,
      broadcast: (msg) => network.broadcast(msg), log });
    await announcements?.start();
    // hello replay: a fresh (or reconnecting) session gets the current frame right after `welcome` — before any match
    // state pushes, so title screens and in-room clients always hold the live notice (test/announcements.test.js).
    if (announcements && typeof lobby.onHello === 'function') {
      const lobbyOnHello = lobby.onHello.bind(lobby);
      lobby.onHello = (session, info) => {
        try { sendSession(session, announcements.message()); } catch (e) { log.error('[announcements] hello replay failed', e); }
        lobbyOnHello(session, info);
      };
    }
    // the maintenance-notice projection (/api/announcement, Misyra chain): local file, feed URL or panel source
    const announcementOpts = announcementOptionsFrom(opts);
    announcementSource = announcementOpts.source;
    announcementReader = createAnnouncementReader({ filePath: announcementOpts.filePath, announcementUrl: announcementOpts.announcementUrl,
      pollMs: announcementOpts.pollMs, log });
    // 皮肤管理 (docs/CONTENT-ADMIN.md §9): runtime/skins.json decides which skins players may use. Read once here — the
    // panel says a change takes effect after a restart — and installed into shared/skins.js, where one judgement covers
    // the operator's appearance, the card's portrait, its background and the operator picker. The persisted sessions are
    // cleaned now, the one moment nothing races them; a player whose choice changed is told at the next login by the
    // client, which applies the same gate to its own stored choice (the browser is the true source).
    skinGate = createSkinGate({ entries: packs.snapshot().plugins });
    let skinReset = 0;
    for (const s of registry.byPlayerId.values()) skinReset += skinGate.cleanSession(s)?.size ?? 0;
    if (skinReset) log.info(`[skins] ${skinReset} denied skin choice(s) restored to the default appearance`); // i18n-ignore: operator log
  } catch (e) {
    await persistence?.close();
    await announcements?.stop();
    network?.close();
    lobby?.shutdown('boot-failed');
    try { hosts?.close(); } catch { /* boot already failed */ }
    try { versionHosts?.close(); } catch { /* boot already failed */ }
    studio?.close();
    await trustedRuntime?.close();
    onlineLimit.close();
    ownerFile.close();
    assetIndex?.close();
    assetCache?.close();
    await closePools();
    throw e;
  }
  const traffic = createTrafficCounter();
  // The event-loop sampler (server/health/eventLoop.js, ARCHITECTURE §workers): off by default, SP_LOOP_SAMPLE=1 turns
  // it on, and it needs no worker pool. It writes a local window line only — deliberately not part of /healthz — with
  // the hall counts the operator reads to tell a rehearsal stall from a battle slice.
  const hallCounts = () => {
    let humans = 0, spectators = 0, matches = 0, rehearsals = 0, phase = 'idle';
    for (const room of lobby.rooms.values()) {
      humans += (room.seats ?? []).filter((s) => s && !s.isBot && !s.left).length;
      spectators += (room.spectators ?? []).length;
      const match = room.match;
      if (!match) continue;
      matches++;
      if (phase === 'idle') phase = match.phase ?? 'idle';
      rehearsals += match._rehearsalTasks?.size ?? 0;
    }
    return { rooms: lobby.rooms.size, humans, matches, spectators, phase, rehearsals };
  };
  const eventLoop = createEventLoopMonitor({ log, counts: hallCounts, ...(opts.loopSample?.windowMs ? { windowMs: opts.loopSample.windowMs } : {}) });
  eventLoop?.start();
  // Bandwidth protection (SiderLock server/bandwidthEmergency.js): the detector polls cache-demand and game
  // congestion evidence; transitions are applied here — freeze the lobby + network, cut bulk HTTP, notify.
  let requestHandler;
  const bandwidthEmergency = createBandwidthEmergencyController({
    ...(opts.bandwidthEmergency || {}), ...emergencyOptions,
    getMetrics: () => assetCache.metrics(),
    getCongestion: () => network.congestion(),
    canResume: () => [...lobby.rooms.values()].every((room) => !room.match || room.activeHumans().some((seat) => seat.connected)),
    log,
    onChange: (state) => {
      if (state.active) {
        // Filling trips first: a catalog download mid-flight must not outlive the protection window.
        assetCache.trip(state.reason);
        requestHandler?.abortPublicRequests();
        // `finish` only means handed to TCP, not delivered. Close ordinary HTTP sockets too, including finished
        // keep-alive transfers; Node deliberately excludes upgraded WebSockets.
        server.closeAllConnections?.();
      } else assetCache.resume();
      network.setEmergency(state);
      lobby.setEmergency(state);
      log.warn(`[bandwidth-emergency] ${state.active ? 'protection on: bulk downloads cut, matches frozen'
        : 'attempting to restore visits and matches'} (${state.reason || 'recovery'})`);
    },
  });
  const health = { startedAt, network, registry, lobby, content, browserBuild, combatPool, trialPool, simPool, trialStartupFailed,
    getHealthMetrics: () => healthMetrics, traffic, assetIndex, views, trusted: trustedRuntime?.health, versions, versionHosts, bandwidthEmergency,
    persistence: persistence ? () => persistence.snapshot() : null };
  requestHandler = createRequestHandler({ serveStatic, assetCache, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir), health, log,
    trustProxy: network.opts.trustProxy, studio, trustedRuntime, emergency: () => network.emergency, announcementReader, announcementSource, announcements, announcementBoardFile,
    // An explicit site-notice store opts the installation into the public schedule projection on /api/announcement
    // (server/publicApi.js); the default keeps the §45 managed-agent projection there.
    announcementScheduleApi: opts.announcementsFile != null, skinGate });
  const server = http.createServer(requestHandler);
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, wsCompression, traffic });
  // the private admin dashboard (/admin): mounts nothing when config/player-admin/config.json is absent;
  // `adminConfigFile: null` skips the mount entirely (tests), a path relocates the credentials file.
  playerAdmin = opts.adminConfigFile === null ? null : await mountPlayerAdmin({ server, network, lobby, registry, packs, policy: packPolicy,
    // 重启 (the panel's button): the same graceful close as SIGTERM, then exit — the supervisor restarts this process,
    // which re-reads runtime configuration. A process nobody supervises stays down; playerAdmin asks for confirmation.
    restart: async () => { await close(); process.exit(0); },
    ...(opts.adminConfigFile ? { configFile: path.resolve(ROOT, opts.adminConfigFile) } : {}), announcementFile, publicDir, content: contentAdmin, log });

  // The players' feedback board (deploy/stardust/feedback) under the /feedback prefix, so the board link in the game
  // page works without a second service or nginx. It needs the site origin the browser sends; without one the board
  // stays off rather than answering with an unchecked origin. The SQLite file goes to the state directory: the image's
  // data/ is root-owned while the process runs as node, and .state/ is already writable.
  if (opts.feedbackBoard !== null) {
    const origin = process.env.FEEDBACK_ORIGIN || playerAdmin?.admin?.config.publicOrigin || null;
    // A board nothing was configured for is simply off: the boot log stays as it was before the board existed.
    // Only a deploy that asked for the board (an option or one of its env vars) is worth a warning when its
    // origin is missing.
    if (!origin) {
      if (opts.feedbackBoard || process.env.FEEDBACK_DB || process.env.FEEDBACK_BACKUP_DIR)
        log.warn('[feedback] disabled: no origin to check (set FEEDBACK_ORIGIN)');
    } else {
      try {
        feedbackBoard = mountFeedbackBoard({ server, admin: playerAdmin?.admin ?? null,
          db: process.env.FEEDBACK_DB ? path.resolve(ROOT, process.env.FEEDBACK_DB) : path.join(ROOT, '.state', 'feedback.sqlite'),
          origin, backupDir: process.env.FEEDBACK_BACKUP_DIR || null, trustProxy: network.opts.trustProxy, log });
        log.info(`[feedback] mounted on /feedback: ${feedbackBoard.store.visibleCount()} visible items`);
      } catch (e) { log.error('[feedback] disabled: ' + e.message); }
    }
  }

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    const testGate = lobby.setTestHost(scriptHost);
    if (testGate.warn) log.warn(`[test-mode] ${testGate.warn}`);
    else if (testGate.enabled) log.info('[test-mode] test rooms enabled');
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    await feedbackBoard?.close();
    await playerAdmin?.close();
    await announcements?.stop();
    await persistence?.close();
    network.close();
    lobby.shutdown('boot-failed');
    onlineLimit.close();
    ownerFile.close();
    assetIndex?.close();
    assetCache?.close();
    try { hosts?.close(); } catch { /* boot already failed */ }
    studio?.close();
    await trustedRuntime?.close();
    await closePools();
    throw e;
  }
  server.on('error', e => log.error('[http] server error', e));
  assetIndex?.start();
  bandwidthEmergency.start();
  try {
    healthMetrics = (opts.healthMetricsFactory ?? createHealthMetrics)(opts.phaseMetrics ? { log, phases: opts.phaseMetrics } : { log });
    healthMetrics.start();
  } catch (e) {
    try { healthMetrics?.dispose(); } catch { /* diagnostic only */ }
    healthMetrics = null;
    try { log.warn?.(`[health] performance metrics unavailable: ${e.message}`); } catch { /* diagnostic only */ }
  }
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;
  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try { eventLoop?.close(); } catch { /* diagnostic only */ }
      try { healthMetrics?.dispose(); } catch (e) {
        try { log.warn?.('[health] performance disposal failed', e); } catch { /* diagnostic only */ }
      }
      // the last checkpoints first: then the rooms close quietly, their players are coming back (server/persist/)
      try { await persistence?.shutdown(); } catch (e) { log.error('[shutdown] checkpoints', e); }
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      try { versionHosts?.close(); } catch (e) { log.error('[shutdown] version hosts', e); }
      await feedbackBoard?.close();
      await playerAdmin?.close();
      await announcements?.stop();
      network.close();
      bandwidthEmergency.close();
      onlineLimit.close();
      ownerFile.close();
      assetIndex?.close();
      assetCache?.close();
      studio?.close();
      await trustedRuntime?.close();
      await closePools();
      await new Promise(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
      await persistence?.close();
    })();
    return closing;
  }
  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, versions, versionHosts,
    combatPool, trialPool, simPool, healthMetrics, eventLoop, traffic, assetIndex, assetCache, views, studio, persistence, bandwidthEmergency, announcements, playerAdmin, feedbackBoard, close };
}

/**
 * The `--room-code ABCD` / `--room-code=ABCD` argument of this process entry, or null when it is absent. The value is
 * read once at startup and lives only in this server instance: there is no environment variable and nothing is
 * persisted, so stopping the server and starting it again without the argument is random again. A missing or invalid
 * value throws (the boot helper reports it and exits) instead of silently starting random.
 * @param {string[]} [argv]
 * @returns {string | null}
 */
export function roomCodeFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--room-code') {
      const v = argv[i + 1];
      if (v == null || v.startsWith('-') || !v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
    if (a.startsWith('--room-code=')) {
      const v = a.slice('--room-code='.length);
      if (!v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
  }
  return null;
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(() => startServer({ roomCode: roomCodeFromArgv() }));
