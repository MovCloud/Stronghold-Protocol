// 设置 → 皮肤工坊 (P6 §3.4): assemble the built-in local skin plugin (`local`) in this browser — pick pictures for the
// slots of ONE skin (and, with the 动态（Spine） switch, the .skel/.atlas/page files of ONE Spine group — the
// product's dynamic art is Spine skeletal animation, P6 §3.3), choose its operator and name it, and register the
// whole thing through the page's own skin gate (public/js/skinRegistry.js register; the page's manifest view
// data.get('assets') is what the charIds are checked against, a rejection is said here line by line). The bytes and
// the document never leave the browser: the files go into the verified object cache the folder import seeds
// (skinWorkshop.js storeSkinFiles), the document is kept like the personal cosmetic plugins' choice
// (sp.pref.localSkins) and content.js registers it again on the next page load. Deleting a skin unregisters its one
// entry (wearers fall back to the operator's own art) and drops its files. Only this player sees any of it; a battle
// reads data, never art.
import { useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, TextField, confirmDialog } from './components.js';
import { useData, data } from '../data.js';
import { useStore } from '../store.js';
import { toast } from './toasts.js';
import { t, N_ } from '../../../shared/i18n.js';
import {
  localSkins, LOCAL_PLUGIN_ID, SKIN_SLOTS, inferSlot, safeFileName, storeSkinFiles, pairSpineGroup, spinePayloadOf,
  buildSkinEntry, docEntryOf, addDocSkin, removeDocSkin, deleteSkinFiles,
} from '../skinWorkshop.js';
import { register, unregisterSkin, globalSkinKey } from '../skinRegistry.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The staged files that are Spine parts once the dynamic switch is on (never picture slots). */
const isSkelName = (name) => /\.skel$/i.test(String(name ?? ''));
const isAtlasName = (name) => /\.atlas$/i.test(String(name ?? ''));
/** The row label of a staged Spine part. */
const spinePartLabel = (name) => (isSkelName(name) ? N_('骨骼（.skel）') : isAtlasName(name) ? N_('图集（.atlas）') : N_('页图'));

/** The slot names the form offers (docs/SKINS.md's picture slots, the manifest's own field names). */
const SLOT_LABELS = {
  avatar: N_('头像'), avatarE2: N_('头像（精英二）'), portrait: N_('半身像'), portraitE2: N_('半身像（精英二）'), illust: N_('立绘'),
};

/**
 * The settings section (laid out like 素材存储 above it): the upload form, the note line (a rejection's reasons, a
 * success), and one row per registered skin with its delete.
 */
