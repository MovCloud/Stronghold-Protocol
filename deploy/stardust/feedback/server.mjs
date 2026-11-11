// The players' feedback board (/feedback): bug reports and suggestions, public to every logged-in player. The page only
// reads and submits; management (status, reply, hidden, delete) is the admin console's, which runs under the admin
// session. Native node:http, no framework, no npm dependency; storage in store.mjs, input rules / limits in policy.mjs,
// the page in public/ (README.md in this directory).
//
// Behind OpenResty: nginx enforces the site's password gate on every path and sets the trusted X-Real-IP and
// X-Ark-Session (the signature part of the gate cookie: stable per login, not a player identity). The session header is
// optional — without a gate in front, the per-session window is keyed by the client address. Bind loopback.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemView, openStore } from './store.mjs';
import { WindowLimiter, clientKey, parseListQuery, validateNew, validatePatch } from './policy.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const BODY_LIMIT = 16 * 1024;
/** New items: per gate session (the client address when there is no gate), per client address (IPv6 by /64) and for
 * everybody. Sliding windows, in memory. */
export const POST_LIMITS = Object.freeze({
  session: [{ max: 3, window: 10 * MINUTE }, { max: 15, window: DAY }],
  ip: [{ max: 30, window: DAY }],
  global: [{ max: 120, window: HOUR }],
});
export const DUPLICATE_WINDOW = DAY;
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ASSET_TYPES = new Map([
  ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'], ['.ico', 'image/x-icon'],
]);
const SESSION_RE = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/;
const ITEM_RE = /^\/feedback\/api\/items\/([1-9]\d{0,15})$/;

/**
 * public/: the page (index.html, `__ASSET_VERSION__` → a hash of every top-level file) and the flat asset allowlist
 * (no subdirectories, dotfiles or index.html; only the types above). Read once at startup.
 */
export function loadPublic(dir) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
  const files = new Map(names.map((name) => [name, readFileSync(join(dir, name))]));
  if (!files.has('index.html')) throw new Error('feedback: public/index.html is missing');
  const all = createHash('sha256');
  for (const [name, data] of files) all.update(`${name}\0${data.length}\0`).update(data);
  const version = all.digest('hex').slice(0, 12);
  const tag = (data) => `"${createHash('sha256').update(data).digest('base64url').slice(0, 22)}"`;
  const assets = new Map();
  for (const [name, data] of files) {
    const type = ASSET_TYPES.get(extname(name).toLowerCase());
    if (name !== 'index.html' && type && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) assets.set(name, { type, data, etag: tag(data) });
  }
  const page = Buffer.from(files.get('index.html').toString('utf8').replaceAll('__ASSET_VERSION__', version));
  return { version, page: { data: page, etag: tag(page) }, assets };
}

class HttpError extends Error {
  constructor(status, error, extra = {}) { super(error); this.status = status; this.extra = extra; }
}

function readJSON(req) {
  if (!/^application\/json\s*(?:;|$)/i.test(req.headers['content-type'] || '')) return Promise.reject(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE'));
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return Promise.reject(new HttpError(413, 'TOO_LARGE'));
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0, done = false;
    const finish = (error, value) => { if (!done) { done = true; if (error) reject(error); else resolveBody(value); } };
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > BODY_LIMIT) { chunks.length = 0; finish(new HttpError(413, 'TOO_LARGE')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      let doc;
      try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { doc = null; }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) finish(new HttpError(400, 'BAD_JSON'));
      else finish(null, doc);
    });
    // after 'end' this is a no-op; before it, the client went away
    req.on('close', () => finish(new HttpError(400, 'ABORTED')));
    req.on('error', () => finish(new HttpError(400, 'ABORTED')));
  });
}

