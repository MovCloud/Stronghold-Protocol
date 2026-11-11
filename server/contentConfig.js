// server/contentConfig.js — the two runtime documents behind the 内容管理 panel (docs/CONTENT-ADMIN.md): which
// versions the server enables, and the wild-mode selection. Both are read once at boot, so a change takes effect
// after a restart — the panel says so. Everything here is data + rules: no HTTP, no audit, no file IO. The panel
// (server/playerAdmin.js) owns the session, the atomic write and the audit log; the generator reads the documents.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../shared/i18n.js';
import { payloadFingerprint } from './roomConfig.js';
import { VERSIONS } from '../shared/versions.js';
import { isSkinId } from '../shared/skins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** runtime/ holds the admin's runtime configuration; the panel creates it on the first write. */
export const RUNTIME_DIR = path.join(ROOT, 'runtime');
export const VERSIONS_FILE = 'versions.json';
export const WILD_FILE = 'wild.json';
/** 皮肤管理 (docs/CONTENT-ADMIN.md §9): the skins the admin has stopped offering. */
export const SKINS_FILE = 'skins.json';

export const SCHEMA_VERSION = 1;
/** A pick is one of: the newest source that provides the row, the row is not in the wild set, or a given source. */
export const PICK_AUTO = 'auto';
export const PICK_OFF = 'off';
/** The single-choice tables (§4.1). The operator matrix is not a pick table and has its own shape. */
export const PICK_TYPES = Object.freeze(['bonds', 'bands', 'items']);

/** A version id may carry '@' (act2autochess@V2_1); a content id is a data key (bondId, bandId, charId). */
const ID = /^[A-Za-z0-9_@-]{1,40}$/;
/** 皮肤管理 (§9): the gate's limits — the official table is 174 chars / 273 skins, the numbers leave room for packs. */
export const SKIN_GATE_LIMITS = Object.freeze({ chars: 256, skins: 512 });

export function registryIds(registered = VERSIONS) { return registered.map((v) => v.id); }

/** No file = the default (§2): every registered version, in registry order (newest first). */
export function defaultVersions(ids = registryIds()) {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, lastFingerprint: null, enabled: [...ids] };
}

/** No file = the default (§3): every registered version is a source and nothing is selected. */
export function defaultWild(ids = registryIds()) {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, lastFingerprint: null, sources: [...ids],
    picks: { bonds: {}, bands: {}, items: {} }, operators: {} };
}

function badId(value, what, errors) {
  if (!ID.test(String(value ?? ''))) { errors.push(`${what} ${value}`); return false; }
  return true;
}

export function validateVersions(doc, ids) {
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(t('内容配置的 schemaVersion 需为 1'));
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push(t('内容配置的 revision 需为非负整数'));
  if (!Array.isArray(doc.enabled)) { errors.push(t('启用的版本需为一个数组')); return errors; }
  if (!doc.enabled.length) errors.push(t('至少需要保留一个启用的版本'));
  const seen = new Set();
  for (const id of doc.enabled) {
    if (!badId(id, t('未知的版本'), errors)) continue;
    if (!ids.includes(id)) errors.push(`${t('未知的版本')} ${id}`);
    if (seen.has(id)) errors.push(`${t('启用的版本中有重复')} ${id}`);
    seen.add(id);
  }
  return errors;
}

export function validateWild(doc, ids, membership = null) {
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(t('内容配置的 schemaVersion 需为 1'));
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push(t('内容配置的 revision 需为非负整数'));
  if (!Array.isArray(doc.sources)) { errors.push(t('狂野模式的来源需为一个数组')); return errors; }
  if (!doc.sources.length) errors.push(t('狂野模式至少需要一个来源版本'));
  const seen = new Set();
  for (const id of doc.sources) {
    if (!badId(id, t('未知的版本'), errors)) continue;
    if (!ids.includes(id)) errors.push(`${t('未知的版本')} ${id}`);
    if (seen.has(id)) errors.push(`${t('狂野模式的来源中有重复')} ${id}`);
    seen.add(id);
  }
  if (typeof doc.picks !== 'object' || doc.picks === null) errors.push(t('picks 需为一个对象'));
  else {
    for (const [type, table] of Object.entries(doc.picks)) {
      if (!PICK_TYPES.includes(type)) { errors.push(`${t('未知的内容类型')} ${type}`); continue; }
      if (typeof table !== 'object' || table === null) { errors.push(`${type} ${t('需为一个对象')}`); continue; }
      for (const [rowId, pick] of Object.entries(table)) {
        if (!badId(rowId, type, errors)) continue;
        if (pick !== PICK_AUTO && pick !== PICK_OFF && !seen.has(pick)) {
          errors.push(`${type} ${rowId} ${t('只能选自动、关闭或来源中的版本')}`);
          continue;
        }
        if (!membership) continue;
        const row = membership.get(`${type}:${rowId}`);
        if (!row) { errors.push(`${type} ${rowId} ${t('不在任何来源中')}`); continue; }
        if (pick !== PICK_AUTO && pick !== PICK_OFF && !row.has(pick)) errors.push(`${type} ${rowId} ${t('在')} ${pick} ${t('中不存在')}`);
      }
    }
  }
  if (typeof doc.operators !== 'object' || doc.operators === null) errors.push(t('operators 需为一个对象'));
  else {
    for (const [charId, row] of Object.entries(doc.operators)) {
      if (!badId(charId, t('干员'), errors)) continue;
      if (!Array.isArray(row?.off)) { errors.push(`operators ${charId} ${t('需为一个数组')}`); continue; }
      for (const cell of row.off) {
        const [versionId, bondId] = String(cell).split(':');
        if (!ID.test(versionId) || !ID.test(bondId)) { errors.push(`operators ${charId} ${t('格子无效')} ${cell}`); continue; }
        if (!seen.has(versionId)) { errors.push(`operators ${charId} ${t('格子指向不在来源中的版本')} ${versionId}`); continue; }
        if (!membership) continue;
        const cells = membership.get(`operators:${charId}`);
        if (!cells) { errors.push(`operators ${charId} ${t('不在任何来源中')}`); continue; }
        if (!cells.has(`${versionId}:${bondId}`)) errors.push(`operators ${charId} ${t('在')} ${versionId} ${t('没有盟约')} ${bondId}`);
      }
    }
  }
  return errors;
}

