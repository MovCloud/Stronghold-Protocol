// Display-only operator choices, persisted separately from skill/module and DIY gameplay configuration.
// docs/SKINS.md: the choices are `{ [charId]: skin }` pairs of non-empty strings (the manifest's own skin keys), so
// validation is the shared `parseStoredSkins` (SKIN_LIMITS.entries) — a catalogue cannot know every plugin's keys.
import { parseStoredSkins as cleanSkins } from './skins.js';
import { N_ } from '../../../shared/i18n.js';
export const SKINS_PREF = 'skins';
export const SKINS_VERSION = 1;
export const SKINS_IMPORT_MAX_BYTES = 256 * 1024;
export const SKINS_EXPORT_KIND = 'stronghold.skins';
export const parseStoredSkins = raw => cleanSkins(raw?.v === SKINS_VERSION ? raw.choices : null);
export const toStoredSkins = choices => ({ v: SKINS_VERSION, choices: cleanSkins(choices) });
export function setSkinChoice(choices, charId, skin) {
  const id = typeof charId === 'string' && charId ? charId : null;
  if (!id) return cleanSkins(choices);
  const next = cleanSkins(choices);
  delete next[id];
  if (typeof skin === 'string' && skin) next[id] = skin;
  return next;
}
export function serializeSkins(choices) {
  return JSON.stringify({ kind: SKINS_EXPORT_KIND, ...toStoredSkins(choices) }, null, 2);
}
export function parseSkinImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > SKINS_IMPORT_MAX_BYTES) return { ok: false, error: N_('内容过长，无法导入') };
    try { raw = JSON.parse(raw); } catch { return { ok: false, error: N_('无法识别的内容') }; }
  }
  if (!raw || raw.kind !== SKINS_EXPORT_KIND || raw.v !== SKINS_VERSION || !raw.choices || typeof raw.choices !== 'object' || Array.isArray(raw.choices)) {
    return { ok: false, error: N_('这不是当前版本的干员外观配置') };
  }
  const choices = cleanSkins(raw.choices);
  const asked = Object.keys(raw.choices).length, kept = Object.keys(choices).length;
  if (asked && !kept) return { ok: false, error: N_('这份配置没有当前版本可用的时装，未做任何改动') };
  return { ok: true, choices, dropped: asked - kept };
}
