import { msg, t } from '../../shared/i18n.js';
import { versionById } from '../../shared/versions.js';

const $ = selector => document.querySelector(selector);
const state = { csrf: null, tab: 'players', offset: 0, snapshot: null, action: null, generation: 0, loading: false,
  feedback: null, feedbackPages: [null], feedbackIndex: 0 };
const statusNames = { playing: '正在对局', disconnected: '离线留席', matching: '等待匹配', spectating: '观战中', waiting: '房间等待', lobby: '大厅' };
const difficultyNames = { FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟' };
const phaseNames = { INFO_CHECK: '开局确认', BAND_DRAFT: '策略选择', PREP: '整备', COMBAT: '作战', UNITE: '联防', SETTLE: '结算', CHOICE: '机变', RESULT: '结束', LOBBY: '等待' };
const actionNames = { kick: '踢出玩家', ban: '封禁玩家', unban: '解除封禁', announcement: '发布公告', stopAnnouncement: '结束公告', deleteAnnouncement: '删除公告', maintenance: '维护模式', restart: '重启服务器', arcade: '娱乐模式', pack: '资源包开关', passwordChanged: '修改管理密码', feedback: '处理反馈' };
const modeNames = { solo: '单人对局', coop: '多人对局' };
const roomStatusNames = { disposed: '已解散', match: '对局中', matching: '等待匹配', waiting: '等待开局' };
const maintenanceNames = { running: '运行中', maintenance: '维护中', pending: '切换中…', unreachable: '停机中' };
const scopeNames = { session: '会话', browser: '同一浏览器', ip: '公网 IP' };
// Maintenance is a toggle, so the same action name covers two opposite operations; the record carries the
// direction as a boolean, which is the only way to tell "enabled" from "disabled" apart.
const actionLabel = item => item.action === 'maintenance' ? (item.maintenance ? '启用维护模式' : '停用维护模式')
  : item.action === 'feedback' ? (item.op === 'delete' ? '删除反馈' : '处理反馈')
  : item.action === 'arcade' ? `${item.open ? '开放' : '停用'}娱乐模式 · ${item.name || item.mode || ''}`
  : item.action === 'pack' ? `${item.enabled ? '启用' : '停用'}资源包 · ${item.packId || ''}`
  : (actionNames[item.action] || item.action);
const tabTitles = { players: '玩家状态', matches: '对局列表', bans: '封禁管理', announcements: '服务器公告', arcade: '娱乐模式', packs: '资源管理', content: '内容管理', feedback: '玩家反馈', audit: '操作记录' };
// The feedback board's own vocabulary (deploy/stardust/feedback/policy.mjs); the pill classes reuse the player table's.
const feedbackCategoryNames = { bug: '缺陷', gameplay: '玩法', ui: '界面', other: '其他' };
const feedbackStatusNames = { unassigned: '待处理', unplanned: '暂不规划', planned: '已规划', updated: '已更新' };
const feedbackPillClass = { unassigned: 'waiting', unplanned: 'lobby', planned: 'planned', updated: '' };
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const elem = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
const cell = (...nodes) => { const td = elem('td'); td.append(...nodes); return td; };
/**
 * Notices are toasts, not a status line at the top of the page: the panels are long and the operator is usually scrolled
 * down inside a card, so a message written above the fold is never seen. The card floats at the top of the current view,
 * does not block the page, and dismisses itself (or on click).
 */
const TOAST_MS = { info: 4000, error: 8000 };
const MAX_TOASTS = 4;
const toastTimers = new Map();

function dismissToast(card) {
  clearTimeout(toastTimers.get(card));
  toastTimers.delete(card);
  card.remove();
}

/** Dismiss the toasts, all of them or only one kind. */
function dismissToasts(kind = null) {
  for (const card of [...$('#toasts').children]) if (!kind || card.classList.contains(kind)) dismissToast(card);
}

function notice(text, error = false) {
  const host = $('#toasts');
  if (!text) { dismissToasts(); return; }
  const kind = error ? 'error' : 'info';
  const card = elem('div', text, `toast ${kind}`);
  card.addEventListener('click', () => dismissToast(card));
  host.append(card);
  toastTimers.set(card, setTimeout(() => dismissToast(card), TOAST_MS[kind]));
  while (host.children.length > MAX_TOASTS) dismissToast(host.children[0]);
}
async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/admin/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '操作失败'), { status: response.status });
    return data;
  } finally { clearTimeout(timer); }
}
function showLogin(message = '') {
  state.csrf = null; state.snapshot = null; state.generation++;
  $('#console').hidden = true; $('#login-screen').hidden = false;
  $('#login-error').textContent = message;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}
async function showConsole(session) {
  state.csrf = session.csrf; state.offset = 0; state.generation++;
  $('#admin-name').textContent = session.username;
  $('#login-form').elements.password.value = '';
  $('#login-screen').hidden = true; $('#console').hidden = false;
  mountPluginPanels();
  await refresh();
}
/** Plugin hook (DESIGN §32 spirit): index.html may fill window.SP_ADMIN_PANELS with { id, title, mount(body, ctx) }
 * before admin.js loads; each entry becomes a sidebar tab with its own panel section. */
function mountPluginPanels() {
  const panels = Array.isArray(window.SP_ADMIN_PANELS) ? window.SP_ADMIN_PANELS : [];
  const nav = document.querySelector('nav[aria-label="管理功能"]');
  const main = document.querySelector('#console main');
  const ctx = { api, refresh, state };
  for (const panel of panels) {
    if (!panel || typeof panel.id !== 'string' || typeof panel.title !== 'string' || typeof panel.mount !== 'function'
        || document.getElementById('tab-' + panel.id) || nav.querySelector(`[data-tab="${CSS.escape(panel.id)}"]`)) continue;
    const button = elem('button', null, 'nav-item'); button.dataset.tab = panel.id;
    button.append(elem('span', '◇'), document.createTextNode(panel.title));
    button.addEventListener('click', () => applyTab(panel.id, panel.title));
    const section = elem('section', null, 'tab-panel'); section.id = 'tab-' + panel.id; section.hidden = true;
    panel.mount(section, ctx);
    nav.append(button); main.append(section);
  }
}
function applyTab(tab, title) {
  state.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== 'tab-' + tab;
  $('#page-title').textContent = title;
  if (tab === 'announcements') renderAnnouncements().catch(e => notice(e.message, true));
  if (tab === 'arcade') renderArcade().catch(e => notice(e.message, true));
  if (tab === 'packs') { renderPacks().catch(e => notice(e.message, true)); renderSkins().catch(e => notice(e.message, true)); }
  if (tab === 'content') renderContent().catch(e => notice(e.message, true));
  if (tab === 'feedback') renderFeedback().catch(e => notice(e.message, true));
}

