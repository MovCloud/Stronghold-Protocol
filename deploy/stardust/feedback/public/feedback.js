// 卫戍协议 · 反馈 (deploy/stardust/feedback, 2026-10-16): the public board's page. A plain ES module, no build step.
// ESR 115 / older Safari: no top-level await, no <dialog> (a plain modal), no :has() in the CSS. Every text a player
// typed is inserted with textContent, never as HTML.
// The page is public-only: players read and submit, they never manage. Management (status, reply, hide, delete) is in
// the admin console's 玩家反馈 tab (public/admin/admin.js), which runs under the admin session.

const API = '/feedback/api';
const CATEGORIES = [['bug', 'Bug 反馈'], ['gameplay', '玩法建议'], ['ui', '界面与体验'], ['other', '其他']];
const STATUSES = [['unassigned', '未分配'], ['unplanned', '无计划'], ['planned', '已计划'], ['updated', '已更新']];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const STATUS_LABEL = Object.fromEntries(STATUSES);
const LIMITS = { title: [2, 80], body: [5, 4000], author: [0, 24] };
const NAME_KEY = 'sp.name';
const LONG_BODY = 280; // code points; longer bodies start folded

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const cp = (s) => Array.from(s || '').length;

/** @type {{ status: string, category: string, q: string, items: any[], next: number|null, counts: any, loading: boolean, error: string, seq: number }} */
const state = { status: '', category: '', q: '', items: [], next: null, counts: null, loading: false, error: '', seq: 0 };

// ---- small DOM helper -------------------------------------------------------------------------------------------------
/** @param {string} tag @param {Record<string, any>} [attrs] @param {...any} kids */
function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}

// ---- storage ----------------------------------------------------------------------------------------------------------
const store = {
  get(area, key) { try { return globalThis[area]?.getItem(key) || ''; } catch { return ''; } },
  set(area, key, value) { try { if (value) globalThis[area]?.setItem(key, value); else globalThis[area]?.removeItem(key); } catch { /* unavailable */ } },
};

// ---- API --------------------------------------------------------------------------------------------------------------
class ApiError extends Error {
  /** @param {number} status @param {any} data */
  constructor(status, data) { super(data?.error || 'HTTP_' + status); this.status = status; this.data = data || {}; }
}

/** @param {string} path @param {{ method?: string, body?: any }} [opts] */
async function api(path, { method = 'GET', body } = {}) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
  } catch {
    throw new ApiError(0, { error: 'NETWORK' });
  }
  // The site gate answers an expired login with a redirect to /login (opaque here) or a 401 page.
  if (res.type === 'opaqueredirect' || res.status === 401) throw new ApiError(401, { error: 'GATE' });
  if (res.status === 204) { await res.text().catch(() => ''); return null; }
  const json = (res.headers.get('Content-Type') || '').includes('application/json');
  const data = json ? await res.json().catch(() => null) : null;
  if (!res.ok || !json) throw new ApiError(res.status, data);
  return data;
}

/** @param {ApiError|any} err */
function errorText(err) {
  const code = err?.data?.error;
  switch (code) {
    case 'GATE': return '登录已过期，请刷新页面重新进入。';
    case 'NETWORK': return '网络连接失败，请稍后再试。';
    case 'RATE_LIMITED': {
      const s = Number(err.data.retryAfter) || 60;
      return '提交太频繁了，请' + (s >= 3600 ? Math.ceil(s / 3600) + ' 小时' : s >= 60 ? Math.ceil(s / 60) + ' 分钟' : s + ' 秒') + '后再试。';
    }
    case 'DUPLICATE': return '已经有一条相同内容的反馈了（#' + err.data.id + '）。';
    case 'INVALID': return ({ title: '标题需要 2–80 个字。', body: '内容需要 5–4000 个字。', author: '署名最多 24 个字。', category: '请选择分类。' })[err.data.field] || '内容不符合要求。';
    case 'ORIGIN': return '请从本站页面提交。';
    default: return err?.status >= 500 ? '服务器暂时出错，请稍后再试。' : '操作失败（' + (code || err?.status || '未知') + '）。';
  }
}

