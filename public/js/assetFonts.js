// Load the shipped fonts from the served manifest so imported copies work on HTTP too.
// ArrayBuffer FontFace sources need neither blob URLs nor broader font-src CSP rules.
// The pack gate is the same one the other loaders use: a font pack proven absent is not requested again. (CSS
// @font-face in public/fonts/fonts.css cannot consult this table — that is the documented permanent exemption.)
import { assetFetch } from './importedAssets.js';
import { resolve } from './resourcePacks.js';

export async function installAssetFonts(manifest, { document: doc = globalThis.document,
  FontFace: Face = globalThis.FontFace, fetch: fetcher = assetFetch } = {}) {
  if (!Face || !doc?.fonts) return;
  await Promise.all(Object.values(manifest?.fonts?.faces || {}).map(async record => {
    if (!record?.family) return;
    for (const url of [...new Set([record.woff2, record.original].filter(Boolean))]) {
      if (resolve(url).state === 'missing') continue;
      try {
        const response = await fetcher(url);
        if (!response.ok) continue;
        const face = new Face(record.family, await response.arrayBuffer(), {
          weight: String(record.weight || 400), style: 'normal', display: 'swap',
        });
        await face.load();
        doc.fonts.add(face);
        break;
      } catch { /* try the original format, then keep the existing system-font fallback */ }
    }
  }));
}