/**
 * 娱乐模式 (arcade): one row per COMPLETED mode. The pill is the server's effective state (build switch AND admin
 * switch), the button proposes the opposite; a closed mode refuses its new rooms and starts while its running matches
 * finish naturally — the same drain idea as 维护, but per mode (maintenance covers every mode).
 */
async function renderArcade() {
  const data = await api('arcade');
  const box = $('#arcade-modes');
  box.replaceChildren();
  for (const mode of data.modes) {
    const row = elem('div', null, 'arcade-mode-row');
    row.append(elem('strong', mode.name), elem('span', mode.open ? '开放中' : '暂未开放', 'status-pill ' + (mode.open ? 'ok' : 'bad')));
    const button = elem('button', mode.open ? '停用' : '开放', mode.open ? 'danger' : 'primary');
    button.addEventListener('click', async () => {
      const ask = mode.open
        ? `停用「${mode.name}」？该玩法的新房间与新对局将被拒绝，进行中的对局自然打完。`
        : `开放「${mode.name}」？开放后玩家可以进入该玩法。`;
      if (!confirm(ask)) return;
      button.disabled = true;
      try {
        await api('arcade', { id: mode.id, open: !mode.open });
        notice(`「${mode.name}」已${mode.open ? '停用' : '开放'}。`);
        await renderArcade();
      } catch (e) { notice(e.message, true); button.disabled = false; }
    });
    row.append(button);
    box.append(row);
  }
}
/**
 * 资源包 (packs): every installed pack and plugin with the runtime switch (server/pluginPolicy.js). Files stay on
 * disk — the switch only controls delivery: the catalogues, /packs/ and /p/ answer for the next request, bytes an
 * open page already loaded are not recalled. Paid entries default to disabled and are filtered out of what players
 * receive; the panel still lists them (paid rows last), and enabling one needs a confirm — handing paid content to
 * players is the risk this page exists to avoid (NOTICE.md: the project stays non-commercial).
 */
async function renderPacks() {
  const data = await api('packs');
  const box = $('#pack-list');
  box.replaceChildren();
  for (const pack of data.packs) {
    const row = elem('div', null, 'pack-row');
    row.append(elem('strong', pack.name), elem('code', pack.id, 'pack-id'), elem('span', pack.class, 'pack-class'));
    if (pack.paid) row.append(elem('span', '付费', 'pack-paid'));
    row.append(elem('span', pack.enabled ? '已启用' : '已停用', 'status-pill ' + (pack.enabled ? 'ok' : 'bad')));
    const button = elem('button', pack.enabled ? '停用' : '启用', pack.enabled ? 'danger' : 'primary');
    button.addEventListener('click', async () => {
      const ask = pack.enabled
        ? `停用「${pack.name}」？目录与文件请求从下一次请求起不再提供它，已加载的页面不会回退。`
        : pack.paid
          ? `启用付费资源包「${pack.name}」？付费内容将直接提供给玩家，请确认合规风险。`
          : `启用「${pack.name}」？`;
      if (!confirm(ask)) return;
      button.disabled = true;
      try {
        await api('packs', { id: pack.id, enabled: !pack.enabled, ...(pack.paid && !pack.enabled ? { confirm: true } : {}) });
        notice(`「${pack.name}」已${pack.enabled ? '停用' : '启用'}。`);
        await renderPacks();
      } catch (e) { notice(e.message, true); button.disabled = false; }
    });
    row.append(button);
    box.append(row);
  }
  if (!data.packs.length) box.append(elem('p', '没有安装的资源包。', 'muted'));
}

/**
 * 内容管理 (docs/CONTENT-ADMIN.md §4, §6, §7): a build-time editor — every write lands in runtime/*.json and only
 * takes effect after a restart, so each card says so. UI copy goes through msg() so tools/i18n.mjs can extract it;
 * uiText() renders a msg() in the current language.
 */
const uiText = (m) => t(m.msgid, m.params);

// Row identity is (type, id) only (§4.2): two rows that read the same with the same effect stay two rows, because a
// content-hash merge would let "take one version out" drop content another version still provides.
const contentTables = [
  { type: 'bonds', title: msg('盟约') },
  { type: 'bands', title: msg('策略') },
  { type: 'items', title: msg('装备') },
  { type: 'operators', title: msg('干员') }
];
const contentState = { versions: null, wild: null, wildPatch: null, skins: null, skinsDisabled: new Set(), skinsBase: new Set(), collapsed: new Set() };

/** The version's readable name (shared/versions.js `label`): the ids alone (act2autochess@V2_1) read as nothing to a
 * maintainer, so every view shows the label and keeps the id as the technical detail. */
const versionLabel = (id) => {
  const entry = versionById(id);
  return entry ? t(entry.label) : String(id);
};
/** The 干员 matrix cell's readable name (§4.2): the bond's 中文名 from the catalog; the id stays only as the stored key. */
const bondLabel = (row, key, bondId) => row.bondNames?.[key] || String(bondId);
// The skin card lists default first, then official, then pack (§7): a default skin is always open, so it has no switch.
const skinSourceOrder = { default: 0, official: 1, pack: 2 };
const skinStatNames = { operators: msg('干员'), skins: msg('皮肤'), disabled: msg('已禁用'), open: msg('对玩家开放') };
const presetNames = { pin: msg('1A 冲突以所选版本为准'), exclude: msg('1B 摘出去') };

const setStatus = (node, text, kind) => { node.textContent = text; node.className = 'status-pill ' + kind; };