const etagMatch = (header, etag) => typeof header === 'string'
  && header.split(',').some((v) => v.trim().replace(/^W\//, '') === etag);

/**
 * @param {{ db?: string, origin: string, backupDir?: string | null, backupKeep?: number, backupCheckMs?: number,
 *   publicDir?: string, now?: () => number,
 *   trustProxy?: 'auto' | boolean,
 *   log?: { info: Function, warn: Function, error: Function } }} options
 * @returns {{ server: http.Server, store: object, handle: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
 *   version: string,
 *   backup: () => { name: string, created: boolean, removed: number } | null, visibleCount: () => number, close: () => Promise<void> }}
 */
export function createFeedbackServer({
  db = '/data/feedback.sqlite', origin, backupDir = null, backupKeep = 14,
  backupCheckMs = HOUR, publicDir = join(ROOT, 'public'), now = Date.now, trustProxy = true, log = console,
} = /** @type {any} */ ({})) {
  let allowedOrigin;
  try { allowedOrigin = new URL(origin).origin; } catch { allowedOrigin = null; }
  if (!allowedOrigin || allowedOrigin !== origin) throw new Error('feedback: FEEDBACK_ORIGIN must be an origin like https://example.org');
  const site = loadPublic(publicDir);
  const store = openStore(db, { now });
  const limits = {
    session: new WindowLimiter({ rules: POST_LIMITS.session }),
    ip: new WindowLimiter({ rules: POST_LIMITS.ip }),
    global: new WindowLimiter({ rules: POST_LIMITS.global }),
  };

  const backup = () => {
    if (!backupDir) return null;
    try { return store.backup(backupDir, now(), backupKeep); } catch (e) {
      log.error(`[feedback] backup failed: ${e?.code || e?.name || 'error'}`);
      return null;
    }
  };
  backup();
  const backupTimer = backupDir ? setInterval(backup, Math.max(1000, backupCheckMs)) : null;
  backupTimer?.unref();

  const send = (req, res, status, data = null, headers = {}) => {
    if (data) headers['Content-Length'] = data.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : data ?? undefined);
  };
  const json = (req, res, status, value, headers = {}) => send(req, res, status,
    value === null ? null : Buffer.from(JSON.stringify(value)),
    { ...(value === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), 'Cache-Control': 'no-store', ...headers });
  const retry = (ms) => Math.max(1, Math.ceil(ms / 1000));
  const limited = (ms) => new HttpError(429, 'RATE_LIMITED', { retryAfter: retry(ms) });
  const methods = (req, allowed) => {
    if (!allowed.includes(req.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', { allow: allowed.join(', ') });
  };
  const clientIP = (req) => {
    const forwarded = req.headers['x-real-ip'];
    // Mounted behind OpenResty the header is set by nginx. Mounted directly on the game server it is client-controlled,
    // so it only counts when a proxy is explicitly trusted, or when the peer is the loopback one that set it.
    const peer = req.socket.remoteAddress || 'unknown';
    const trusted = trustProxy === true || (trustProxy === 'auto' && LOOPBACK.test(peer));
    return clientKey(typeof forwarded === 'string' && isIP(forwarded) && trusted ? forwarded : peer);
  };
  const checkOrigin = (req) => {
    const fetchSite = req.headers['sec-fetch-site'];
    if (req.headers.origin !== allowedOrigin || (fetchSite !== undefined && fetchSite !== 'same-origin')) throw new HttpError(403, 'ORIGIN');
  };

  function page(req, res) {
    methods(req, ['GET', 'HEAD']);
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'private, no-cache', ETag: site.page.etag };
    if (etagMatch(req.headers['if-none-match'], site.page.etag)) return send(req, res, 304, null, headers);
    return send(req, res, 200, site.page.data, headers);
  }
  function asset(req, res, url, name) {
    methods(req, ['GET', 'HEAD']);
    const file = site.assets.get(name);
    if (!file) throw new HttpError(404, 'NOT_FOUND');
    const cache = url.searchParams.get('v') === site.version ? 'private, max-age=31536000, immutable' : 'private, no-cache';
    const headers = { 'Content-Type': file.type, 'Cache-Control': cache, ETag: file.etag };
    if (etagMatch(req.headers['if-none-match'], file.etag)) return send(req, res, 304, null, headers);
    return send(req, res, 200, file.data, headers);
  }

  async function createItem(req, res, ip) {
    checkOrigin(req);
    // X-Ark-Session is the gate's header. Without OpenResty in front there is none, so the per-session window is keyed
    // by the client address instead (README.md) — the limits still hold, just per address rather than per login.
    const values = req.headersDistinct['x-ark-session'];
    const key = values?.length === 1 && SESSION_RE.test(values[0]) ? values[0] : ip;
    const checked = validateNew(await readJSON(req));
    if ('field' in checked) throw new HttpError(400, 'INVALID', { field: checked.field });
    const item = checked.value, at = now();
    // A duplicate answers before the limits and costs no quota (a resend after a lost response finds its item).
    const id = store.duplicateOf(item.title, item.body, at - DUPLICATE_WINDOW);
    if (id !== null) throw new HttpError(409, 'DUPLICATE', { id });
    const wait = Math.max(limits.session.wait(key, at), limits.ip.wait(ip, at), limits.global.wait('', at));
    if (wait) throw limited(wait);
    const row = store.create(item, at);
    limits.session.hit(key, at);
    limits.ip.hit(ip, at);
    limits.global.hit('', at);
    return json(req, res, 201, { item: itemView(row) });
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (!req.url || req.url.length > 4096 || !req.url.startsWith('/') || req.url.startsWith('//')) throw new HttpError(400, 'BAD_REQUEST');
    const url = new URL(req.url, 'http://feedback.invalid');
    const path = url.pathname;
    const ip = clientIP(req);
    if (path === '/feedback') {
      methods(req, ['GET', 'HEAD']);
      return send(req, res, 301, null, { Location: `/feedback/${url.search}`, 'Cache-Control': 'no-store' });
    }
    if (path === '/feedback/') return page(req, res);
    if (path.startsWith('/feedback/assets/')) return asset(req, res, url, path.slice('/feedback/assets/'.length));
    if (path === '/feedback/api/health') {
      methods(req, ['GET', 'HEAD']);
      return json(req, res, 200, { ok: true, items: store.visibleCount() });
    }
    if (path === '/feedback/api/items') {
      methods(req, ['GET', 'HEAD', 'POST']);
      if (req.method === 'POST') return createItem(req, res, ip);
      const parsed = parseListQuery(url.searchParams);
      if ('field' in parsed) throw new HttpError(400, 'INVALID', { field: parsed.field });
      const { rows, next } = store.list(parsed.query);
      return json(req, res, 200, { items: rows.map((row) => itemView(row)), next, counts: store.counts(parsed.query) });
    }
    const match = ITEM_RE.exec(path);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new HttpError(404, 'NOT_FOUND');
    methods(req, ['GET', 'HEAD']);
    const row = store.get(Number(match[1]));
    if (!row || row.hidden) throw new HttpError(404, 'NOT_FOUND');
    return json(req, res, 200, { item: itemView(row) });
  }

  /** handle() with the error mapping, so a mount on another server can answer a /feedback request the same way. */
  const handleRequest = (req, res) => handle(req, res).catch((error) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof HttpError) {
      const { allow, retryAfter, ...extra } = error.extra;
      const headers = {};
      if (allow) headers.Allow = allow;
      if (retryAfter) headers['Retry-After'] = String(retryAfter);
      if (error.status === 413 || error.message === 'ABORTED') { headers.Connection = 'close'; req.resume(); }
      return json(req, res, error.status, { error: error.message, ...(retryAfter ? { retryAfter } : {}), ...extra }, headers);
    }
    // Never log the request: no URL, headers, addresses, keys or bodies.
    log.error(`[feedback] request failed: ${error?.code || error?.name || 'error'}`);
    json(req, res, 500, { error: 'INTERNAL' });
  });

  const server = http.createServer({ maxHeaderSize: 16384 }, handleRequest);
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });

  let closing = null;
  const close = () => closing ??= new Promise((resolveClose) => {
    if (backupTimer) clearInterval(backupTimer);
    const done = () => { store.close(); resolveClose(); };
    if (!server.listening) return done();
    server.close(done);
    server.closeIdleConnections();
  });
  return { server, store, handle: handleRequest, version: site.version, backup,
    visibleCount: store.visibleCount, close };
}