/** The patch is applied to a copy: a null value removes the entry, which puts the row back to auto. */
export function applyWildPatch(doc, patch) {
  const next = { ...doc, picks: {}, operators: {} };
  for (const type of PICK_TYPES) next.picks[type] = { ...(doc.picks?.[type] ?? {}) };
  for (const [charId, row] of Object.entries(doc.operators ?? {})) next.operators[charId] = { off: [...(row?.off ?? [])] };
  if (patch.sources !== undefined) next.sources = Array.isArray(patch.sources) ? [...patch.sources] : patch.sources;
  for (const type of PICK_TYPES) {
    for (const [rowId, value] of Object.entries(patch.picks?.[type] ?? {})) {
      if (value === null) delete next.picks[type][rowId]; else next.picks[type][rowId] = value;
    }
  }
  for (const [charId, row] of Object.entries(patch.operators ?? {})) {
    if (row === null) delete next.operators[charId]; else next.operators[charId] = { off: [...(row?.off ?? [])] };
  }
  return next;
}

/**
 * The 版本管理 card (§2): `enabled` is the whole set the panel sends, not a delta. Order is kept as sent — the panel
 * sends registry order — and the generator reads the first entry as the newest.
 * @param {{ doc: object|null, raw: string|undefined }} current
 * @param {{ enabled?: string[], expectedRevision?: number }} body
 * @param {{ ids: readonly string[] }} ctx
 */
export function versionsMutation(current, body = {}, { ids } = {}) {
  const doc = current.doc ?? defaultVersions(ids);
  if (!Array.isArray(body.enabled)) return { ok: false, errors: [t('启用的版本需为一个数组')] };
  const patch = { enabled: body.enabled };
  const fingerprint = payloadFingerprint(patch);
  if (fingerprint === doc.lastFingerprint) return { ok: true, changed: false, document: doc, fingerprint };
  if (body.expectedRevision !== undefined && body.expectedRevision !== doc.revision)
    return { ok: false, cas: true, revision: doc.revision, errors: [t('内容配置已被其他操作修改，请刷新后再试')] };
  const errors = validateVersions({ ...doc, enabled: patch.enabled }, ids);
  if (errors.length) return { ok: false, errors };
  return { ok: true, changed: true, fingerprint,
    document: { ...doc, revision: doc.revision + 1, lastFingerprint: fingerprint, enabled: [...patch.enabled] } };
}

/**
 * The 狂野模式 card (§3): `patch` is a delta over the document, so a row the panel did not touch keeps its value.
 * @param {{ doc: object|null, raw: string|undefined }} current
 * @param {{ patch?: object, expectedRevision?: number }} body
 * @param {{ ids: readonly string[], membership?: Map<string, Set<string>>|null }} ctx
 */
export function wildMutation(current, body = {}, { ids, membership = null } = {}) {
  const doc = current.doc ?? defaultWild(ids);
  const patch = body.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, errors: [t('patch 需为一个对象')] };
  const fingerprint = payloadFingerprint(patch);
  if (fingerprint === doc.lastFingerprint) return { ok: true, changed: false, document: doc, fingerprint };
  if (body.expectedRevision !== undefined && body.expectedRevision !== doc.revision)
    return { ok: false, cas: true, revision: doc.revision, errors: [t('内容配置已被其他操作修改，请刷新后再试')] };
  const next = applyWildPatch(doc, patch);
  const errors = validateWild(next, ids, membership);
  if (errors.length) return { ok: false, errors };
  return { ok: true, changed: true, fingerprint,
    document: { ...next, revision: doc.revision + 1, lastFingerprint: fingerprint } };
}