function checkbox(label, checked, disabled) {
  const box = elem('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  box.disabled = !!disabled;
  const wrap = elem('label', null, 'checkbox-label');
  wrap.append(box, elem('span', label));
  return { box, el: wrap };
}

/**
 * 版本卡片 (§6): one row per registered version in registry order, the checkbox is the build switch. envLocked means
 * SP_CONTENT_VERSIONS overrides the document, so the card reads but cannot write.
 */
async function renderVersions() {
  const data = await api('content/versions');
  contentState.versions = data;
  const ids = data.ids || data.registered || [];
  const enabled = new Set(data.enabled || []);
  const locked = !!data.envLocked;
  const list = $('#versions-list');
  list.replaceChildren();
  if (locked) list.append(elem('p', uiText(msg('版本由环境变量锁定，此卡片只读。')), 'panel-note'));
  for (const id of ids) {
    const row = elem('div', null, 'content-row');
    const box = elem('input');
    box.type = 'checkbox';
    box.checked = enabled.has(id);
    box.disabled = locked;
    box.dataset.id = id;
    box.setAttribute('aria-label', uiText(msg('启用版本 {id}', { id: versionLabel(id) })));
    const pill = elem('span', box.checked ? uiText(msg('已启用')) : uiText(msg('未启用')), 'status-pill ' + (box.checked ? 'ok' : 'bad'));
    box.addEventListener('change', () => setStatus(pill, box.checked ? uiText(msg('已启用')) : uiText(msg('未启用')), box.checked ? 'ok' : 'bad'));
    row.append(box, elem('strong', versionLabel(id)), elem('code', id, 'mono'), pill);
    list.append(row);
  }
  setStatus($('#versions-status'), locked ? uiText(msg('只读（环境变量）')) : uiText(msg('已加载')), locked ? 'pending' : 'ok');
  $('#versions-revision').textContent = `revision ${data.revision}`;
  $('#versions-save').disabled = locked || !ids.length;
}

async function saveVersions() {
  const data = contentState.versions;
  if (!data || data.envLocked) return;
  const enabled = [...$('#versions-list').querySelectorAll('input[type="checkbox"]')].filter(b => b.checked).map(b => b.dataset.id);
  const result = await api('content/versions', { enabled, expectedRevision: data.revision });
  notice(uiText(result.restartRequired ? msg('已保存，重启后生效') : msg('已保存。')));
  await renderVersions();
}

/** The wild operation bar (§4.2): 仅显示冲突 is on by default, plus 按名称检索 and 按版本筛选. */
function wildFilter() {
  return {
    conflictOnly: $('#wild-conflict-only').checked,
    search: $('#wild-search').value.trim().slice(0, 80),
    version: $('#wild-version').value || null
  };
}

const emptyWildPatch = () => ({ picks: { bonds: {}, bands: {}, items: {} }, operators: {} });

function patchDirty(patch) {
  if (!patch) return false;
  return Object.values(patch.picks).some(p => Object.keys(p).length) || Object.values(patch.operators).some(o => (o.off || []).length);
}

// A pending change wins over what the document says, so a row keeps showing the operator's choice across a re-read.
const pendingPick = (table, row) => contentState.wildPatch?.picks?.[table.type]?.[row.id] ?? null;
const pendingOff = (row) => contentState.wildPatch?.operators?.[row.id]?.off ?? row.selection ?? [];

function updateWildSave() {
  const data = contentState.wild;
  const presetReady = !!data && !!wildFilter().version;
  $('#wild-save').disabled = !data || !data.synthesis?.ok || !patchDirty(contentState.wildPatch);
  $('#wild-preset-pin').disabled = !presetReady;
  $('#wild-preset-exclude').disabled = !presetReady;
}

async function renderWild() {
  const filter = wildFilter();
  const query = new URLSearchParams();
  if (!filter.conflictOnly) query.set('conflictOnly', '0');
  if (filter.search) query.set('search', filter.search);
  if (filter.version) query.set('version', filter.version);
  const data = await api('content/wild?' + query);
  contentState.wild = data;
  contentState.wildPatch = contentState.wildPatch || emptyWildPatch();
  renderWildVersionOptions(data);
  renderSynthesis(data);
  renderWildTables(data);
  const ok = !!data.synthesis?.ok;
  setStatus($('#wild-status'), ok ? uiText(msg('已加载')) : uiText(msg('无法合成')), ok ? 'ok' : 'bad');
  $('#wild-revision').textContent = `revision ${data.revision}`;
  updateWildSave();
}

function renderWildVersionOptions(data) {
  const select = $('#wild-version');
  const current = select.value;
  select.replaceChildren();
  const all = elem('option', uiText(msg('全部版本')));
  all.value = '';
  select.append(all);
  for (const id of data.sources || []) { const option = elem('option', versionLabel(id)); option.value = id; select.append(option); }
  select.value = current;
}

/** §4.2: a failing synthesis shows above the tables, because the tables alone would look like a normal read. */
function renderSynthesis(data) {
  const box = $('#wild-synthesis');
  const synthesis = data.synthesis || {};
  box.replaceChildren();
  if (synthesis.ok) { box.hidden = true; return; }
  box.hidden = false;
  box.append(elem('p', uiText(msg('当前来源集合无法合成，需先收窄版本。')), 'synthesis-title'));
  for (const error of synthesis.errors || []) box.append(elem('p', error, 'synthesis-error'));
  box.append(elem('p', uiText(msg('已丢弃 {n} 条引用。', { n: synthesis.dropped || 0 })), 'muted'));
}

/**
 * One version's 细则 for a row (§4.2): the title on its own bold line, the body on the lines below it unbolded. The
 * em-dash form the panel used before read as one long run of text.
 */
function entryBody(row, version, title = '') {
  const entry = row.entries?.[version] || {};
  const box = elem('div', null, 'entry-body');
  const head = [title, entry.name].filter(Boolean).join(' ');
  if (head) box.append(elem('strong', head));
  if (entry.desc) box.append(elem('span', entry.desc, 'entry-line'));
  return box;
}

function effectiveLabel(table, row) {
  if (table.type === 'operators') {
    const off = pendingOff(row);
    return off.length ? uiText(msg('已摘出 {n} 条', { n: off.length })) : uiText(msg('全部保留'));
  }
  if (!row.conflict) return uiText(msg('唯一来源'));
  if (row.identical) return uiText(msg('实现相同'));
  const current = pendingPick(table, row) ?? row.effective;
  if (current === 'off') return uiText(msg('已摘出'));
  return current ? uiText(msg('以 {id} 为准', { id: versionLabel(current) })) : uiText(msg('自动（最新）'));
}

function renderWildTables(data) {
  const box = $('#wild-tables');
  box.replaceChildren();
  for (const table of contentTables) {
    const rows = data.tables?.[table.type] || [];
    const stats = data.stats?.[table.type] || {};
    const group = elem('div', null, 'content-group');
    // Each 分类 can be folded away (§4.2): with every group open the panel runs half a page deep, so the heading is
    // the control that gets you to the next category. The fold lives in contentState, so a re-render keeps it.
    const heading = elem('h3', null, 'group-head');
    heading.setAttribute('role', 'button');
    heading.setAttribute('tabindex', '0');
    const counts = [uiText(msg('{rows} 行 · {conflicts} 冲突', { rows: rows.length, conflicts: stats.conflicts ?? 0 }))];
    if (stats.identical) counts.push(uiText(msg('{n} 实现相同', { n: stats.identical })));
    heading.append(elem('span', '▸', 'caret'), elem('span', uiText(table.title), 'group-title'),
      elem('span', counts.join(' · '), 'muted'));
    const bodyBox = elem('div', null, 'group-body');
    const fold = () => {
      const closed = group.classList.toggle('collapsed');
      heading.setAttribute('aria-expanded', String(!closed));
      if (closed) contentState.collapsed.add(table.type); else contentState.collapsed.delete(table.type);
    };
    heading.addEventListener('click', fold);
    heading.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fold(); } });
    if (contentState.collapsed.has(table.type)) { group.classList.add('collapsed'); heading.setAttribute('aria-expanded', 'false'); }
    else heading.setAttribute('aria-expanded', 'true');
    group.append(heading, bodyBox);
    if (!rows.length) { bodyBox.append(elem('p', uiText(msg('当前筛选下没有行。')), 'muted')); box.append(group); continue; }
    const headRow = elem('tr');
    for (const title of [uiText(msg('名称')), uiText(msg('出现版本')), uiText(msg('当前生效'))]) headRow.append(elem('th', title));
    const thead = elem('thead'); thead.append(headRow);
    const body = elem('tbody');
    for (const row of rows) { const [tr, detail] = wildRow(table, row); body.append(tr, detail); }
    const tableEl = elem('table'); tableEl.append(thead, body);
    const wrap = elem('div', null, 'table-wrap'); wrap.append(tableEl);
    bodyBox.append(wrap);
    box.append(group);
  }
}

