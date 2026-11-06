// shared/announcements.js — ordinary announcements: public metadata and browser display rules.
// No Node builtins: the server, publishing tool and browser use the same allowlist and index shape.

export const ANNOUNCEMENT_INDEX_FILE = 'index.json';
export const ANNOUNCEMENT_MAX_TITLE_LENGTH = 120;
export const ANNOUNCEMENT_MAX_BODY_CHARS = 50000;
export const ANNOUNCEMENT_MAX_BODY_BYTES = 128 * 1024;
export const ANNOUNCEMENT_MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const ANNOUNCEMENT_MAX_ITEMS = 2000;

/** @typedef {{ id: string, title: string, publishedAt: string, revision: string }} AnnouncementMetadata */
/** @typedef {{ revision: string, pinnedId: string|null, items: AnnouncementMetadata[] }} AnnouncementIndex */

/** IDs are filenames on Windows too; never accept a path, extension or reserved device name. */
export function isAnnouncementId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
}

/** A publication has a persistent random revision, so a recreated directory cannot reuse a suppressed number. */
export function isAnnouncementRevision(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}

export function isAnnouncementTitle(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && [...value].length <= ANNOUNCEMENT_MAX_TITLE_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

/** The canonical public date format is shared by the writer and all readers. */
export function isAnnouncementPublishedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

/**
 * Validate untrusted HTTP metadata and return a copy with only the public fields, or null.
 * The items are in publication order, newest first; dates never determine this order or suppression.
 * The latest publication revision survives deletion, even if no articles remain.
 * @param {any} raw
 * @returns {AnnouncementIndex|null}
 */
export function readAnnouncementIndex(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.items)
    || raw.items.length > ANNOUNCEMENT_MAX_ITEMS) return null;
  const ids = new Set();
  const revisions = new Set();
  /** @type {AnnouncementMetadata[]} */
  const items = [];
  for (const item of raw.items) {
    if (!item || typeof item !== 'object' || !isAnnouncementId(item.id) || !isAnnouncementTitle(item.title)
      || !isAnnouncementRevision(item.revision) || ids.has(item.id) || revisions.has(item.revision)
      || !isAnnouncementPublishedAt(item.publishedAt)) return null;
    ids.add(item.id); revisions.add(item.revision);
    items.push({ id: item.id, title: item.title, publishedAt: item.publishedAt, revision: item.revision });
  }
  if ((items.length || raw.revision !== '') && !isAnnouncementRevision(raw.revision)) return null;
  if (raw.pinnedId !== null && (!isAnnouncementId(raw.pinnedId) || !ids.has(raw.pinnedId))) return null;
  return { revision: raw.revision, pinnedId: raw.pinnedId, items };
}

/** The single pinned announcement wins, otherwise the most recently published one. @param {AnnouncementIndex|null} index */
export function defaultAnnouncementId(index) {
  return index?.pinnedId || index?.items?.[0]?.id || null;
}

/** Display the pinned article first without changing the persisted publication order.
 * @param {Pick<AnnouncementIndex, 'items'|'pinnedId'>} index
 * @returns {AnnouncementMetadata[]}
 */
export function announcementHistoryItems(index) {
  const pinned = index.items.find((item) => item.id === index.pinnedId);
  return pinned ? [pinned, ...index.items.filter((item) => item.id !== pinned.id)] : index.items.slice();
}

/** Suppression lasts until another publication, independent of the date, selected article or pinned ID. */
export function shouldShowAnnouncements(index, dismissedRevision) {
  return !!index?.items?.length && isAnnouncementRevision(index.revision) && dismissedRevision !== index.revision;
}

// ---------------------------------------------------------------------------
// Admin-published notices (xinhai popup chain): scroll + popup schedules stored in config/announcements.json and
// broadcast as `site.announcement`. These exports share this module with the article index above; the two export
// sets never overlap (verified during the fork merge).
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_LEVELS = Object.freeze({ info: 0, warning: 1, urgent: 2 });
export const ANNOUNCEMENT_MAX_TEXT = 500;
export const POPUP_MAX_TEXT = 16000;
export const ANNOUNCEMENT_MAX_COUNT = 100;

const own = (obj, key) => Object.hasOwn(obj, key);
export function validAnnouncementUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; }
}

function displayOptions(row) {
  if (own(row, 'title') && (typeof row.title !== 'string' || !row.title.trim() || row.title.trim().length > 80
      || /[\u0000-\u001f\u007f]/.test(row.title))) throw new Error(`${row.id}: title must contain 1..80 printable characters`);
  if (own(row, 'url') && !validAnnouncementUrl(row.url)) throw new Error(`${row.id}: url must be an HTTP(S) URL without credentials`);
  if (own(row, 'autoPopup') && typeof row.autoPopup !== 'boolean') throw new Error(`${row.id}: autoPopup must be boolean`);
  if (own(row, 'format') && !['plain', 'markdown'].includes(row.format)) throw new Error(`${row.id}: format must be plain or markdown`);
  return { ...(own(row, 'title') ? { title: row.title.trim() } : {}),
    ...(own(row, 'url') ? { url: row.url } : {}), ...(own(row, 'autoPopup') ? { autoPopup: row.autoPopup } : {}),
    ...(own(row, 'format') ? { format: row.format } : {}) };
}

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
function validTime(value) {
  if (typeof value !== 'string' || !TIME.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}

const validText = (text, max) => typeof text === 'string' && !!text.trim() && [...text].length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);