// ---- formatting -------------------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function fullTime(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function shortTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  const d = new Date(ms);
  return (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '-') + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
const timeEl = (ms) => h('time', { datetime: new Date(ms).toISOString(), title: fullTime(ms), text: shortTime(ms) });

function clientInfo() {
  const ua = navigator.userAgent;
  let m, browser = '', os = '';
  if ((m = ua.match(/Edg(?:A|iOS)?\/(\d+)/))) browser = 'Edge ' + m[1];
  else if ((m = ua.match(/(?:OPR|Opera)\/(\d+)/))) browser = 'Opera ' + m[1];
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) browser = 'Firefox ' + m[1];
  else if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) browser = 'Chrome ' + m[1];
  else if ((m = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/))) browser = 'Safari ' + m[1];
  if (/MicroMessenger/i.test(ua)) browser = ('微信 ' + browser).trim();
  else if (/\bQQ\//.test(ua)) browser = ('QQ ' + browser).trim();
  if (/Windows/.test(ua)) os = 'Windows';
  else if ((m = ua.match(/(?:iPhone|CPU) OS (\d+)/))) os = (/iPad/.test(ua) ? 'iPadOS ' : 'iOS ') + m[1];
  else if ((m = ua.match(/Android (\d+)/))) os = 'Android ' + m[1];
  else if (/Mac OS X/.test(ua)) os = navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  const screenSize = Math.round(screen.width) + '×' + Math.round(screen.height);
  return [browser, os, screenSize].filter(Boolean).join(' · ').slice(0, 160);
}

// ---- toast ------------------------------------------------------------------------------------------------------------
let toastTimer = 0;
function toast(text, kind = '') {
  const node = $('toast');
  node.textContent = text;
  node.className = 'toast' + (kind ? ' toast--' + kind : '');
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

// ---- URL state --------------------------------------------------------------------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = (p.get('q') || '').slice(0, 64);
  state.status = STATUS_LABEL[p.get('status') || ''] ? /** @type {string} */ (p.get('status')) : '';
  state.category = CATEGORY_LABEL[p.get('category') || ''] ? /** @type {string} */ (p.get('category')) : '';
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.status) p.set('status', state.status);
  if (state.category) p.set('category', state.category);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
}

// ---- list -------------------------------------------------------------------------------------------------------------
async function load(reset) {
  const seq = ++state.seq;
  state.loading = true;
  state.error = '';
  if (reset) { state.items = []; state.next = null; }
  renderFooter();
  const p = new URLSearchParams();
  if (state.status) p.set('status', state.status);
  if (state.category) p.set('category', state.category);
  if (state.q.trim()) p.set('q', state.q.trim());
  if (!reset && state.next != null) p.set('before', String(state.next));
  p.set('limit', '20');
  try {
    const data = await api('/items?' + p.toString());
    if (seq !== state.seq) return;
    state.items = reset ? data.items : state.items.concat(data.items);
    state.next = data.next;
    state.counts = data.counts;
  } catch (err) {
    if (seq !== state.seq) return;
    state.error = errorText(err);
  }
  state.loading = false;
  renderTabs();
  renderList();
  renderFooter();
}

function renderTabs() {
  const tabs = $('tabs');
  const c = state.counts || {};
  tabs.replaceChildren(...[['', '全部'], ...STATUSES].map(([value, label]) => h('button', {
    type: 'button', role: 'tab', class: 'tab' + (value ? ' tab--' + value : ''), 'aria-selected': String(state.status === value),
    onclick: () => { if (state.status !== value) { state.status = value; writeUrl(); load(true); } },
  }, h('span', { text: label }), h('span', { class: 'tab__n', text: c[value || 'all'] == null ? '' : String(c[value || 'all']) }))));
}

function renderList() {
  const list = $('list');
  list.replaceChildren(...state.items.map((item) => card(item)));
}