/** Clicking a row expands it: a conflict row gets one radio per source (§4.1), a single-source row only shows its 细则. */
function wildRow(table, row) {
  const tr = elem('tr');
  const effectiveCell = elem('td', effectiveLabel(table, row));
  tr.append(elem('td', row.name || row.id), elem('td', row.versions.map(versionLabel).join(', ')), effectiveCell);
  const detail = elem('tr', null, 'row-detail');
  const detailCell = elem('td');
  detailCell.colSpan = 3;
  detail.hidden = true;
  detail.append(detailCell);
  tr.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  if (table.type === 'operators') detailCell.append(operatorMatrix(table, row, effectiveCell));
  else if (row.conflict && !row.identical) detailCell.append(pickRadios(table, row, effectiveCell));
  else detailCell.append(entryBody(row, row.versions[0]));
  return [tr, detail];
}

function pickRadios(table, row, effectiveCell) {
  const box = elem('div', null, 'matrix');
  const current = pendingPick(table, row) ?? row.effective;
  for (const version of row.versions) {
    const line = elem('div', null, 'matrix-row');
    const radio = elem('input');
    radio.type = 'radio';
    radio.name = `pick-${table.type}-${row.id}`;
    radio.checked = current === version;
    radio.setAttribute('aria-label', uiText(msg('以 {id} 为准', { id: versionLabel(version) })));
    radio.addEventListener('change', () => {
      contentState.wildPatch.picks[table.type][row.id] = version;
      effectiveCell.textContent = effectiveLabel(table, row);
      updateWildSave();
    });
    line.append(radio, entryBody(row, version, versionLabel(version)));
    box.append(line);
  }
  return box;
}

/** The 干员 matrix (§4.2): one line per source, one checkbox per bond that source carries; checked = 保留. */
function operatorMatrix(table, row, effectiveCell) {
  const off = new Set(pendingOff(row));
  const box = elem('div', null, 'matrix');
  for (const version of row.versions) {
    const line = elem('div', null, 'matrix-row');
    line.append(elem('strong', versionLabel(version)));
    for (const bondId of row.cells?.[version] || []) {
      const key = `${version}:${bondId}`;
      const c = checkbox(bondLabel(row, key, bondId), !off.has(key), false);
      c.box.addEventListener('change', () => {
        const entry = contentState.wildPatch.operators[row.id] || (contentState.wildPatch.operators[row.id] = { off: [] });
        if (c.box.checked) entry.off = entry.off.filter(x => x !== key);
        else entry.off.push(key);
        effectiveCell.textContent = effectiveLabel(table, row);
        updateWildSave();
      });
      line.append(c.el);
    }
    box.append(line);
  }
  return box;
}

async function saveWild() {
  const data = contentState.wild;
  if (!data) return;
  if (!data.synthesis?.ok) { notice(uiText(msg('当前来源集合无法合成，需先收窄版本。')), true); return; }
  if (!patchDirty(contentState.wildPatch)) { notice(uiText(msg('没有待保存的修改。'))); return; }
  const result = await api('content/wild', { patch: contentState.wildPatch, expectedRevision: data.revision });
  contentState.wildPatch = emptyWildPatch();
  notice(uiText(result.restartRequired ? msg('已保存，重启后生效') : msg('已保存。')));
  await renderWild();
}

/**
 * The two batch presets (§4.3) write through the same CAS as a row edit and only touch the rows the operation bar
 * currently shows, so the confirm names the row count before anything is posted.
 */
async function runWildPreset(kind) {
  const data = contentState.wild;
  if (!data) return;
  const filter = wildFilter();
  if (!filter.version) { notice(uiText(msg('请先在操作栏选择版本。')), true); return; }
  const rows = Object.values(data.tables || {}).flat();
  // `data.tables` is already the filtered view, so this is the set the server's presetPatch will walk. A row whose
  // sources all read the same is not a decision, so 1A has nothing to do for it (§4.2).
  const affected = rows.filter(r => r.versions.includes(filter.version) && (kind === 'exclude' || (r.conflict && !r.identical))).length;
  if (!affected) { notice(uiText(msg('当前筛选下没有可处理的行。'))); return; }
  if (!confirm(uiText(msg('批量预设「{name}」将影响 {n} 行，确认执行？', { name: uiText(presetNames[kind]), n: affected })))) return;
  const result = await api('content/wild', { preset: { kind, version: filter.version, filter }, expectedRevision: data.revision });
  contentState.wildPatch = emptyWildPatch();
  notice(uiText(result.restartRequired ? msg('已保存，重启后生效') : msg('已保存。')));
  await renderWild();
}

/**
 * 皮肤管理 (§9): the gate document plus the page's working selection. The selection starts as what the server holds;
 * 重置 clears it without saving, and the save button is only live while the two differ.
 */
async function renderSkins() {
  const data = await api('content/skins');
  contentState.skins = data;
  contentState.skinsDisabled = new Set();
  for (const group of data.groups || []) for (const skin of group.skins || []) if (!skin.enabled) contentState.skinsDisabled.add(skin.id);
  contentState.skinsBase = new Set(contentState.skinsDisabled);
  renderSkinStats(data);
  drawSkinPanel();
  setStatus($('#skins-status'), uiText(msg('已加载')), 'ok');
  $('#skins-revision').textContent = `revision ${data.revision}`;
  updateSkinSave();
}

function renderSkinStats(data) {
  const grid = $('#skins-stats');
  grid.replaceChildren();
  const stats = { ...data.stats, disabled: contentState.skinsDisabled.size };
  for (const [key, value] of Object.entries(stats)) {
    const card = elem('div', null, 'stat');
    card.append(elem('span', uiText(skinStatNames[key] || msg(key))), elem('strong', String(value)));
    grid.append(card);
  }
}

/** The save button is only live while the page's selection differs from what the server holds. */
const skinsDirty = () => {
  const base = contentState.skinsBase;
  const now = contentState.skinsDisabled;
  if (base.size !== now.size) return true;
  for (const id of now) if (!base.has(id)) return true;
  return false;
};
const updateSkinSave = () => { $('#skins-save').disabled = !skinsDirty(); };

function drawSkinPanel() {
  const list = $('#skins-list');
  list.replaceChildren();
  for (const group of contentState.skins?.groups || []) {
    const [row, detail] = skinGroupRow(group);
    list.append(row, detail);
  }
}

