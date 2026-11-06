const $ = selector => document.querySelector(selector);
const state = { csrf: null, tab: 'players', offset: 0, snapshot: null, action: null, generation: 0, loading: false,
  feedback: null, feedbackPages: [null], feedbackIndex: 0 };
const statusNames = { playing: '正在对局', disconnected: '离线留席', matching: '等待匹配', spectating: '观战中', waiting: '房间等待', lobby: '大厅' };
const difficultyNames = { FUNNY: '标准模拟', NORMAL: '险境模拟', HARD: '绝境模拟', ABYSS: '终极模拟' };
const phaseNames = { INFO_CHECK: '开局确认', BAND_DRAFT: '策略选择', PREP: '整备', COMBAT: '作战', UNITE: '联防', SETTLE: '结算', CHOICE: '机变', RESULT: '结束', LOBBY: '等待' };
const actionNames = { kick: '踢出玩家', ban: '封禁玩家', unban: '解除封禁', announcement: '发布公告', stopAnnouncement: '结束公告', deleteAnnouncement: '删除公告', maintenance: '维护模式', passwordChanged: '修改管理密码', feedback: '处理反馈' };
const modeNames = { solo: '单人对局', coop: '多人对局' };
const roomStatusNames = { disposed: '已解散', match: '对局中', matching: '等待匹配', waiting: '等待开局' };
const maintenanceNames = { running: '运行中', maintenance: '维护中', pending: '切换中…', unreachable: '停机中' };
const scopeNames = { session: '会话', browser: '同一浏览器', ip: '公网 IP' };
// Maintenance is a toggle, so the same action name covers two opposite operations; the record carries the
// direction as a boolean, which is the only way to tell "enabled" from "disabled" apart.
const actionLabel = item => item.action === 'maintenance' ? (item.maintenance ? '启用维护模式' : '停用维护模式')
  : item.action === 'feedback' ? (item.op === 'delete' ? '删除反馈' : '处理反馈') : (actionNames[item.action] || item.action);
const tabTitles = { players: '玩家状态', matches: '对局列表', bans: '封禁管理', announcements: '服务器公告', feedback: '玩家反馈', audit: '操作记录' };
// The feedback board's own vocabulary (deploy/stardust/feedback/policy.mjs); the pill classes reuse the player table's.
const feedbackCategoryNames = { bug: '缺陷', gameplay: '玩法', ui: '界面', other: '其他' };
const feedbackStatusNames = { unassigned: '待处理', unplanned: '暂不规划', planned: '已规划', updated: '已更新' };
const feedbackPillClass = { unassigned: 'waiting', unplanned: 'lobby', planned: 'planned', updated: '' };
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const elem = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
const cell = (...nodes) => { const td = elem('td'); td.append(...nodes); return td; };
function notice(text, error = false) { const n = $('#notice'); n.textContent = text; n.className = 'notice' + (error ? ' error' : ''); n.hidden = !text; }
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
  if (tab === 'feedback') renderFeedback().catch(e => notice(e.message, true));
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
  button.className = maintenanceState === 'maintenance' ? 'primary' : 'danger';
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
    if (state.tab === 'feedback') await renderFeedback();
    if ($('#notice').classList.contains('error')) notice('');
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
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
api('session').then(showConsole).catch(e => showLogin(e.status === 401 ? '' : e.message));