function renderFooter() {
  const more = /** @type {HTMLButtonElement} */ ($('more'));
  const info = $('list-state');
  more.hidden = state.next == null || !!state.error;
  more.disabled = state.loading;
  more.textContent = state.loading ? '加载中…' : '加载更多';
  if (state.error) {
    info.replaceChildren(h('span', { text: state.error + ' ' }), h('button', { type: 'button', class: 'linkish', text: '重试', onclick: () => load(state.items.length === 0) }));
  } else if (state.loading && state.items.length === 0) {
    info.textContent = '加载中…';
  } else if (!state.loading && state.items.length === 0) {
    info.textContent = state.q.trim() || state.category || state.status ? '没有找到匹配的反馈。' : '还没有反馈，来写第一条吧。';
  } else if (!state.loading && state.next == null) {
    info.textContent = '没有更多了';
  } else {
    info.textContent = '';
  }
}

/** @param {any} item @param {boolean} [pinned] */
function card(item, pinned = false) {
  const long = cp(item.body) > LONG_BODY || (item.body.match(/\n/g) || []).length > 6;
  const body = h('p', { class: 'card__body' + (long ? ' is-folded' : ''), text: item.body });
  const toggle = long ? h('button', {
    type: 'button', class: 'linkish card__fold', text: '展开全文',
    onclick: (e) => { const folded = body.classList.toggle('is-folded'); e.currentTarget.textContent = folded ? '展开全文' : '收起'; },
  }) : null;
  const permalink = location.pathname + '#' + item.id;
  const node = h('article', { class: 'card panel' + (pinned ? ' card--pinned' : ''), dataset: { item: String(item.id) }, id: pinned ? null : 'item-' + item.id },
    h('div', { class: 'card__head' },
      h('span', { class: 'chip chip--cat chip--' + item.category, text: CATEGORY_LABEL[item.category] || item.category }),
      h('span', { class: 'chip chip--status chip--' + item.status, text: STATUS_LABEL[item.status] || item.status }),
      h('a', { class: 'card__id', href: permalink, title: '这条反馈的链接', text: '#' + item.id })),
    h('h3', { class: 'card__title', text: item.title }),
    body, toggle,
    h('div', { class: 'card__meta' },
      h('span', { class: 'card__author', text: item.author || '匿名' }), h('span', { class: 'dot', 'aria-hidden': 'true' }), timeEl(item.createdAt),
      item.client ? [h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'card__client', text: item.client })] : null),
    item.reply ? h('div', { class: 'reply' },
      h('div', { class: 'reply__head' }, h('span', { class: 'reply__who', text: '服主回复' }), item.replyAt ? timeEl(item.replyAt) : null),
      h('p', { class: 'reply__body', text: item.reply })) : null
  );
  return node;
}

/** Recounts the tabs after a new item without reloading the list. */
async function refreshCounts() {
  const p = new URLSearchParams({ limit: '1' });
  if (state.category) p.set('category', state.category);
  if (state.q.trim()) p.set('q', state.q.trim());
  try { state.counts = (await api('/items?' + p.toString())).counts; renderTabs(); } catch { /* keep the old numbers */ }
}

// ---- pinned item (#123 links) -----------------------------------------------------------------------------------------
let pinnedId = 0;
async function showPinned() {
  const m = /^#(\d{1,9})$/.exec(location.hash);
  const box = $('pinned');
  if (!m) { pinnedId = 0; box.hidden = true; return; }
  const id = Number(m[1]);
  pinnedId = id;
  try {
    const { item } = await api('/items/' + id);
    if (pinnedId !== id) return;
    box.replaceChildren(h('div', { class: 'pinned__head' }, h('span', { text: '链接指向的反馈' }),
      h('button', { type: 'button', class: 'linkish', text: '关闭', onclick: () => { history.replaceState(null, '', location.pathname + location.search); showPinned(); } })), card(item, true));
  } catch (err) {
    if (pinnedId !== id) return;
    box.replaceChildren(h('p', { class: 'hint', text: err?.status === 404 ? '#' + id + ' 不存在或已被隐藏。' : errorText(err) }));
  }
  box.hidden = false;
  box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---- modals -----------------------------------------------------------------------------------------------------------
let lastFocus = null;
function openModal(id) {
  lastFocus = document.activeElement;
  const m = $(id);
  m.hidden = false;
  document.body.classList.add('has-modal');
  const first = /** @type {HTMLElement|null} */ (m.querySelector('input:not([type=hidden]), textarea, .seg__btn[aria-pressed="true"]'));
  setTimeout(() => first?.focus(), 30);
}
function closeModal(id) {
  $(id).hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('has-modal');
  /** @type {any} */ (lastFocus)?.focus?.();
}
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).closest('[data-close]')) closeModal(m.id); });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal:not([hidden])');
  if (open) closeModal(open.id);
});