/**
 * 重置 (§9): the page goes back to the initial default, every skin offered. It only changes the page — the save button
 * is still what writes it, so the admin sees the result before committing it.
 */
async function resetSkins() {
  if (!contentState.skins) return;
  contentState.skinsDisabled = new Set();
  renderSkinStats(contentState.skins);
  drawSkinPanel();
  updateSkinSave();
}

/**
 * 皮肤管理 (§9): one expandable group per operator, the header carries the disabled count. 精一 and 精二 come first,
 * then official, then pack. Each skin is the skin itself — art plus name, in the style of the 干员调配 picker: a tile is
 * highlighted while it is offered, and clicking it takes the skin away (clicking it again gives it back). The highlight
 * is the whole state, so the tiles carry no state text; the two initial portraits can never be taken away, so a click
 * on them only says so.
 */
function skinGroupRow(group) {
  const skins = (group.skins || []).slice().sort((a, b) => (skinSourceOrder[a.source] ?? 9) - (skinSourceOrder[b.source] ?? 9));
  const row = elem('div', null, 'content-row');
  const detail = elem('div', null, 'row-detail skin-grid');
  const count = elem('span', null, 'muted');
  const draw = () => { count.textContent = uiText(msg('已禁用 {n}', { n: skins.filter(s => contentState.skinsDisabled.has(s.id)).length })); };
  detail.hidden = true;
  row.append(elem('strong', group.charName || group.charId), count);
  row.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  for (const skin of skins) {
    const tile = elem('div', null, 'skin-tile');
    const fixed = skin.source === 'default' || skin.fixed;
    if (skin.art) {
      const img = elem('img');
      img.src = skin.art;
      img.alt = skin.name || skin.id;
      img.loading = 'lazy';
      tile.append(img);
    } else {
      tile.append(elem('span', '◇', 'tile-mark'));
    }
    tile.append(elem('strong', skin.name || skin.id), elem('small', skin.group || '', 'muted'));
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-pressed', String(!contentState.skinsDisabled.has(skin.id)));
    tile.classList.toggle('fixed', fixed);
    tile.classList.toggle('on', !contentState.skinsDisabled.has(skin.id));
    tile.addEventListener('click', () => {
      if (fixed) { notice(uiText(msg('初始立绘不可移除')), true); return; }
      if (contentState.skinsDisabled.has(skin.id)) contentState.skinsDisabled.delete(skin.id);
      else contentState.skinsDisabled.add(skin.id);
      tile.setAttribute('aria-pressed', String(!contentState.skinsDisabled.has(skin.id)));
      tile.classList.toggle('on', !contentState.skinsDisabled.has(skin.id));
      draw();
      renderSkinStats(contentState.skins);
      updateSkinSave();
    });
    detail.append(tile);
  }
  draw();
  return [row, detail];
}

async function saveSkins() {
  const data = contentState.skins;
  if (!data) return;
  if (!skinsDirty()) { notice(uiText(msg('没有待保存的修改。'))); return; }
  // The document is the map keyed by operator (§9), not a flat list: rebuild it from the rows so the POST matches
  // what the gate reads.
  const disabled = {};
  for (const group of data.groups || []) {
    const list = (group.skins || []).filter((s) => s.id && contentState.skinsDisabled.has(s.id)).map((s) => s.id);
    if (list.length) disabled[group.charId] = list;
  }
  const result = await api('content/skins', { disabled, expectedRevision: data.revision });
  notice(uiText(result.restartRequired ? msg('已保存，重启后生效') : msg('已保存。')));
  await renderSkins();
}

async function renderContent() {
  await renderVersions();
  await renderWild();
  setStatus($('#content-status'), uiText(msg('已加载')), 'ok');
}

/**
 * The maintenance switch is a drain state, not a label: the status line carries the confirmed state (green running /
 * amber draining / red when the server cannot be reached), the button carries the action it would take next, and the
 * pending label makes an in-flight request visible instead of a disabled button that looks unchanged.
 */
let maintenanceState = null; // last state confirmed by the server
function paintMaintenance(mode, buttonLabel) {
  const label = $('#maintenance-status'), button = $('#maintenance-toggle');
  label.textContent = maintenanceNames[mode];
  label.className = 'status-pill ' + (mode === 'running' ? 'ok' : mode === 'maintenance' ? 'warn' : mode === 'pending' ? 'pending' : 'bad');
  button.textContent = buttonLabel || (maintenanceState === 'maintenance' ? '停止维护' : '维护');
  button.className = maintenanceState === 'maintenance' ? 'primary' : 'warn'; // warn = enter the drain, primary = end it
  button.disabled = mode === 'pending';
}
async function refreshMaintenance() {
  try {
    maintenanceState = (await api('maintenance')).maintenance ? 'maintenance' : 'running';
    paintMaintenance(maintenanceState);
  } catch (e) { maintenanceState = null; paintMaintenance('unreachable'); throw e; }
}
function empty(tbody, columns, message) {
  tbody.replaceChildren(); const row = elem('tr'), td = elem('td', message, 'empty'); td.colSpan = columns; row.append(td); tbody.append(row);
}
function nameBlock(p) {
  const wrap = elem('div', null, 'player-name'), avatar = elem('span', [...(p.name || '博士')][0], 'avatar'), text = elem('div', null, 'name-text');
  text.append(elem('strong', p.name || '博士'), elem('span', p.playerId, 'subtext mono')); wrap.append(avatar, text); return wrap;
}
function actionButton(label, action, target, danger = false) {
  const button = elem('button', label, danger ? 'danger' : 'subtle'); button.type = 'button';
  button.addEventListener('click', () => openAction(action, target)); return button;
}
function renderPlayers(data) {
  const body = $('#players-body'); body.replaceChildren();
  if (!data.players.length) empty(body, 6, '当前筛选下没有玩家。可切换为“所有玩家”查看大厅和房间。');
  for (const p of data.players) {
    const row = elem('tr'), stateCell = elem('div');
    stateCell.append(elem('span', statusNames[p.status] || p.status, 'pill ' + p.status));
    if (p.alive === false && p.playing) stateCell.append(elem('span', '已淘汰', 'subtext'));
    if (p.autoplay) stateCell.append(elem('span', 'AI 托管', 'subtext'));
    const room = elem('div'); room.append(elem('span', p.roomCode || p.matchId || '—', 'mono'), elem('span', p.isHost ? '房主' : p.spectator ? '观战席位' : p.mode === 'solo' ? '独立模拟' : p.mode ? '同盟模拟' : '未加入房间', 'subtext'));
    const progress = elem('div'); progress.append(elem('span', difficultyNames[p.difficulty] || '—'), elem('span', p.phase ? `${phaseNames[p.phase] || p.phase}${p.round != null ? ` · 第 ${p.round} 回合` : ''}${p.lp != null ? ` · LP ${p.lp}` : ''}` : '—', 'subtext'));
    const addr = elem('div'); addr.append(elem('span', p.ip || '—', 'mono'), elem('span', p.connected ? '连接有效' : `断线 ${date(p.disconnectedAt)}`, 'subtext'));
    const actions = cell(actionButton('踢出', 'kick', p), actionButton('封禁', 'ban', p, true)); actions.className = 'action-cell';
    row.append(cell(nameBlock(p)), cell(stateCell), cell(room), cell(progress), cell(addr), actions); body.append(row);
  }
  $('#player-count').textContent = `${data.filteredCount} 人`;
  $('#previous-page').disabled = state.offset === 0;
  $('#next-page').disabled = state.offset + 200 >= data.filteredCount;
  $('#page-range').textContent = data.filteredCount ? `${state.offset + 1}–${Math.min(state.offset + 200, data.filteredCount)} / ${data.filteredCount}` : '0 / 0';
}
function renderBans(data) {
  const body = $('#bans-body'); body.replaceChildren();
  const active = data.bans.filter(b => !b.expired);
  $('#ban-count').textContent = active.length;
  if (!data.bans.length) empty(body, 5, '暂无封禁记录。');
  for (const ban of [...data.bans].reverse()) {
    const row = elem('tr'), reason = elem('div'); reason.append(elem('span', ban.reason), elem('span', ban.scopes.map(s => scopeNames[s] || s).join(' / '), 'subtext'));
    row.append(cell(nameBlock(ban)), cell(reason), cell(elem('span', date(ban.createdAt))), cell(elem('span', ban.expired ? '已到期' : ban.expiresAt ? date(ban.expiresAt) : '永久')), cell(actionButton('解除', 'unban', ban)));
    body.append(row);
  }
}
function renderAudit(data) {
  const body = $('#audit-body'); body.replaceChildren();
  if (!data.audit.length) empty(body, 5, '暂无管理操作记录。');
  for (const item of data.audit) {
    const row = elem('tr'); row.append(cell(elem('span', date(item.at))), cell(elem('span', actionLabel(item))), cell(elem('span', item.name || item.playerId || '服务器')), cell(elem('span', item.reason || item.text || item.announcementId || '—')), cell(elem('span', item.actor))); body.append(row);
  }
}
/** Scroll and popup are two independent channels, each with its own winner (highest level, earliest start among
 *  equals). A popup row is never blocked by a scroll row, so the pill has to name the rival inside the same
 *  channel — the previous version compared every row against the scroll winner and made long-lived popups look
 *  like they were waiting for an announcement that does not exist. */
