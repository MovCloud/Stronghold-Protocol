// Private player management. No session tokens, browser IDs or credential hashes leave this module.
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { clientAddress, isLocalIp, TokenBucket } from './net.js';
import { parseAnnouncements, activeAnnouncement } from '../shared/announcements.js';
import { ANNOUNCEMENT_MAX_BYTES } from './announcements.js';
import { ARCADE_ADMIN_MODES } from '../shared/constants.js';
import { isPluginId } from '../shared/plugins/manifest.js';
import { t } from '../shared/i18n.js';
import { buildCatalog, filterRows, tableStats, wildView } from './contentCatalog.js';
import { defaultVersions, defaultWild, defaultSkins, presetPatch, versionsMutation, wildMutation, skinsMutation } from './contentConfig.js';
import { skinGroups, packSkins } from './skinGate.js';
import { mergeWild } from './contentMerge.js';
import { getVersionData } from './data.js';

const derive = promisify(scrypt);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 8 * 60 * 60 * 1000;
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const id = () => randomBytes(16).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
/**
 * Whether something outside this process starts it again after it exits: the image's CMD makes node PID 1, and a unit
 * file or wrapper can set SP_SUPERVISED=1. Without one a 重启 stops the server for good, so the panel warns first.
 */
export function restartSupervised({ pid = process.pid, env = process.env } = {}) {
  return pid === 1 || /^(?:1|true|yes)$/i.test(String(env.SP_SUPERVISED ?? ''));
}
/** Endpoints handled inside handle() itself; plugin registrations may not shadow them. */
const BUILT_IN_ADMIN_ROUTES = new Set(['/admin/api/login', '/admin/api/session', '/admin/api/snapshot', '/admin/api/announcements',
  '/admin/api/announcement', '/admin/api/announcement/stop', '/admin/api/announcement/delete', '/admin/api/maintenance',
  '/admin/api/restart', '/admin/api/packs', '/admin/api/password', '/admin/api/logout', '/admin/api/kick', '/admin/api/ban',
  '/admin/api/unban', '/admin/api/content/versions', '/admin/api/content/wild', '/admin/api/content/skins']);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanText = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail(400, `${label}格式无效`);
  return value.trim();
};

export async function credentials(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 128) throw fail(400, '管理密码需要 12–128 字节');
  const salt = randomBytes(16).toString('hex');
  return { salt, passwordHash: (await derive(password, salt, 32)).toString('hex') };
}

