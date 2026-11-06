import { jsonText } from '../gameData.js';
import { namespace } from '../../../shared/plugins/dataUtils.js';

export default {
  id: 'emotes', class: 'cosmetic', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, name }) {
    // [ASSUMED] One file = one wheel page (docs/PLUGINS.md §10c), so a new page starts with six empty cells.
    const slug = namespace(id);
    const page = { version: 1, name: name || id, sortId: 100000,
      emotes: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `emote_${slug}_${n}`, sortId: 1000 + n, picId: `pic_${n}`, label: `Emote ${n}` })) };
    return { manifest: { scope: ['room', 'personal'], emotes: ['emotes.json'] }, files: { 'emotes.json': jsonText(page) } };
  },
};