/** Room lifecycle, not player state: one row per room so the operator can see who opened it, which code to quote,
 *  how far the simulation has run, and jump straight into the spectator seat when a player reports a problem. */
function renderMatches(data) {
  const body = $('#matches-body'); body.replaceChildren();
  const matches = data.matches || [];
  const total = data.matchTotal ?? matches.length;
  $('#match-count').textContent = total;
  $('#match-total').textContent = total > matches.length ? `· 显示前 ${matches.length} / ${total}` : '';
  if (!matches.length) empty(body, 8, '当前没有房间。玩家创建同盟或进入匹配后，房间会出现在这里。');
  for (const m of matches) {
    const status = m.disposed ? 'disposed' : m.inMatch ? 'match' : m.queued ? 'matching' : 'waiting';
    const row = elem('tr');
    const code = elem('span', m.roomCode, 'mono');
    const type = elem('span', modeNames[m.mode] || m.mode || '—');
    const host = elem('div'); host.append(elem('span', m.hostName || m.hostId || '—'), elem('span', m.source === 'matchmaker' ? '匹配创建' : '玩家创建', 'subtext'));
    const progress = elem('div'); progress.append(elem('span', difficultyNames[m.difficulty] || '—'), elem('span', m.phase ? `${phaseNames[m.phase] || m.phase}${m.round != null ? ` · 第 ${m.round} 回合` : ''}` : '尚未开局', 'subtext'));
    const seats = elem('div'); seats.append(elem('span', `${m.humans} 真人 / ${m.capacity} 席位`), elem('span', `${m.bots} AI · ${m.spectators} 观战${m.queued ? ' · 排队中' : ''}`, 'subtext'));
    const actions = cell(); actions.className = 'action-cell';
    if (m.disposed) actions.append(elem('span', '—', 'muted'));
    else {
      const link = elem('a', '进入观战 ↗', 'subtle');
      link.href = '/?room=' + encodeURIComponent(m.roomCode); link.target = '_blank'; link.rel = 'noopener';
      actions.append(link);
    }
    row.append(cell(code), cell(type), cell(host), cell(elem('span', roomStatusNames[status], 'pill ' + status)), cell(progress), cell(seats), cell(elem('span', date(m.createdAt))), actions);
    body.append(row);
  }
}
async function renderAnnouncements() {
  const generation = state.generation;
  const data = await api('announcements');
  if (generation !== state.generation) return;
  const list = $('#announcements-list'); list.replaceChildren();
  const now = Date.now();
  const rows = data.announcements.filter(n => n.enabled && (n.endAt == null || n.endAt > now)).sort((a, b) => a.startAt - b.startAt);
  if (!rows.length) list.append(elem('p', '当前没有有效公告。', 'muted'));
  for (const n of rows) {
    const channel = n.type || 'scroll';
    const current = channel === 'popup' ? data.popupCurrent : data.current;
    const shown = current?.id === n.id;
    const status = shown ? '正在展示' : n.startAt > now ? '等待开始' : current ? `排队于 ${current.id} 之后` : '等待更高等级公告结束';
    const card = elem('article', null, 'announcement-card');
    card.append(elem('span', status, 'pill' + (shown ? '' : ' waiting')), elem('p', n.text),
      elem('small', `${channel === 'popup' ? '弹窗通道' : '滚动通道'} · ${n.level === 'urgent' ? '紧急' : n.level === 'warning' ? '提醒' : '普通'} · ${n.startAt ? date(n.startAt) : '立即生效'} — ${n.endAt == null ? '长期有效' : date(n.endAt)}`));
    if (n.id.startsWith('admin_')) card.append(actionButton('提前结束', 'stopAnnouncement', n));
    card.append(actionButton('删除', 'deleteAnnouncement', n, true));
    list.append(card);
  }
}
/** Keyset paging (the store returns the cursor for the next page), so the page stack keeps the cursors already seen
 *  instead of an offset; the admin view also shows the items the board has hidden. */