// compose
const form = /** @type {HTMLFormElement} */ ($('compose-form'));
let composeCategory = 'bug';
function renderComposeCategory() {
  $('compose-category').replaceChildren(...CATEGORIES.map(([value, label]) => h('button', {
    type: 'button', class: 'seg__btn', 'aria-pressed': String(composeCategory === value), text: label,
    onclick: () => { composeCategory = value; renderComposeCategory(); },
  })));
}
function updateCounts() {
  for (const node of form.querySelectorAll('[data-count-for]')) {
    const name = /** @type {HTMLElement} */ (node).dataset.countFor || '';
    const field = /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    const n = cp(field.value.trim()), [, max] = LIMITS[name];
    node.textContent = n + ' / ' + max;
    node.classList.toggle('is-over', n > max);
  }
}
form.addEventListener('input', () => { updateCounts(); $('compose-error').textContent = ''; });
$('compose-open').addEventListener('click', () => {
  const author = /** @type {HTMLInputElement} */ (form.elements.namedItem('author'));
  if (!author.value) author.value = store.get('localStorage', NAME_KEY).slice(0, 24);
  renderComposeCategory();
  updateCounts();
  $('compose-error').textContent = '';
  openModal('compose');
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const get = (n) => /** @type {HTMLInputElement} */ (form.elements.namedItem(n)).value.trim();
  const draft = { category: composeCategory, title: get('title'), body: get('body'), author: get('author'), client: clientInfo() };
  const err = $('compose-error');
  for (const name of ['title', 'body', 'author']) {
    const n = cp(draft[name]), [min, max] = LIMITS[name];
    if (n < min || n > max) { err.textContent = errorText({ data: { error: 'INVALID', field: name } }); /** @type {HTMLElement} */ (form.elements.namedItem(name)).focus(); return; }
  }
  const submit = /** @type {HTMLButtonElement} */ ($('compose-submit'));
  submit.disabled = true;
  submit.textContent = '提交中…';
  err.textContent = '';
  try {
    const { item } = await api('/items', { method: 'POST', body: draft });
    form.reset();
    closeModal('compose');
    toast('已提交，谢谢反馈！', 'ok');
    if (draft.author) store.set('localStorage', NAME_KEY, store.get('localStorage', NAME_KEY) || draft.author);
    if (!state.q && (!state.status || state.status === item.status) && (!state.category || state.category === item.category)) {
      state.items = [item, ...state.items];
      renderList();
      renderFooter();
    }
    refreshCounts();
  } catch (ex) {
    err.textContent = errorText(ex);
  }
  submit.disabled = false;
  submit.textContent = '提交';
});

// ---- filters ----------------------------------------------------------------------------------------------------------
const qInput = /** @type {HTMLInputElement} */ ($('q'));
const catSelect = /** @type {HTMLSelectElement} */ ($('category'));
catSelect.append(...CATEGORIES.map(([value, label]) => h('option', { value, text: label })));
let searchTimer = 0;
qInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (state.q !== qInput.value) { state.q = qInput.value; writeUrl(); load(true); } }, 350);
});
qInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  clearTimeout(searchTimer);
  state.q = qInput.value;
  writeUrl();
  load(true);
});
catSelect.addEventListener('change', () => { state.category = catSelect.value; writeUrl(); load(true); });
$('more').addEventListener('click', () => load(false));
window.addEventListener('hashchange', showPinned);

// ---- start ------------------------------------------------------------------------------------------------------------
readUrl();
qInput.value = state.q;
catSelect.value = state.category;
renderTabs();
renderFooter();
load(true);
showPinned();