/**
 * The two batch presets (§4.3), over the rows the panel currently shows — a preset never touches a row the operator
 * has filtered out. `rows` is one table's filtered rows (operators carry their `cells`).
 * - `pin`: every conflicting row the version provides takes that version.
 * - `exclude`: the version's contribution is taken out — a row only it provides goes off, a shared row takes the
 *   newest of the other sources.
 * @param {Record<string, Array<{ id: string, versions: string[], cells?: Record<string, string[]> }>>} rows
 * @param {{ preset: 'pin' | 'exclude', version: string, order: string[] }} o `order` is newest first
 */
export function presetPatch(rows = {}, { preset, version, order = [] } = {}) {
  if (preset !== 'pin' && preset !== 'exclude') return null;
  const patch = { picks: {}, operators: {} };
  for (const type of PICK_TYPES) {
    if (!Array.isArray(rows[type]) || !rows[type].length) continue;
    patch.picks[type] = {};
    for (const row of rows[type]) {
      if (!row.versions.includes(version)) continue;
      if (preset === 'pin') {
        if (row.versions.length < 2) continue;
        patch.picks[type][row.id] = version;
      } else if (row.versions.length < 2) patch.picks[type][row.id] = PICK_OFF;
      else patch.picks[type][row.id] = order.find((id) => id !== version && row.versions.includes(id)) ?? PICK_AUTO;
    }
  }
  for (const row of rows.operators ?? []) {
    if (!row.versions.includes(version)) continue;
    if (preset === 'pin' && row.versions.length < 2) continue;
    const off = [];
    for (const [versionId, bonds] of Object.entries(row.cells ?? {})) {
      const keep = preset === 'pin' ? versionId === version : versionId !== version;
      if (!keep) for (const bondId of bonds) off.push(`${versionId}:${bondId}`);
    }
    patch.operators[row.id] = { off };
  }
  if (!Object.keys(patch.picks).some((t0) => Object.keys(patch.picks[t0]).length)) delete patch.picks;
  if (!Object.keys(patch.operators).length) delete patch.operators;
  return patch;
}

/** A plain object (the runtime documents never accept an array or a prototype-backed value). */
function plainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** No file = the default (§9): every skin is offered. */
export function defaultSkins() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, lastFingerprint: null, disabled: {} };
}

/**
 * The gate document. Only the shape is checked, not membership: a plugin skin can disappear with its pack and the gate
 * has to survive that exactly as a stored registry choice does (shared/skins.js), so an id the panel could not have
 * produced is still a valid key. An empty list is the same as no entry at all.
 */
export function validateSkins(doc) {
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(t('内容配置的 schemaVersion 需为 1'));
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push(t('内容配置的 revision 需为非负整数'));
  if (!plainObject(doc.disabled)) { errors.push(t('皮肤停用表需为一个对象')); return errors; }
  let skins = 0;
  for (const [charId, list] of Object.entries(doc.disabled)) {
    if (!badId(charId, t('干员'), errors)) continue;
    if (!Array.isArray(list)) { errors.push(`skins ${charId} ${t('需为一个数组')}`); continue; }
    const seen = new Set();
    for (const skinId of list) {
      if (!isSkinId(skinId)) { errors.push(`skins ${charId} ${t('皮肤 id 无效')} ${skinId}`); continue; }
      if (seen.has(skinId)) { errors.push(`skins ${charId} ${t('皮肤重复')} ${skinId}`); continue; }
      seen.add(skinId);
      skins++;
    }
  }
  if (Object.keys(doc.disabled).length > SKIN_GATE_LIMITS.chars) errors.push(`${t('皮肤停用表最多')} ${SKIN_GATE_LIMITS.chars} ${t('个干员')}`);
  if (skins > SKIN_GATE_LIMITS.skins) errors.push(`${t('皮肤停用表最多')} ${SKIN_GATE_LIMITS.skins} ${t('个皮肤')}`);
  return errors;
}

/**
 * The 皮肤管理 card (§9): `disabled` is the whole map the panel sends, not a delta — a skin the panel leaves out is
 * offered, so the save reads as "these are the skins that stay off". Empty lists are dropped, which keeps the
 * document the same shape the gate reads.
 * @param {{ doc: object|null, raw: string|undefined }} current
 * @param {{ disabled?: Record<string, string[]>, expectedRevision?: number }} body
 */
export function skinsMutation(current, body = {}) {
  const doc = current.doc ?? defaultSkins();
  if (!plainObject(body.disabled)) return { ok: false, errors: [t('皮肤停用表需为一个对象')] };
  const patch = Object.fromEntries(Object.entries(body.disabled)
    .filter(([, list]) => Array.isArray(list) && list.length)
    .map(([charId, list]) => [charId, [...list]]));
  const fingerprint = payloadFingerprint({ disabled: patch });
  if (fingerprint === doc.lastFingerprint) return { ok: true, changed: false, document: doc, fingerprint };
  if (body.expectedRevision !== undefined && body.expectedRevision !== doc.revision)
    return { ok: false, cas: true, revision: doc.revision, errors: [t('内容配置已被其他操作修改，请刷新后再试')] };
  const next = { ...doc, disabled: patch };
  const errors = validateSkins(next);
  if (errors.length) return { ok: false, errors };
  return { ok: true, changed: true, fingerprint,
    document: { ...next, revision: doc.revision + 1, lastFingerprint: fingerprint } };
}