async function renderFeedback() {
  const generation = state.generation;
  const query = new URLSearchParams({ limit: '20' });
  const status = $('#feedback-status').value, category = $('#feedback-category').value, terms = $('#feedback-search').value.trim();
  if (status !== 'all') query.set('status', status);
  if (category !== 'all') query.set('category', category);
  if (terms) query.set('q', terms);
  const before = state.feedbackPages[state.feedbackIndex];
  if (before) query.set('before', before);
  const data = await api('feedback?' + query);
  if (generation !== state.generation) return;
  const body = $('#feedback-body'); body.replaceChildren();
  const counts = data.counts || {};
  $('#feedback-count').textContent = counts.all ?? 0;
  $('#feedback-total').textContent = counts.all ? `· 待处理 ${counts.unassigned} · 已规划 ${counts.planned} · 已更新 ${counts.updated}` : '';
  if (!data.items.length) empty(body, 8, '当前筛选下没有玩家反馈。');
  for (const f of data.items) {
    const row = elem('tr');
    const title = elem('div'); title.append(elem('span', f.title), elem('span', '#' + f.id, 'subtext mono'));
    if (f.hidden) title.append(elem('span', '已隐藏', 'subtext'));
    const reply = elem('div'); reply.append(elem('span', f.reply || '—'), elem('span', f.reply ? date(f.replyAt) : '未回复', 'subtext'));
    const actions = cell(); actions.className = 'action-cell';
    const button = elem('button', '处理', 'subtle'); button.type = 'button';
    button.addEventListener('click', () => openFeedback(f));
    actions.append(button);
    row.append(cell(elem('span', feedbackCategoryNames[f.category] || f.category)), cell(title), cell(elem('span', f.body)),
      cell(elem('span', f.author || '匿名')), cell(elem('span', feedbackStatusNames[f.status] || f.status, 'pill ' + (feedbackPillClass[f.status] || ''))),
      cell(reply), cell(elem('span', date(f.createdAt))), actions);
    body.append(row);
  }
  state.feedbackPages[state.feedbackIndex + 1] = data.next;
  $('#feedback-previous').disabled = state.feedbackIndex === 0;
  $('#feedback-next').disabled = !data.next;
  $('#feedback-range').textContent = data.items.length ? `第 ${state.feedbackIndex + 1} 页 · 本页 ${data.items.length} 条` : '0 条';
}
function openFeedback(item) {
  state.feedback = item;
  const form = $('#feedback-form');
  $('#feedback-title').textContent = `处理反馈 · #${item.id}`;
  $('#feedback-meta').textContent = `${feedbackCategoryNames[item.category] || item.category} · ${item.author || '匿名'} · ${date(item.createdAt)}${item.client ? ' · ' + item.client : ''}`;
  $('#feedback-text').textContent = item.body;
  form.reset();
  form.elements.status.value = item.status;
  form.elements.reply.value = item.reply || '';
  form.elements.hidden.checked = !!item.hidden;
  form.querySelector('.form-error').textContent = '';
  $('#feedback-dialog').showModal();
}
async function refresh() {
  if (!state.csrf) return;
  if (state.loading) { state.refreshAgain = true; return; }
  state.loading = true; $('#refresh-button').disabled = true;
  const generation = state.generation;
  try {
    const query = new URLSearchParams({ scope: $('#scope').value, search: $('#search').value.trim(), offset: state.offset });
    const data = await api('snapshot?' + query);
    if (generation !== state.generation) return;
    state.snapshot = data;
    $('#stat-online').textContent = data.stats.onlineBrowsers;
    $('#stat-playing').textContent = data.stats.playingPlayers;
    $('#stat-offline').textContent = data.stats.disconnectedPlayers;
    $('#stat-queue').textContent = data.stats.queued;
    $('#stat-matches').textContent = `${data.stats.matches} 场对局进行中`;
    $('#last-update').textContent = `更新于 ${date(data.serverNow)} · 当前连接 ${data.stats.connectedPlayers} 个真人席位`;
    renderPlayers(data); renderMatches(data); renderBans(data); renderAudit(data);
    refreshMaintenance().catch(() => { /* maintenance state is advisory; the next tick retries */ });
    if (state.tab === 'announcements') await renderAnnouncements();
    if (state.tab === 'arcade') await renderArcade();
    if (state.tab === 'feedback') await renderFeedback();
    dismissToasts('error');
  } catch (e) { if (e.status === 401) showLogin('管理会话已过期，请重新登录'); else notice('刷新失败，当前显示上次成功获取的数据：' + e.message, true); }
  finally { state.loading = false; $('#refresh-button').disabled = false; if (state.refreshAgain) { state.refreshAgain = false; queueMicrotask(refresh); } }
}
function openAction(kind, target) {
  state.action = { kind, target };
  const names = { kick: '踢出玩家', ban: '封禁玩家', unban: '解除封禁', stopAnnouncement: '结束公告', deleteAnnouncement: '删除公告' };
  $('#action-title').textContent = `${names[kind]}${target.name ? ' · ' + target.name : ''}`;
  $('#action-description').textContent = kind === 'kick' ? '将玩家从房间、队列和当前对局移出，并关闭连接；玩家可刷新页面重新加入。'
    : kind === 'ban' ? '将结束此客户端的当前参与，并在封禁期间阻止同一浏览器与会话重连。'
    : kind === 'unban' ? '解除这条封禁。其他仍生效的封禁不会改变；玩家可刷新页面重连。'
    : kind === 'deleteAnnouncement' ? '把这条公告从公告存储中彻底删除（含操作记录留痕）；重启服务器后也不会恢复。' : '提前结束这条公告，其余公告排期继续生效。';
  $('#reason-label').hidden = !['kick', 'ban'].includes(kind);
  $('#ban-options').hidden = kind !== 'ban';
  $('#action-form').reset();
  $('#action-form .form-error').textContent = '';
  $('#action-form').elements.includeIp.disabled = !target.canBanIp;
  $('#action-submit').textContent = names[kind] || '确认';
  $('#action-submit').className = kind === 'unban' ? 'primary' : 'danger';
  $('#action-dialog').showModal();
}
async function submit(form, work) {
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  const error = form.querySelector('.form-error');
  if (error) error.textContent = '';
  try { await work(); } catch (e) { if (e.status === 401 && state.csrf) showLogin('管理会话已过期，请重新登录'); else { if (error) error.textContent = e.message; else notice(e.message, true); } }
  finally { button.disabled = false; }
}
$('#login-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => { const body = Object.fromEntries(new FormData(form)); const session = await api('login', body); $('#login-error').textContent = ''; await showConsole(session); });
});
$('#action-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    const { kind, target } = state.action, body = { playerId: target.playerId, reason: form.elements.reason.value.trim() || undefined };
    let endpoint = kind;
    if (kind === 'ban') { body.durationSeconds = Number(form.elements.durationSeconds.value); body.includeIp = form.elements.includeIp.checked; }
    if (kind === 'unban') body.banId = target.id;
    if (kind === 'stopAnnouncement') { endpoint = 'announcement/stop'; body.announcementId = target.id; }
    if (kind === 'deleteAnnouncement') { endpoint = 'announcement/delete'; body.announcementId = target.id; }
    const result = await api(endpoint, body); $('#action-dialog').close();
    notice(kind === 'ban' ? `封禁已生效，已移出 ${result.affected} 个匹配客户端席位。` : '管理操作已完成。');
    await refresh();
  });
});
$('#announcement-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    if (!confirm('确认将这条公告发布给服务器所有玩家？')) return;
    const values = Object.fromEntries(new FormData(form)); values.durationSeconds = Number(values.durationSeconds);
    await api('announcement', values); form.elements.text.value = ''; notice('公告已发布，将按等级和排期展示。'); await renderAnnouncements();
  });
});
$('#password-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    const body = Object.fromEntries(new FormData(form));
    if (body.newPassword !== body.confirmPassword) throw new Error('两次输入的新密码不一致');
    await api('password', body); form.reset(); showLogin('密码已修改，请使用新密码登录');
  });
});
function resetFeedbackPage() { state.feedbackPages = [null]; state.feedbackIndex = 0; }
const renderFeedbackSafe = () => renderFeedback().catch(e => notice(e.message, true));
$('#feedback-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  submit(form, async () => {
    const values = Object.fromEntries(new FormData(form));
    await api('feedback/item', { id: state.feedback.id, status: values.status, reply: values.reply, hidden: values.hidden === 'on' });
    $('#feedback-dialog').close(); notice('反馈已保存。'); await renderFeedback();
  });
});
$('#feedback-delete').addEventListener('click', async () => {
  if (!confirm(`删除反馈 #${state.feedback.id}？这条记录会从反馈板和数据库里移除，无法恢复。`)) return;
  const button = $('#feedback-delete'); button.disabled = true;
  try {
    await api('feedback/delete', { id: state.feedback.id });
    $('#feedback-dialog').close(); notice('反馈已删除。'); await renderFeedback();
  } catch (e) {
    if (e.status === 401 && state.csrf) showLogin('管理会话已过期，请重新登录');
    else $('#feedback-form .form-error').textContent = e.message;
  } finally { button.disabled = false; }
});
for (const id of ['feedback-status', 'feedback-category']) $('#' + id).addEventListener('change', () => { resetFeedbackPage(); renderFeedbackSafe(); });
let feedbackTimer;
$('#feedback-search').addEventListener('input', () => { clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { resetFeedbackPage(); renderFeedbackSafe(); }, 300); });
$('#feedback-previous').addEventListener('click', () => { if (state.feedbackIndex > 0) { state.feedbackIndex--; renderFeedbackSafe(); } });
$('#feedback-next').addEventListener('click', () => { if (state.feedbackPages[state.feedbackIndex + 1]) { state.feedbackIndex++; renderFeedbackSafe(); } });
const renderWildSafe = () => renderWild().catch(e => notice(e.message, true));
for (const id of ['wild-conflict-only', 'wild-version']) $('#' + id).addEventListener('change', renderWildSafe);
let wildTimer;
$('#wild-search').addEventListener('input', () => { clearTimeout(wildTimer); wildTimer = setTimeout(renderWildSafe, 300); });
for (const [id, work] of [['versions-save', saveVersions], ['wild-save', saveWild], ['skins-save', saveSkins],
  ['skins-reset', resetSkins], ['wild-preset-pin', () => runWildPreset('pin')], ['wild-preset-exclude', () => runWildPreset('exclude')]]) {
  $('#' + id).addEventListener('click', () => work().catch(e => notice(e.message, true)));
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $('#' + button.dataset.close).close());
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  applyTab(button.dataset.tab, tabTitles[button.dataset.tab] || button.textContent.trim());
});
$('#refresh-button').addEventListener('click', refresh);
$('#scope').addEventListener('change', () => { state.offset = 0; state.generation++; refresh(); });
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.offset = 0; state.generation++; refresh(); }, 300); });
$('#previous-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - 200); refresh(); });
$('#next-page').addEventListener('click', () => { state.offset += 200; refresh(); });
$('#password-button').addEventListener('click', () => { $('#password-form').reset(); $('#password-form .form-error').textContent = ''; $('#password-dialog').showModal(); });
$('#logout-button').addEventListener('click', () => api('logout', {}).then(() => showLogin()).catch(e => notice(e.message, true)));
$('#maintenance-toggle').addEventListener('click', async () => {
  if (!maintenanceState) { notice('无法读取服务器维护状态，请先刷新后再操作。', true); return; }
  const turningOn = maintenanceState === 'running';
  if (!confirm(turningOn ? '进入排空后拒绝新建房间与匹配（进行中的对局不受影响），再次点击可恢复。确认进入排空？'
    : '退出排空，恢复接受新建房间与匹配。确认恢复运行？')) return;
  paintMaintenance('pending', turningOn ? '排空中…' : '恢复中…');
  try {
    const result = await api('maintenance', { maintenance: turningOn });
    maintenanceState = result.maintenance ? 'maintenance' : 'running';
    paintMaintenance(maintenanceState);
    notice(turningOn ? '已进入排空：新房间与匹配请求将被拒绝，进行中的对局继续。' : '排空已解除：房间与匹配恢复正常。');
    await refresh();
  } catch (e) {
    if (e.status === 401 && state.csrf) showLogin('管理会话已过期，请重新登录');
    else { notice(e.message, true); paintMaintenance('unreachable'); } // the switch may have been applied, so the next tick re-reads it
  }
});
/**
 * 重启 closes this process: ask the server what it would interrupt, confirm a second time (the click is the first
 * step), then POST. The server drains, closes gracefully and the supervisor starts a fresh process — the panel's
 * saved content settings take effect then.
 */
$('#restart-button').addEventListener('click', async () => {
  const button = $('#restart-button');
  button.disabled = true;
  try {
    const info = await api('restart');
    if (!info.enabled) { notice('当前服务未启用重启接口，请手动重启。', true); return; }
    const lines = ['重启将关闭服务并由守护进程重新拉起，期间所有玩家会断开连接。'];
    if (info.activeMatches) lines.push(`当前有 ${info.activeMatches} 场对局进行中，会被中断。`);
    if (!info.supervised) lines.push('注意：未检测到守护进程，重启后服务不会自动拉起，需要手动启动。');
    lines.push('确认重启？');
    if (!confirm(lines.join('\n'))) return;
    await api('restart', { force: true });
    maintenanceState = 'maintenance';
    paintMaintenance('pending', '重启中…');
    notice('已提交重启：服务正在排空并关闭，恢复后请刷新页面。');
  } catch (e) {
    if (e.status === 401 && state.csrf) showLogin('管理会话已过期，请重新登录');
    else notice(e.message, true);
    paintMaintenance('unreachable');
  } finally {
    button.disabled = false;
  }
});
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
api('session').then(showConsole).catch(e => showLogin(e.status === 401 ? '' : e.message));