export function SkinWorkshopSection() {
  const settled = useData('assets');
  const doc = useStore((s) => s.skins, Object.is, localSkins);
  const [staged, setStaged] = useState([]); // { file, slot } — one row per picked file until uploaded (slot null = a Spine part)
  const [charId, setCharId] = useState('');
  const [skinId, setSkinId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [spineOn, setSpineOn] = useState(false); // the 动态（Spine） switch: one .skel + .atlas + its pages per skin
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { kind: 'ok' | 'warn', text }
  const manifest = settled ? data.get('assets') : null;
  const chars = manifest && isObj(manifest.chars) ? Object.entries(manifest.chars).filter(([, c]) => isObj(c)) : [];
  const charName = (id) => chars.find(([key]) => key === id)?.[1]?.name || id;
  const isSpinePart = (file) => spineOn && (isSkelName(file.name) || isAtlasName(file.name));

  const pick = (e) => {
    const picked = [...(e.currentTarget.files || [])]
      .map((file) => ({ file, slot: isSpinePart(file) ? null : inferSlot(file.name) }));
    e.currentTarget.value = ''; // the same folder can be picked again
    if (picked.length) setStaged([...staged, ...picked]);
  };
  const restage = (at, slot) => setStaged(staged.map((f, i) => (i === at ? { ...f, slot } : f)));
  const unstage = (at) => setStaged(staged.filter((_, i) => i !== at));
  const toggleSpine = (on) => {
    setSpineOn(on);
    // the switch off leaves no Spine parts staged (they are not pictures; the next submit starts fresh)
    if (!on) setStaged(staged.filter((f) => f.slot !== null));
  };

  const submit = async () => {
    if (busy) return;
    if (!manifest) { setNote({ kind: 'warn', text: t('素材清单尚未载入，载入后才能选择归属干员。') }); return; }
    if (!charId) { setNote({ kind: 'warn', text: t('先选择归属干员。') }); return; }
    if (!skinId.trim()) { setNote({ kind: 'warn', text: t('先给这套皮肤起一个皮肤 ID（只用字母、数字和 _ - + . @ #）。') }); return; }
    if (!staged.length) { setNote({ kind: 'warn', text: t('先选择至少一张图片。') }); return; }
    setBusy(true);
    setNote(null);
    try {
      // the dynamic switch: the Spine group must be complete BEFORE anything is stored — one .skel, one same-name
      // .atlas and every page image it names, or the whole submission is refused here (nothing registered, nothing
      // written to the object cache)
      let group = null;
      if (spineOn) {
        const entries = await Promise.all(staged.map(async (f) => ({
          name: safeFileName(f.file.name),
          text: isAtlasName(f.file.name) ? await f.file.text() : null,
        })));
        const pair = pairSpineGroup(entries);
        if (!pair.ok) { setNote({ kind: 'warn', text: t('骨骼组不完整：{reason}', { reason: pair.reason }) }); return; }
        group = pair;
      }
      const stored = await storeSkinFiles(staged.map((f) => f.file),
        { slots: staged.map((f) => f.slot), spine: group && { skel: group.skel, atlas: group.atlas, pages: group.pages } });
      const entry = buildSkinEntry({
        charId, skinId: skinId.trim(), displayName: displayName.trim(),
        spine: group ? spinePayloadOf(group, stored) : null,
      }, stored);
      // the whole-plugin gate: a rejection leaves nothing registered and the document untouched
      const r = register(LOCAL_PLUGIN_ID, [entry], { manifest });
      if (!r.ok) { setNote({ kind: 'warn', text: t('皮肤没有注册：') + r.reasons.join('；') }); return; }
      localSkins.set({ skins: addDocSkin(doc, docEntryOf(entry, stored)) });
      setStaged([]);
      setSkinId('');
      setDisplayName('');
      setNote({ kind: 'ok', text: t('已注册 {key}，在干员详情的「外观」里选择它。', { key: globalSkinKey(LOCAL_PLUGIN_ID, entry.skinId) }) });
    } catch (err) {
      console.warn('[skinWorkshop] the files could not be stored', err);
      setNote({ kind: 'warn', text: t('文件未能保存到这个浏览器，请重试。') });
    } finally { setBusy(false); }
  };

  const remove = async (rec) => {
    const ok = await confirmDialog({
      title: t('删除皮肤'),
      text: t('删除「{name}」和它的图片文件；正在使用它的位置显示该干员的原版素材。', { name: rec.displayName }),
      okText: t('删除'),
    });
    if (!ok) return;
    unregisterSkin(LOCAL_PLUGIN_ID, rec.skinId);
    localSkins.set({ skins: removeDocSkin(doc, rec.skinId) });
    const gone = await deleteSkinFiles(rec);
    if (!gone) toast(t('图片文件已不在浏览器缓存里，皮肤记录已删除。'), 'info');
  };

  return html`<section class="set-workshop" aria-labelledby="set-workshop-title" data-testid="skin-workshop">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-workshop-title">${t('皮肤工坊')}<${MicroLabel}>SKIN WORKSHOP<//></span>
    </div>
    <p class="set-hint">${t('把自己的立绘、头像上传为「本地皮肤」：只在这个浏览器生效，不影响其他博士，也不改变属性。每次一套皮肤：选择归属干员、起皮肤 ID，并为每张图选择对应槽位。开启「动态」可一并上传 Spine 骨骼（.skel + .atlas + 页图），预览时播放动态立绘，失败自动回退静态图。')}</p>
    <div class="set-workshop__form">
      <div class="set-workshop__row">
        <span class="set-workshop__field">
          <label class="set-workshop__label" for="skin-workshop-char">${t('归属干员')}</label>
          <select id="skin-workshop-char" data-testid="skin-workshop-char" disabled=${busy || !chars.length} value=${charId}
            onChange=${(e) => setCharId(e.currentTarget.value)}>
            <option value="">${t('选择干员')}</option>
            ${chars.map(([id, c]) => html`<option key=${id} value=${id}>${c.name || id} · ${id}</option>`)}
          </select>
        </span>
        <${TextField} label=${t('皮肤 ID')} micro="SKIN ID" value=${skinId} maxLength=${64} disabled=${busy}
          placeholder="my_amiya_dusk" onInput=${setSkinId} />
        <${TextField} label=${t('皮肤名称')} micro="NAME" value=${displayName} maxLength=${64} disabled=${busy}
          placeholder=${t('黄昏制服')} onInput=${setDisplayName} />
      </div>
      <label class="set-workshop__pick">
        <input type="checkbox" data-testid="skin-workshop-spine" disabled=${busy} checked=${spineOn} onChange=${(e) => toggleSpine(e.currentTarget.checked)} />
        <span>${t('动态（Spine）')}</span>
      </label>
      <label class="set-workshop__pick">
        <input type="file" accept="image/*,.skel,.atlas" multiple data-testid="skin-workshop-file" disabled=${busy} onChange=${pick} />
        <span>${spineOn ? t('选择文件（骨骼 .skel + 图集 .atlas + 页图，或图片；可多选）') : t('选择图片（可多选）')}</span>
      </label>
      ${staged.map((f, at) => html`<div key=${at + f.file.name} class="set-workshop__file">
        <span>${f.file.name}</span>
        ${f.slot === null ? html`<em class="set-workshop__part">${t(spinePartLabel(f.file.name))}</em>`
          : html`<select aria-label=${t('槽位')} disabled=${busy} value=${f.slot} onChange=${(e) => restage(at, e.currentTarget.value)}>
            ${SKIN_SLOTS.map((slot) => html`<option key=${slot} value=${slot}>${t(SLOT_LABELS[slot])}</option>`)}
          </select>`}
        <${Button} variant="ghost" size="sm" disabled=${busy} onClick=${() => unstage(at)}>${t('移除')}<//>
      </div>`)}
      <div class="set-workshop__row">
        <${Button} variant="primary" size="sm" data-testid="skin-workshop-submit" disabled=${busy || !staged.length}
          loading=${busy} onClick=${submit}>${t('上传并注册')}<//>
      </div>
    </div>
    ${note ? html`<p class=${note.kind === 'warn' ? 'set-keys__note is-warn' : 'set-keys__note'} role="status" aria-live="polite"
      data-testid="skin-workshop-note">${note.text}</p>` : null}
    ${doc.length ? html`<div class="set-workshop__skins" data-testid="skin-workshop-list">
      ${doc.map((rec) => html`<div key=${rec.skinId} class="set-workshop__file" data-skin=${rec.skinId}>
        <span><b>${rec.displayName}</b> · ${globalSkinKey(LOCAL_PLUGIN_ID, rec.skinId)} · ${t('{char}（{id}）', { char: charName(rec.charId), id: rec.charId })}${rec.spine ? t(' · 动态') : ''}</span>
        <${Button} variant="ghost" size="sm" data-testid="skin-workshop-delete" disabled=${busy} onClick=${() => remove(rec)}>${t('删除')}<//>
      </div>`)}
    </div>` : null}
  </section>`;
}