const fail = (status, message) => Object.assign(new Error(message), { status });
const ADMIN_FIELDS = { status: '状态', reply: '回复', hidden: '隐藏', q: '搜索词', before: '分页游标', limit: '每页数量' };
const ADMIN_STATUSES = { unassigned: '待处理', unplanned: '暂不规划', planned: '已规划', updated: '已更新' };

/**
 * The admin console's view of the same store (public/admin): read the list, set status / reply / hidden, delete. This is
 * the board's only management path — it runs under the admin session, and the public page has no management UI.
 * `admin` is only used through the plugin hook — this module never imports server/playerAdmin.js.
 * Messages are in Chinese because admin.js renders `error` as it is.
 */
export function registerAdminRoutes(admin, store, { now = Date.now } = {}) {
  const idOf = (body) => {
    const id = Number.isSafeInteger(body?.id) && body.id > 0 ? body.id : null;
    if (id === null) throw fail(400, '反馈编号无效');
    return id;
  };
  admin.registerAdminRoute('/admin/api/feedback', { permission: 'feedback', method: 'GET', handler: (body, query) => {
    const parsed = parseListQuery(query);
    if ('field' in parsed) throw fail(400, `无效的筛选参数「${ADMIN_FIELDS[parsed.field] || parsed.field}」`);
    const view = { ...parsed.query, admin: true }; // the console sees hidden items too
    const { rows, next } = store.list(view);
    return { items: rows.map((row) => itemView(row, true)), next,
      counts: store.counts({ admin: true, category: view.category, terms: view.terms }) };
  } });
  admin.registerAdminRoute('/admin/api/feedback/item', { permission: 'feedback', handler: async (body) => {
    const id = idOf(body);
    const checked = validatePatch(body);
    if ('field' in checked) throw fail(400, `无效的「${ADMIN_FIELDS[checked.field] || checked.field}」`);
    const old = store.get(id);
    if (!old) throw fail(404, '反馈不存在');
    const row = store.update(id, checked.patch, now());
    const changed = [];
    if (row.status !== old.status) changed.push(`状态 ${ADMIN_STATUSES[old.status]} → ${ADMIN_STATUSES[row.status]}`);
    if (row.reply !== old.reply) changed.push(row.reply ? '写入回复' : '清空回复');
    if (row.hidden !== old.hidden) changed.push(row.hidden ? '隐藏' : '取消隐藏');
    // The audit row has to name the direction, not just the action: "处理反馈" alone cannot tell a hide from an unhide.
    if (changed.length) await admin.commit(admin.state, { action: 'feedback', op: 'update', feedbackId: id, name: `#${id}`, reason: changed.join(' · ') });
    return { item: itemView(row, true) };
  } });
  admin.registerAdminRoute('/admin/api/feedback/delete', { permission: 'feedback', handler: async (body) => {
    const id = idOf(body);
    const row = store.get(id);
    if (!row || !store.remove(id)) throw fail(404, '反馈不存在');
    await admin.commit(admin.state, { action: 'feedback', op: 'delete', feedbackId: id, name: `#${id}`, reason: row.title });
    return { ok: true };
  } });
}