export async function atomicJson(file, doc, expected) {
  const data = JSON.stringify(doc, null, 2) + '\n';
  if (Buffer.byteLength(data) > FILE_MAX_BYTES) throw fail(409, '管理记录容量已达上限，请先整理过期记录');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${id()}.tmp`;
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close(); handle = null;
    if (expected !== undefined && await readFile(file, 'utf8') !== expected) throw fail(409, '配置已被其他操作修改，请刷新后再试');
    for (let attempt = 0; ; attempt++) {
      try { await rename(tmp, file); break; }
      catch (e) {
        // Windows may briefly deny replacing a file while the announcement poller reads it.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 4) throw e;
        await wait(20 * (attempt + 1));
        if (expected !== undefined && await readFile(file, 'utf8') !== expected) throw fail(409, '配置已被其他操作修改，请刷新后再试');
      }
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(tmp).catch(() => {});
  }
}

async function jsonFile(file, missing) {
  try {
    const handle = await open(file, 'r');
    try {
      if ((await handle.stat()).size > FILE_MAX_BYTES) throw new Error('management file too large');
      const raw = await handle.readFile('utf8');
      return { doc: JSON.parse(raw), raw };
    } finally { await handle.close(); }
  } catch (e) { if (e.code === 'ENOENT' && missing !== undefined) return { doc: missing, raw: undefined }; throw e; }
}

function validateConfig(config) {
  if (!config || config.version !== 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(config.username)
      || !/^[a-f0-9]{32}$/.test(config.salt) || !/^[a-f0-9]{64}$/.test(config.passwordHash)) throw new Error('invalid admin credentials');
  const url = new URL(config.publicOrigin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== config.publicOrigin) throw new Error('invalid admin origin');
  // HTTPS, or an origin whose host is a loopback name / an IP literal: an install without TLS in front (a bare
  // `docker run` reached by its public IP) is allowed, and its session cookie is then not `Secure`.
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !isIP(url.hostname)) throw new Error('admin origin requires HTTPS');
  return { ...config, secureCookie: url.protocol === 'https:' };
}

/** Snapshot reads published match state; it never asks the simulation to compute a new view. */
export function playerSnapshot({ network, lobby, registry, now = Date.now() }) {
  const pubByCtx = new Map();
  const pubOf = (ctx) => {
    if (!pubByCtx.has(ctx)) {
      try { pubByCtx.set(ctx, ctx.lastPublic ? JSON.parse(ctx.lastPublic) : null); } catch { pubByCtx.set(ctx, null); }
    }
    return pubByCtx.get(ctx);
  };
  const players = [];
  for (const session of registry.all()) {
    const room = lobby.roomOf(session);
    const ctx = room?.matchCtx || null; // the room's live match (server/lobby.js Room.matchCtx)
    const queue = lobby.queueByPlayer.get(session.playerId) || null;
    if (!session.connected && !room && !ctx && !queue) continue;
    const pub = ctx ? pubOf(ctx) : null;
    const ps = ctx?.match?.players?.get(session.playerId);
    const published = pub?.players?.find(p => p.playerId === session.playerId);
    const spectator = !!room?.spectatorOf(session.playerId) || !!ctx?.match?.spectators?.has(session.playerId);
    const active = !!ctx && !ctx.ended && !ctx.disposed && !['LOBBY', 'RESULT'].includes(pub?.phase || ctx.match?.phase);
    const conn = session.ws && network.conns.get(session.ws);
    const connected = !!session.connected && !!conn && !conn.closing && conn.ws.readyState === 1 && conn.session === session;
    const status = !connected ? 'disconnected' : spectator ? 'spectating' : active ? 'playing' : queue ? 'matching' : room ? 'waiting' : 'lobby';
    players.push({ playerId: session.playerId, name: session.name, connected, status, spectator,
      playing: active && !spectator && !ps?.left, roomCode: room?.code || null, matchId: ctx?.match?.roomCode || null,
      mode: room?.mode || ctx?.match?.mode || queue?.mode || null,
      difficulty: room?.difficulty || ctx?.match?.difficulty || queue?.difficulty || null,
      phase: pub?.phase || ctx?.match?.phase || null, round: pub?.round ?? ctx?.match?.round ?? null,
      lastRound: pub?.lastRound ?? null, lp: published?.lp ?? ps?.lp ?? null, alive: published?.alive ?? ps?.alive ?? null,
      autoplay: !!ps?.autoplay, isHost: room?.hostId === session.playerId,
      ip: session.addr || null, canBanIp: !!isIP(session.addr) && !isLocalIp(session.addr),
      lastSeen: session.lastSeen, disconnectedAt: session.disconnectedAt,
      browserGroup: session.adminBrowserHash?.slice(0, 10) || null,
    });
  }
  players.sort((a, b) => Number(b.playing) - Number(a.playing) || Number(b.connected) - Number(a.connected) || a.playerId.localeCompare(b.playerId));
  /**
   * Match lifecycle per room — the view a player report needs: single vs multiplayer, who owns the room, which code
   * to hand out, and how long it has been open. The admin's spectate entry is the client's `?room=CODE` deep link
   * (public/js/screens/lobby.js joinRoom), which offers the spectator seat once the match has started.
   */
  const matches = [...lobby.rooms.values()].map((room) => {
    const pub = room.matchCtx ? pubOf(room.matchCtx) : null;
    return { roomCode: room.code, mode: room.mode, difficulty: room.difficulty, source: room.source,
      hostId: room.hostId, hostName: registry.byId(room.hostId)?.name || null,
      inMatch: !!room.match, phase: pub?.phase || room.match?.phase || null, round: pub?.round ?? null,
      played: room.matchCount, humans: room.activeHumans().length,
      bots: room.seats.filter((s) => s?.isBot && !s.left).length, capacity: room.capacity,
      spectators: room.spectators.length, queued: lobby.roomQueued(room),
      createdAt: room.createdAt, disposed: room.disposed };
  });
  matches.sort((a, b) => Number(b.inMatch) - Number(a.inMatch) || b.createdAt - a.createdAt);
  return { serverNow: typeof now === 'function' ? now() : now, stats: { onlineBrowsers: network.onlineCount, connectedPlayers: players.filter(p => p.connected).length,
    playingPlayers: players.filter(p => p.playing).length, disconnectedPlayers: players.filter(p => !p.connected).length,
    ...lobby.stats() }, players, matches: matches.slice(0, 200), matchTotal: matches.length };
}

export class PlayerAdmin {
  constructor({ network, lobby, registry, config, configFile, announcementFile, publicDir, packs = null, policy = null, restart = null, content = null, now = Date.now, log = console }) {
    Object.assign(this, { network, lobby, registry, config: validateConfig(config), configFile, announcementFile, publicDir, packs, policy, restart, content, now, log });
    this.directory = path.dirname(configFile);
    this.stateFile = path.join(this.directory, 'state.json');
    this.state = { version: 1, bans: [], audit: [] };
    this.sessions = new Map();
    this.loginBuckets = new Map();
    this.routes = new Map();
    this.authBusy = 0;
    this.writes = Promise.resolve();
    this.closed = false;
  }

  async start() {
    const { doc } = await jsonFile(this.stateFile, this.state);
    if (doc?.version !== 1 || !Array.isArray(doc.bans) || !Array.isArray(doc.audit) || doc.bans.length > 2000 || doc.audit.length > 1000
        || doc.bans.some(b => !b || typeof b.id !== 'string' || !Array.isArray(b.keys) || !b.keys.every(k => /^[btp]:[a-f0-9]{64}$/.test(k))
          || !Array.isArray(b.scopes) || !Number.isFinite(b.createdAt) || !Number.isFinite(b.expiresAt))
        || (doc.packs !== undefined && (typeof doc.packs !== 'object' || Array.isArray(doc.packs)
          || Object.entries(doc.packs).some(([k, v]) => !isPluginId(k) || typeof v !== 'boolean')))) throw new Error('invalid admin state');
    this.state = doc;
    this.reindex();
    // 娱乐模式 (arcade): the admin panel's persisted per-mode switches apply before the server starts accepting rooms;
    // a missing key keeps the lobby's default (open).
    if (doc.arcade && typeof doc.arcade === 'object') {
      for (const mode of ARCADE_ADMIN_MODES) {
        if (typeof doc.arcade[mode.id] === 'boolean') this.lobby.setArcadeMode(mode.id, doc.arcade[mode.id]);
      }
    }
    // 资源包 (packs): the admin panel's persisted switches apply before the first catalogue is served
    // (server/pluginPolicy.js); a missing key keeps the default (paid → disabled, everything else → enabled).
    if (doc.packs && typeof doc.packs === 'object' && !Array.isArray(doc.packs) && this.policy) {
      for (const [packId, on] of Object.entries(doc.packs)) if (isPluginId(packId) && typeof on === 'boolean') this.policy.set(packId, on);
    }
    for (const conn of this.network.conns.values()) if (conn.session) this.remember(conn.session, conn);
    await this.seedAnnouncements();
    if (this.network.moderation) throw new Error('moderation is already configured');
    this.network.moderation = this;
  }

  /** First-boot convenience: once, mirror the shipped announcement-board entries (data/announcements.json) into the
   * popup store so a fresh installation finds its notices in the admin panel. `announceSeeded` keeps a later
   * deletion permanent across restarts; the seeded rows never auto-popup and stay panel-only until edited. */
  async seedAnnouncements() {
    const { doc } = await jsonFile(this.announcementFile, null);
    if (this.state.announceSeeded || doc?.announcements?.length) return;
    let board = [];
    try {
      const parsed = JSON.parse(await readFile(path.join(ROOT, 'data', 'announcements.json'), 'utf8'));
      board = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.announcements) ? parsed.announcements : [];
    } catch { /* no shipped board: nothing to seed */ }
    const rows = board.map((n, i) => {
      if (!n || typeof n.title !== 'string' || !n.title.trim()) return null;
      const paragraphs = Array.isArray(n.paragraphs) ? n.paragraphs.filter(p => typeof p === 'string' && p.trim()) : [];
      const text = [typeof n.date === 'string' ? n.date.trim() : '', ...paragraphs].filter(Boolean).join('\n\n').slice(0, 16000);
      return text ? { id: `board-${i + 1}`, type: 'popup', title: n.title.trim().slice(0, 80),
        text, level: 'info', autoPopup: false, enabled: true } : null;
    }).filter(Boolean).slice(0, 100);
    if (rows.length) await atomicJson(this.announcementFile, { announcements: rows });
    await this.commit({ ...this.state, announceSeeded: true }, { action: 'seedAnnouncements', announcementIds: rows.map(n => n.id) });
  }

  /** Plugin hook (DESIGN §32 spirit): extra admin API endpoints. `permission` is recorded now and enforced once the
   * Identity providers land (server/identity.js); until then every logged-in admin may call the route.
   * `method` is GET or POST; the handler receives (body, query) — body is undefined on a GET, query is the URLSearchParams. */
  registerAdminRoute(pathname, { permission = 'admin', method = 'POST', handler } = {}) {
    if (typeof pathname !== 'string' || !/^\/admin\/api\/[A-Za-z0-9/_-]{1,64}$/.test(pathname) || pathname.endsWith('/')) {
      throw new Error(`invalid admin route ${pathname}`);
    }
    if (BUILT_IN_ADMIN_ROUTES.has(pathname) || this.routes.has(pathname)) throw new Error(`admin route already exists: ${pathname}`);
    if (typeof permission !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(permission)) throw new Error('admin route permission must be 1..32 letters, numbers, _ or -');
    if (method !== 'GET' && method !== 'POST') throw new Error('admin route method must be GET or POST');
    if (typeof handler !== 'function') throw new Error('admin route handler required');
    this.routes.set(pathname, { permission, method, handler });
  }

  remember(session, conn) {
    if (conn.browserId && /^[a-f0-9]{32}$/.test(conn.browserId)) session.adminBrowserHash = hash(conn.browserId);
  }

  reindex() {
    this.banIndex = new Map();
    for (const ban of this.state.bans) {
      if (ban.revokedAt || (ban.expiresAt && ban.expiresAt <= this.now())) continue;
      for (const key of ban.keys) {
        const prev = this.banIndex.get(key);
        if (!prev || !ban.expiresAt || (prev.expiresAt && ban.expiresAt > prev.expiresAt)) this.banIndex.set(key, ban);
      }
    }
  }

  blocked(conn, msg) {
    const session = conn.session || (msg.token && this.registry.byToken(msg.token));
    const browserHash = msg.browserId ? hash(msg.browserId) : session?.adminBrowserHash;
    const keys = [browserHash && 'b:' + browserHash, (msg.token || session?.token) && 't:' + hash(msg.token || session.token), conn.ip && 'p:' + hash(conn.ip)];
    for (const key of keys) {
      const ban = key && this.banIndex.get(key);
      if (ban && !ban.revokedAt && (!ban.expiresAt || ban.expiresAt > this.now())) return true;
    }
    return false;
  }

  cookieName() { return this.config.secureCookie ? '__Secure-sp_player_admin' : 'sp_player_admin'; }
  cookie(req) {
    const entries = String(req.headers.cookie || '').split(';').map(s => s.trim().split('='));
    const matches = entries.filter(([key]) => key === this.cookieName());
    return matches.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(matches[0][1] || '') ? matches[0][1] : null;
  }
  session(req) {
    const token = this.cookie(req);
    const row = token && this.sessions.get(hash(token));
    if (!row || row.expiresAt <= this.now()) { if (token) this.sessions.delete(hash(token)); return null; }
    return row;
  }
  setCookie(res, value, seconds) {
    // Path=/ (not /admin/): the plugin studio reads this same login as its other door (server/studio/index.js). HttpOnly and
    // SameSite=Strict still keep it away from scripts and from another site's pages; only same-origin requests carry it.
    res.setHeader('Set-Cookie', `${this.cookieName()}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.config.secureCookie ? '; Secure' : ''}`);
  }
  headers(res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  json(req, res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  async body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请使用 JSON 请求');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw fail(413, '请求内容过大'); chunks.push(chunk); }
    try { const doc = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(); return doc; }
    catch { throw fail(400, 'JSON 格式无效'); }
  }
  verifyOrigin(req) { if (req.headers.origin !== this.config.publicOrigin) throw fail(403, '请求来源无效'); }
  async verifyPassword(password) {
    if (typeof password !== 'string' || Buffer.byteLength(password) > 128) return false;
    const key = await derive(password, this.config.salt, 32);
    return timingSafeEqual(key, Buffer.from(this.config.passwordHash, 'hex'));
  }
  async login(req, res) {
    const at = this.now();
    for (const [key, row] of this.loginBuckets) if (at - row.at > 600000) this.loginBuckets.delete(key);
    for (const [key, row] of this.sessions) if (row.expiresAt <= at) this.sessions.delete(key);
    const ip = clientAddress(req, this.network.opts.trustProxy).ip;
    if (!this.loginBuckets.has(ip)) {
      if (this.loginBuckets.size >= 1000) throw fail(429, '登录请求过多，请稍后重试');
      this.loginBuckets.set(ip, { at, budget: new TokenBucket(1 / 60, 5, at) });
    }
    const row = this.loginBuckets.get(ip); row.at = at;
    if (!row.budget.take(at) || this.authBusy >= 2) { res.setHeader('Retry-After', '60'); throw fail(429, '登录尝试过多，请稍后重试'); }
    const body = await this.body(req);
    this.authBusy++;
    let verified;
    try { verified = await this.verifyPassword(body.password); } finally { this.authBusy--; }
    if (!verified || body.username !== this.config.username) throw fail(401, '账号或密码错误');
    const previous = this.cookie(req); if (previous) this.sessions.delete(hash(previous));
    if (this.sessions.size >= 16) throw fail(429, '管理会话过多，请退出其他窗口');
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    this.sessions.set(hash(token), { csrf, username: this.config.username, expiresAt: at + SESSION_MS, budget: new TokenBucket(1, 8, at) });
    this.setCookie(res, token, SESSION_MS / 1000);
    this.json(req, res, 200, { ok: true, username: this.config.username, csrf });
  }
  serialize(work) {
    const result = this.writes.then(work);
    this.writes = result.catch(() => {});
    return result;
  }
  async commit(state, event) {
    const next = { ...state, audit: [{ id: id(), at: this.now(), actor: this.config.username, ...event }, ...state.audit].slice(0, 1000) };
    await atomicJson(this.stateFile, next);
    this.state = next; this.reindex();
  }
  kickSession(session, reason) {
    const conn = session.ws && this.network.conns.get(session.ws);
    this.registry.remove(session);
    this.lobby.onExpire(session); // real leave: frees the seat, eliminates only this player and returns their pool pieces.
    conn?.close(4003, reason);
  }
  async kick(body) {
    const session = this.registry.byId(cleanText(body.playerId, 64, t('玩家 ID')));
    if (!session) throw fail(404, '玩家已经离线或会话已结束，请刷新列表');
    const reason = cleanText(body.reason || t('管理员移出'), 200, t('原因'));
    await this.commit(this.state, { action: 'kick', playerId: session.playerId, name: session.name, reason });
    this.kickSession(session, 'admin:kicked');
    return { ok: true };
  }
  async ban(body) {
    const session = this.registry.byId(cleanText(body.playerId, 64, t('玩家 ID')));
    if (!session) throw fail(404, '玩家会话已结束，请刷新后选择玩家');
    const reason = cleanText(body.reason || t('管理员封禁'), 200, t('原因'));
    const seconds = body.durationSeconds;
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 365 * 86400 || (body.includeIp != null && typeof body.includeIp !== 'boolean')) throw fail(400, '封禁参数无效');
    if (body.includeIp && (!isIP(session.addr) || isLocalIp(session.addr))) throw fail(400, '此地址不是可封禁的公网 IP');
    const keys = ['t:' + hash(session.token)], scopes = ['session'];
    if (session.adminBrowserHash) { keys.push('b:' + session.adminBrowserHash); scopes.push('browser'); }
    if (body.includeIp) { keys.push('p:' + hash(session.addr)); scopes.push('ip'); }
    const now = this.now();
    const record = { id: id(), playerId: session.playerId, name: session.name, reason, keys, scopes,
      createdAt: now, expiresAt: seconds ? now + seconds * 1000 : 0, revokedAt: null };
    const bans = this.state.bans.filter(b => !b.revokedAt && (!b.expiresAt || b.expiresAt > now));
    if (bans.length >= 2000) throw fail(409, '封禁记录数量已达上限');
    await this.commit({ ...this.state, bans: [...bans, record] }, { action: 'ban', playerId: session.playerId, name: session.name, reason, scopes, expiresAt: record.expiresAt });
    let affected = 0;
    for (const target of [...this.registry.all()]) {
      const targetKeys = ['t:' + hash(target.token), target.adminBrowserHash && 'b:' + target.adminBrowserHash, target.addr && 'p:' + hash(target.addr)];
      if (targetKeys.some(key => keys.includes(key))) { this.kickSession(target, 'admin:banned'); affected++; }
    }
    return { ok: true, affected, banId: record.id };
  }
  async unban(body) {
    const banId = cleanText(body.banId, 64, t('封禁 ID'));
    const ban = this.state.bans.find(b => b.id === banId && !b.revokedAt);
    if (!ban) throw fail(404, '封禁记录不存在或已经解除');
    const bans = this.state.bans.map(b => b.id === banId ? { ...b, revokedAt: this.now() } : b);
    await this.commit({ ...this.state, bans }, { action: 'unban', playerId: ban.playerId, name: ban.name, banId });
    return { ok: true };
  }
  /**
   * Display channels are separate (shared/announcements.js activeAnnouncement): a scroll notice only competes with
   * other scroll notices, a popup only with other popups. Reporting one channel alone made every popup row look like
   * it was waiting for a higher-level notice that never existed.
   */
  async announcementData() {
    const result = await jsonFile(this.announcementFile, { announcements: [] });
    const rows = parseAnnouncements(result.doc);
    const now = this.now();
    return { ...result, rows, current: activeAnnouncement(rows, now, 'scroll'), popupCurrent: activeAnnouncement(rows, now, 'popup') };
  }
  async publish(body) {
    const old = await this.announcementData();
    const notice = { id: 'admin_' + id(), text: cleanText(typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ') : body.text, 500, t('公告正文')),
      startAt: new Date(this.now()).toISOString(), durationSeconds: body.durationSeconds, level: body.level || 'warning', enabled: true };
    try { parseAnnouncements({ announcements: [notice] }); } catch { throw fail(400, '公告等级或时长无效，时长需为 1–86400 秒'); }
    const list = old.doc.announcements.filter(n => !n.id.startsWith('admin_') || Date.parse(n.startAt) + n.durationSeconds * 1000 > this.now());
    const doc = { ...old.doc, announcements: [...list, notice] };
    if (doc.announcements.length > 100) throw fail(409, '有效公告数量已达上限');
    parseAnnouncements(doc);
    if (Buffer.byteLength(JSON.stringify(doc, null, 2) + '\n') > ANNOUNCEMENT_MAX_BYTES) throw fail(409, '公告排期容量已达上限，请先清理旧排期');
    await atomicJson(this.announcementFile, doc, old.raw);
    await this.commit(this.state, { action: 'announcement', announcementId: notice.id, text: notice.text, durationSeconds: notice.durationSeconds, level: notice.level });
    return { ok: true, announcementId: notice.id };
  }
  async stopNotice(body) {
    const old = await this.announcementData();
    const noticeId = cleanText(body.announcementId, 64, t('公告 ID'));
    if (!noticeId.startsWith('admin_') || !old.doc.announcements.some(n => n.id === noticeId)) throw fail(404, '管理页发布的公告不存在');
    await atomicJson(this.announcementFile, { ...old.doc, announcements: old.doc.announcements.map(n => n.id === noticeId ? { ...n, enabled: false } : n) }, old.raw);
    await this.commit(this.state, { action: 'stopAnnouncement', announcementId: noticeId });
    return { ok: true };
  }
  /** Remove any historic entry outright — admin-published or board seed alike. Deleted means gone. */
  async deleteAnnouncement(body) {
    const old = await this.announcementData();
    const noticeId = cleanText(body.announcementId, 64, t('公告 ID'));
    if (!old.doc.announcements.some(n => n.id === noticeId)) throw fail(404, '公告不存在或已被删除');
    await atomicJson(this.announcementFile, { ...old.doc, announcements: old.doc.announcements.filter(n => n.id !== noticeId) }, old.raw);
    await this.commit(this.state, { action: 'deleteAnnouncement', announcementId: noticeId });
    return { ok: true };
  }
  /** Runtime drain switch (server/lobby.js maintenance): refuse new rooms and matchmaking; running matches keep playing. */
  async setMaintenance(body) {
    if (typeof body.maintenance !== 'boolean') throw fail(400, 'maintenance 需为布尔值');
    const changed = this.lobby.setMaintenanceOverride(body.maintenance);
    await this.commit(this.state, { action: 'maintenance', maintenance: body.maintenance });
    return { ok: true, maintenance: !!this.lobby.maintenance?.(), changed: changed !== false };
  }
  /** The rooms whose match is live — what a 重启 interrupts. */
  activeMatchCount() {
    let count = 0;
    for (const room of this.lobby.rooms?.values?.() ?? []) if (room.match) count++;
    return count;
  }
  /**
   * 重启 (the panel's button next to 维护): drain first, record the audit row, then hand over to `restart`
   * (server/index.js's `close()` + exit) after the response has been flushed. The supervisor — Docker's restart
   * policy or a unit file — starts a fresh process, which re-reads runtime configuration such as a new wild-mode
   * selection. Nothing supervised means the server stays down, and live matches are lost without a checkpoint, so
   * both cases need `force`; the panel's dialog already asked.
   * @param {{force?: boolean}} body
   */
  async restartServer(body = {}) {
    if (typeof this.restart !== 'function') throw fail(503, '重启接口未启用');
    const force = body.force === true;
    const supervised = restartSupervised();
    if (!supervised && !force) throw fail(409, '未检测到守护进程：重启后不会自动拉起，请确认后再试');
    const activeMatches = this.activeMatchCount();
    if (activeMatches > 0 && !force) throw fail(409, `仍有 ${activeMatches} 场对局进行中：重启会中断它们，请确认后再试`);
    this.lobby.setMaintenanceOverride?.(true);
    await this.commit(this.state, { action: 'restart', forced: force, activeMatches });
    // let the response reach the browser before the process goes away
    setTimeout(() => { Promise.resolve(this.restart()).catch((e) => this.log.error?.('[player-admin] restart failed', e)); }, 250);
    return { ok: true, restarting: true, supervised, activeMatches };
  }
  /**
   * 内容管理 (docs/CONTENT-ADMIN.md): the two runtime documents the panel writes. Both are read once at boot, so a
   * change takes effect after a restart — the panel says so, and the 重启 button next to 维护 is how it happens.
   * An env-narrowed SP_VERSIONS wins over the panel (the panel shows it read-only), so `envEnabled` is reported.
   */
  async contentVersions() {
    if (!this.content) throw fail(503, '内容管理未启用');
    const { doc } = await jsonFile(this.content.versionsFile, null);
    const current = doc ?? defaultVersions(this.content.ids);
    return { registered: [...this.content.ids], enabled: current.enabled, revision: current.revision,
      envLocked: !!this.content.envEnabled };
  }
  /** `enabled` is the whole set the panel sends, not a delta; the write is CAS-guarded and audited. */
  async setContentVersions(body = {}) {
    if (!this.content) throw fail(503, '内容管理未启用');
    const current = await jsonFile(this.content.versionsFile, null);
    const result = versionsMutation(current, body, { ids: this.content.ids });
    if (!result.ok) throw fail(result.cas ? 409 : 400, result.errors.join('；'));
    if (result.changed) {
      await atomicJson(this.content.versionsFile, result.document, current.raw);
      await this.commit(this.state, { action: 'contentVersions', enabled: result.document.enabled, revision: result.document.revision });
    }
    return { ok: true, changed: result.changed, revision: result.document.revision, restartRequired: true };
  }
  /**
   * The wild rows: the catalog is cached per source set, so a read is cheap even with the whole table open. The
   * synthesis status comes along with it (§6): a source set that cannot merge cannot be saved, so the panel sees the
   * reason on load instead of discovering it by trying to save.
   */
  async contentWild(query = {}) {
    if (!this.content) throw fail(503, '内容管理未启用');
    const { doc } = await jsonFile(this.content.wildFile, null);
    const current = doc ?? defaultWild(this.content.ids);
    const catalog = buildCatalog(current.sources, { ids: this.content.ids, log: this.log });
    const merged = mergeWild(current, (versionId) => getVersionData(versionId, { log: this.log }),
      { ids: this.content.ids, log: this.log });
    return { ...wildView(current, catalog, query), stats: tableStats(catalog),
      synthesis: { ok: merged.ok, errors: merged.errors, dropped: merged.dropped.length } };
  }
  /**
   * A POST carries either a row patch or a batch preset; both go through the same validation and the same CAS.
   * The candidate document is synthesized before it is written (docs/CONTENT-ADMIN.md §6): a selection that cannot
   * merge must not reach runtime/wild.json, because the failure would only show at boot and force a redeploy. The
   * boot check stays as the last line of defence.
   */
  async setContentWild(body = {}) {
    if (!this.content) throw fail(503, '内容管理未启用');
    const current = await jsonFile(this.content.wildFile, null);
    const doc = current.doc ?? defaultWild(this.content.ids);
    // The catalog is built for the sources the request targets, so membership and the synthesis check agree.
    const sources = Array.isArray(body.patch?.sources) ? body.patch.sources : doc.sources;
    const catalog = buildCatalog(sources, { ids: this.content.ids, log: this.log });
    let patch = body.patch;
    if (body.preset) {
      const rows = {};
      for (const [type, table] of Object.entries(catalog.tables)) rows[type] = filterRows(table, body.preset.filter);
      patch = presetPatch(rows, { preset: body.preset.kind, version: body.preset.version, order: catalog.order });
      if (!patch) throw fail(400, '未知的批量预设');
    }
    const result = wildMutation(current, { patch, expectedRevision: body.expectedRevision },
      { ids: this.content.ids, membership: catalog.membership });
    if (!result.ok) throw fail(result.cas ? 409 : 400, result.errors.join('；'));
    if (result.changed) {
      const merged = mergeWild(result.document, (versionId) => getVersionData(versionId, { log: this.log }),
        { ids: this.content.ids, log: this.log });
      if (!merged.ok) throw fail(400, `${t('合成校验未通过')}: ${merged.errors.join('；')}`);
      await atomicJson(this.content.wildFile, result.document, current.raw);
      await this.commit(this.state, { action: 'contentWild', patch, revision: result.document.revision });
    }
    return { ok: true, changed: result.changed, revision: result.document.revision, restartRequired: true };
  }
  /**
   * 皮肤管理 (docs/CONTENT-ADMIN.md §9): the gate as the panel reads it — one group per operator, the default
   * appearance first (fixed, no checkbox), then the official table, then the packs. Read once at boot like the rest
   * of 内容管理, so a change takes effect after a restart.
   */
  async contentSkins() {
    if (!this.content) throw fail(503, '内容管理未启用');
    const current = await jsonFile(this.content.skinsFile, null);
    const doc = current.doc ?? defaultSkins();
    return skinGroups(doc, { pack: packSkins(this.packs?.snapshot?.()?.plugins ?? []) });
  }
  /**
   * The whole map the panel sends, not a delta (§9): a skin the panel leaves out is offered. Only the shape is
   * checked — a plugin skin can disappear with its pack and the gate has to survive that, exactly as a stored
   * registry choice does — so there is nothing here to validate against a live catalogue.
   */
  async setSkins(body = {}) {
    if (!this.content) throw fail(503, '内容管理未启用');
    const current = await jsonFile(this.content.skinsFile, null);
    const result = skinsMutation(current, body);
    if (!result.ok) throw fail(result.cas ? 409 : 400, result.errors.join('；'));
    if (result.changed) {
      await atomicJson(this.content.skinsFile, result.document, current.raw);
      await this.commit(this.state, { action: 'contentSkins', disabled: result.document.disabled, revision: result.document.revision });
    }
    return { ok: true, changed: result.changed, revision: result.document.revision, restartRequired: true };
  }
  /**
   * 娱乐模式 (arcade) per-mode open switch (server/lobby.js setArcadeMode): closing refuses that mode's NEW rooms and
   * starts while its running matches finish naturally. Persisted in state.json, so it survives a restart.
   * @param {{id?: string, open?: boolean}} body
   */
  async setArcade(body) {
    const mode = body && typeof body.id === 'string' ? ARCADE_ADMIN_MODES.find((m) => m.id === body.id) : null;
    if (!mode) throw fail(400, '未知的娱乐模式');
    if (typeof body.open !== 'boolean') throw fail(400, 'open 需为布尔值');
    const changed = this.lobby.setArcadeMode(mode.id, body.open);
    await this.commit({ ...this.state, arcade: { ...(this.state.arcade || {}), [mode.id]: body.open } },
      { action: 'arcade', mode: mode.id, name: mode.name, open: body.open });
    return { ok: true, arcade: this.lobby.arcadeInfo(), changed };
  }
  /**
   * 资源包 (packs): the admin rows — raw entries plus the policy's view (a disabled paid pack must stay visible
   * to the admin so it can be re-enabled; players never see it, see server/pluginPolicy.js). Paid rows last.
   */
  packData() {
    if (!this.packs || !this.policy) return [];
    return this.packs.snapshot().plugins.map((p) => this.policy.row(p)).filter(Boolean)
      .sort((a, b) => (a.paid !== b.paid ? (a.paid ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  /**
   * Runtime switch (server/pluginPolicy.js): files stay on disk, only delivery is controlled — the catalogues,
   * /packs/ and /p/ answer for the next request; bytes an open page already loaded are not recalled (the same
   * drain semantics as the arcade switch). Persisted in state.json, so it survives a restart.
   * Enabling a paid pack needs `confirm` — handing paid content to players is the risk this system exists to avoid.
   * @param {{id?: string, enabled?: boolean, confirm?: boolean}} body
   */
  async setPack(body) {
    if (!this.packs || !this.policy) throw fail(503, '资源包管理未启用');
    const packId = cleanText(body.id, 32, '资源包 ID');
    if (!isPluginId(packId)) throw fail(400, '资源包 ID 无效');
    const entry = this.packs.snapshot().byId.get(packId);
    if (!entry) throw fail(404, '资源包不存在');
    if (typeof body.enabled !== 'boolean') throw fail(400, 'enabled 需为布尔值');
    if (this.policy.isPaid(entry) && body.enabled && body.confirm !== true) throw fail(400, '付费内容包默认禁用，启用需确认合规风险（confirm）');
    this.policy.set(packId, body.enabled);
    await this.commit({ ...this.state, packs: this.policy.snapshot() }, { action: 'pack', packId, enabled: body.enabled });
    return { ok: true, packs: this.packData() };
  }
  async password(body, req, res) {
    if (!await this.verifyPassword(body.currentPassword)) throw fail(403, '当前管理密码不正确');
    const secret = await credentials(body.newPassword);
    const config = { ...this.config, ...secret };
    await atomicJson(this.configFile, config);
    this.config = config; this.sessions.clear();
    this.setCookie(res, '', 0);
    await this.commit(this.state, { action: 'passwordChanged' });
    return { ok: true };
  }
  async handle(req, res, pathname) {
    this.headers(res);
    if (this.closed) { this.json(req, res, 503, { error: t('管理服务暂不可用') }); return; }
    if (pathname === '/admin' && ['GET', 'HEAD'].includes(req.method)) { res.writeHead(302, { Location: '/admin/' }); res.end(); return; }
    const assets = { '/admin/': ['index.html', 'text/html; charset=utf-8'], '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'], '/admin/admin.js': ['admin.js', 'text/javascript; charset=utf-8'] };
    if (Object.hasOwn(assets, pathname)) {
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, '请求方法不支持');
      const [file, contentType] = assets[pathname];
      const bytes = await readFile(path.join(this.publicDir, 'admin', file));
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
    }
    if (!pathname.startsWith('/admin/api/')) throw fail(404, '管理接口不存在');
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw fail(405, '请求方法不支持');
    if (req.method === 'POST') this.verifyOrigin(req);
    if (pathname === '/admin/api/login' && req.method === 'POST') { await this.login(req, res); return; }
    const session = this.session(req);
    if (!session) throw fail(401, '请先登录管理页');
    const query = new URL(req.url, this.config.publicOrigin).searchParams;
    if (['GET', 'HEAD'].includes(req.method)) {
      if (pathname === '/admin/api/session') this.json(req, res, 200, { username: session.username, csrf: session.csrf });
      else if (pathname === '/admin/api/snapshot') {
        const data = playerSnapshot(this);
        const search = (query.get('search') || '').trim().slice(0, 80).toLowerCase();
        const scope = query.get('scope') || 'all';
        const filtered = data.players.filter(p => (!search || [p.name, p.playerId, p.roomCode, p.matchId, p.ip].some(v => String(v || '').toLowerCase().includes(search)))
          && (scope === 'all' || scope === 'playing' && p.playing || scope === 'online' && p.connected || scope === 'disconnected' && !p.connected || scope === 'matching' && p.status === 'matching'));
        const offset = Math.min(20000, Math.max(0, Number.parseInt(query.get('offset'), 10) || 0));
        this.json(req, res, 200, { ...data, players: filtered.slice(offset, offset + 200), filteredCount: filtered.length, offset,
          bans: this.state.bans.filter(b => !b.revokedAt).map(({ keys, ...b }) => ({ ...b, expired: !!b.expiresAt && b.expiresAt <= this.now() })),
          audit: this.state.audit.slice(0, 50), announcement: (await this.announcementData()).current });
      } else if (pathname === '/admin/api/announcements') {
        const data = await this.announcementData();
        this.json(req, res, 200, { announcements: data.rows.map(({ ...n }) => n), current: data.current, popupCurrent: data.popupCurrent });
      } else if (pathname === '/admin/api/maintenance') {
        this.json(req, res, 200, { maintenance: !!this.lobby.maintenance?.() });
      } else if (pathname === '/admin/api/restart') {
        this.json(req, res, 200, { enabled: typeof this.restart === 'function', supervised: restartSupervised(),
          activeMatches: this.activeMatchCount() });
      } else if (pathname === '/admin/api/content/versions') {
        // 内容管理 (docs/CONTENT-ADMIN.md): the enabled set the panel switches; effective after a restart.
        this.json(req, res, 200, await this.contentVersions());
      } else if (pathname === '/admin/api/content/wild') {
        this.json(req, res, 200, await this.contentWild(query));
      } else if (pathname === '/admin/api/content/skins') {
        // 皮肤管理 (docs/CONTENT-ADMIN.md §9): the gate the panel reads; effective after a restart.
        this.json(req, res, 200, await this.contentSkins());
      } else if (pathname === '/admin/api/arcade') {
        // 娱乐模式 (arcade): the completed modes the panel switches, with their effective (build switch AND admin) state
        this.json(req, res, 200, { modes: ARCADE_ADMIN_MODES.map((m) => ({ id: m.id, name: m.name, open: this.lobby.arcadeOpen(m.id) === true })) });
      } else if (pathname === '/admin/api/packs') {
        // 资源包 (packs): every installed pack/plugin with the policy's view — paid rows included, so the admin
        // can see and re-enable them; players never receive a disabled paid entry.
        this.json(req, res, 200, { packs: this.packData() });
      } else {
        // A GET route has to be registered as one: the built-ins above are hardcoded, and a POST-only route cannot be
        // reached by the console's read requests.
        const route = this.routes.get(pathname);
        if (route?.method === 'GET') this.json(req, res, 200, await this.serialize(() => route.handler(undefined, query)));
        else throw fail(404, '管理接口不存在');
      }
      return;
    }
    if (!same(req.headers['x-csrf-token'], session.csrf)) throw fail(403, '操作校验失败，请重新登录');
    if (!session.budget.take(this.now())) throw fail(429, '管理操作过于频繁，请稍后重试');
    const body = await this.body(req);
    const handlers = { '/admin/api/kick': () => this.kick(body), '/admin/api/ban': () => this.ban(body), '/admin/api/unban': () => this.unban(body),
      '/admin/api/announcement': () => this.publish(body), '/admin/api/announcement/stop': () => this.stopNotice(body),
      '/admin/api/announcement/delete': () => this.deleteAnnouncement(body), '/admin/api/maintenance': () => this.setMaintenance(body),
      '/admin/api/restart': () => this.restartServer(body),
      '/admin/api/content/versions': () => this.setContentVersions(body),
      '/admin/api/content/wild': () => this.setContentWild(body),
      '/admin/api/content/skins': () => this.setSkins(body),
      '/admin/api/arcade': () => this.setArcade(body),
      '/admin/api/packs': () => this.setPack(body),
      '/admin/api/password': () => this.password(body, req, res),
      '/admin/api/logout': async () => { this.sessions.delete(hash(this.cookie(req))); this.setCookie(res, '', 0); return { ok: true }; } };
    // Plugin routes (registerAdminRoute) receive the parsed JSON body and the query; permission stays a reserved field.
    const route = this.routes.get(pathname);
    const handler = Object.hasOwn(handlers, pathname) ? handlers[pathname]
      : route?.method === 'POST' ? () => route.handler(body, query) : null;
    if (!handler) throw fail(404, '管理接口不存在');
    this.json(req, res, 200, await this.serialize(handler));
  }
  async close() {
    this.closed = true;
    this.sessions.clear();
    if (this.network.moderation === this) this.network.moderation = null;
    await this.writes;
  }
}

/** Mounted separately so a tested live install can keep the existing game server and sockets. */
export async function mountPlayerAdmin({ server, network, lobby, registry, packs = null, policy = null, restart = null, configFile = path.join(ROOT, 'config/player-admin/config.json'),
  announcementFile = path.join(ROOT, 'config/announcements.json'), publicDir = path.join(ROOT, 'public'), content = null, log = console, now = Date.now }) {
  let admin = null;
  try {
    const { doc } = await jsonFile(configFile, null);
    if (doc) { admin = new PlayerAdmin({ network, lobby, registry, config: doc, configFile, announcementFile, publicDir, packs, policy, restart, content, log, now }); await admin.start(); }
  } catch (e) { log.error?.('[player-admin] disabled: ' + e.message); admin = null; }
  const prior = server.listeners('request');
  for (const listener of prior) server.off('request', listener);
  const listener = (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/admin' || pathname.startsWith('/admin/')) {
      if (!admin) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
      admin.handle(req, res, pathname).catch(e => {
        if (res.headersSent) { res.destroy(); return; }
        const status = e.status || 500;
        if (status >= 500) log.error?.('[player-admin] request failed: ' + e.message);
        admin.json(req, res, status, { error: status >= 500 ? t('管理服务暂不可用，请稍后重试') : e.message });
      });
    } else for (const fn of prior) fn.call(server, req, res);
  };
  server.on('request', listener);
  return { admin, async close() { await admin?.close(); }, async unmount() {
    await admin?.close(); server.off('request', listener); for (const fn of prior) server.on('request', fn);
  } };
}