/** The author's line breaks survive; runs of blank lines collapse to one; intra-line whitespace becomes single spaces. */
function normalizeText(text) {
  const lines = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/[\t\f\v ]+/g, ' ').trim();
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Only popup schedules may omit a boundary. Zero is stable across reload/restart, not a new start time. */
function popupSchedule(row) {
  const start = row.startAt == null ? 0 : validTime(row.startAt) ? Date.parse(row.startAt) : NaN;
  if (!Number.isFinite(start)) throw new Error(`${row.id}: startAt requires a valid ISO date with an explicit timezone`);
  let end = null;
  if (row.durationSeconds != null) {
    if (row.endAt != null) throw new Error(`${row.id}: use endAt or durationSeconds, not both`);
    if (row.startAt == null) throw new Error(`${row.id}: durationSeconds requires startAt (omit both for no expiry)`);
    if (!Number.isSafeInteger(row.durationSeconds) || row.durationSeconds < 1) throw new Error(`${row.id}: durationSeconds must be a positive integer`);
    end = start + row.durationSeconds * 1000;
  } else if (row.endAt != null) {
    end = validTime(row.endAt) ? Date.parse(row.endAt) : NaN;
  }
  if (end !== null && (!Number.isFinite(end) || !Number.isFinite(new Date(end).getTime()) || end <= start)) {
    throw new Error(`${row.id}: endAt must be a valid time after startAt`);
  }
  return { startAt: start, endAt: end };
}

/** Validate the whole document atomically: a half-written edit never replaces the last valid schedule. */
export function parseAnnouncements(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.announcements)
      || doc.announcements.length > ANNOUNCEMENT_MAX_COUNT) throw new Error('announcements must be an array of at most 100 entries');
  const ids = new Set();
  return doc.announcements.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid announcement');
    const { id, text, startAt, durationSeconds, level = 'info', enabled = true, type = 'scroll' } = row;
    if (type !== 'scroll' && type !== 'popup') throw new Error(`${id}: type must be scroll or popup`);
    const options = displayOptions(row);
    if (type === 'scroll' && (own(row, 'url') || own(row, 'autoPopup') || own(row, 'format') || own(row, 'endAt'))) {
      throw new Error(`${id}: url, autoPopup, format and endAt are only supported for popup announcements`);
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('announcement ids must be unique (1..64 letters, numbers, _ or -)');
    ids.add(id);
    const max = type === 'popup' ? POPUP_MAX_TEXT : ANNOUNCEMENT_MAX_TEXT;
    if (!validText(text, max)) throw new Error(`${id}: text must contain 1..${max} printable characters`);
    let schedule;
    if (type === 'popup') schedule = popupSchedule(row);
    else {
      if (!validTime(startAt)) throw new Error(`${id}: startAt requires a valid ISO date with an explicit timezone`);
      if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) throw new Error(`${id}: durationSeconds must be 1..86400`);
      const at = Date.parse(startAt);
      schedule = { startAt: at, endAt: at + durationSeconds * 1000 };
    }
    if (typeof level !== 'string' || !own(ANNOUNCEMENT_LEVELS, level) || typeof enabled !== 'boolean') throw new Error(`${id}: invalid level or enabled flag`);
    return { id, ...(type === 'popup' ? { type } : {}), ...options,
      // Local file bodies (server popupTextFiles) and Markdown stay verbatim (CRLF folded to LF) — whitespace is
      // author-controlled; plain inline text is the normalized, line-based display form.
      text: options.format === 'markdown' ? text.replace(/\r\n?/g, '\n')
        : row.verbatim === true ? text : normalizeText(text),
      ...schedule, level, enabled };
  });
}

export function announcementLive(notice, now) {
  return !!notice && Number.isFinite(now) && Number.isFinite(notice.startAt) && notice.startAt <= now
    && (notice.type === 'popup' && notice.endAt === null
      || Number.isFinite(notice.endAt) && now < notice.endAt);
}

/** Higher severity first; earliest start first among equals. Original file order breaks exact ties. */
export function activeAnnouncement(rows, now, type = 'scroll') {
  let best = null;
  for (const row of rows) {
    if ((row.type || 'scroll') !== type || !row.enabled || !announcementLive(row, now)) continue;
    if (!best || ANNOUNCEMENT_LEVELS[row.level] > ANNOUNCEMENT_LEVELS[best.level]
        || (row.level === best.level && row.startAt < best.startAt)) best = row;
  }
  if (!best) return null;
  const { enabled, ...notice } = best;
  return notice;
}

/** Incoming public frame: accept only display fields; expiry is checked independently by the UI. */
export function announcementFromMessage(msg, type = 'scroll') {
  const n = type === 'popup' ? msg?.popupAnnouncement : msg?.announcement;
  if (!n || typeof n.id !== 'string' || !validText(n.text, type === 'popup' ? POPUP_MAX_TEXT : ANNOUNCEMENT_MAX_TEXT)
      || typeof n.level !== 'string' || !own(ANNOUNCEMENT_LEVELS, n.level) || !Number.isFinite(n.startAt)
      || !(type === 'popup' && n.endAt === null || Number.isFinite(n.endAt) && n.endAt > n.startAt)
      || (n.type || 'scroll') !== type) return null;
  try {
    if (type === 'scroll' && (own(n, 'url') || own(n, 'autoPopup') || own(n, 'format'))) return null;
    return { id: n.id, ...(type === 'popup' ? { type } : {}), ...displayOptions(n), text: n.text, level: n.level, startAt: n.startAt, endAt: n.endAt };
  } catch { return null; }
}