/**
 * Mounted on the game server under the /feedback prefix, so the board link in the game page works without a second
 * service or a reverse proxy (data/site.json → public/js/ui/siteBoards.js). Requests outside the prefix go back to the
 * listeners that were registered before, exactly like mountPlayerAdmin does. `admin` is optional: without it the page
 * still works, only the console tab is missing.
 */
export function mountFeedbackBoard({ server, admin = null, registerRoutes = true, ...options } = {}) {
  const service = createFeedbackServer(options);
  if (admin && registerRoutes) registerAdminRoutes(admin, service.store, { now: options.now });
  const prior = server.listeners('request');
  for (const listener of prior) server.off('request', listener);
  const listener = (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/feedback' || pathname.startsWith('/feedback/')) { void service.handle(req, res); return; }
    for (const fn of prior) fn.call(server, req, res);
  };
  server.on('request', listener);
  return { service, store: service.store, handle: service.handle, close: service.close, async unmount() {
    await service.close(); server.off('request', listener); for (const fn of prior) server.on('request', fn);
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const port = Number(env.FEEDBACK_PORT || 3150);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FEEDBACK_PORT');
  if (!env.FEEDBACK_ORIGIN) throw new Error('FEEDBACK_ORIGIN is required (e.g. https://ark-proto.stardust.matce.cn)');
  const service = createFeedbackServer({
    db: env.FEEDBACK_DB || '/data/feedback.sqlite', origin: env.FEEDBACK_ORIGIN,
    backupDir: env.FEEDBACK_BACKUP_DIR || null,
  });
  const host = env.FEEDBACK_HOST || '127.0.0.1';
  service.server.listen(port, host, () => console.log(`[feedback] listening on ${host}:${port}, ${service.visibleCount()} visible items, assets ${service.version}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    setTimeout(() => process.exit(1), 5000).unref();
    service.close().then(() => process.exit(0));
  });
}
