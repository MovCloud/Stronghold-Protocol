// Resolve only admitted appearances from the release manifest, never an arbitrary client-provided URL.
//
// docs/SKINS.md: an appearance lives on its OPERATOR — `chars[<charId>].skins[<skinKey>]` (the composed asset
// manifest, public/js/cosmetics.js) — the same record `assets.js` spineEntry / avatarUrl / portraitUrl / illustUrl
// resolve, so there is ONE place a skin is looked up and a second resolver cannot drift from it.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

/** The appearance record of `charId` under `skin`, or null — `chars[charId].skins[skin]`. */
export function appearanceEntry(manifest, charId, skin) {
  const id = str(charId), key = str(skin);
  if (!id || !key) return null;
  const chars = isObj(manifest) && isObj(manifest.chars) ? manifest.chars : null;
  const rec = chars && isObj(chars[id]) ? chars[id] : null;
  const skins = rec && isObj(rec.skins) ? rec.skins : null;
  return skins && isObj(skins[key]) ? skins[key] : null;
}

/** A chess record wearing this appearance: `{ ...record, skin }` when a skin is chosen, else the record itself. */
export function appearanceRecord(record, skin) {
  const key = str(skin);
  return record && key ? { ...record, skin: key } : record;
}

/** The appearance `record` wears from a `{ [charId]: skin }` selection (the server's player skins map). */
export function ownAppearance(record, priv) {
  const charId = record?.charId || record?.assets?.spine;
  const key = (isObj(priv?.skins) && str(charId) && str(priv.skins[charId])) || record?.skin || null;
  return appearanceRecord(record, key);
}
