'use strict';

/* ============================================================
   HP Dynamic Screensaver Dashboard — front-end (vanilla JS)
   ============================================================ */

// Sub-path prefix (e.g. "/hp") derived in index.html; "" at the domain root.
const BASE = (typeof window !== 'undefined' && window.__BASE_PATH__) || '';

const State = {
  token: localStorage.getItem('hp_token') || null,
  user: null,
  stats: null,
  videos: [],
  filter: { country: '', status: '', q: '', requested: false },
  view: 'dashboard',
};

const STATUS_LABEL = {
  pending: 'Pending',
  under_review: 'Under Review',
  completed: 'Completed',
  finalized: 'Finalized',
};
const PARTIES = ['HP', 'Arc WW', 'Kinematic'];
const ORGS = ['HP', 'Arc WW', 'Kinematic'];

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Format an ISO timestamp in India Standard Time (user preference). */
function istDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
    return `${s} IST`;
  } catch { return iso; }
}
function istDate(val) {
  if (!val) return '—';
  // sheet dates are already plain YYYY-MM-DD; show them as DD MMM YYYY
  const d = new Date(val);
  if (isNaN(d)) return val;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}
function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function initials(name) { return (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

/* ---------- API ---------- */
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (State.token) headers.Authorization = 'Bearer ' + State.token;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + '/api' + path, {
    method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error('Session expired. Please sign in again.'); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* upload with progress via XHR */
function uploadAsset(videoId, file, kind, versionLabel, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    if (versionLabel) fd.append('version_label', versionLabel);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/videos/${videoId}/assets`);
    xhr.setRequestHeader('Authorization', 'Bearer ' + State.token);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null; try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}

/* ---------- auth ---------- */
function logout() {
  State.token = null; State.user = null;
  if (notifTimer) { clearInterval(notifTimer); notifTimer = null; }
  Notif.items = []; Notif.unread = 0; Notif.open = false;
  localStorage.removeItem('hp_token');
  renderLogin();
}

async function init() {
  if (!State.token) return renderLogin();
  try {
    const { user } = await api('/auth/me');
    State.user = user;
    renderApp();
  } catch {
    renderLogin();
  }
}

/* ============================================================
   LOGIN
   ============================================================ */
function renderLogin() {
  document.getElementById('modal-root').innerHTML = '';
  const app = $('#app');
  app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <div class="login-logo"><span class="dot">hp</span>
          <div><h1>Screensaver Dashboard</h1></div>
        </div>
        <p class="sub">Dynamic Screensaver production &amp; review portal</p>
        <label class="field"><span>Email</span>
          <input type="email" id="email" autocomplete="username" placeholder="you@company.com" required></label>
        <label class="field"><span>Password</span>
          <input type="password" id="password" autocomplete="current-password" placeholder="••••••••" required></label>
        <p class="err" id="loginErr"></p>
        <button class="btn block" type="submit" id="loginBtn">Sign in</button>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
    $('#loginErr').textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      State.token = data.token; State.user = data.user;
      localStorage.setItem('hp_token', data.token);
      renderApp();
    } catch (err) {
      $('#loginErr').textContent = err.message;
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
}

/* ============================================================
   APP SHELL
   ============================================================ */
function renderApp() {
  const u = State.user;
  const isAdmin = u.role === 'admin';
  const app = $('#app');
  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="dot">hp</span>
        <div>Dynamic Screensaver<small>Production &amp; Review Dashboard</small></div>
      </div>
      <nav id="nav">
        <button data-view="dashboard">Dashboard</button>
        ${isAdmin ? '<button data-view="users">Users</button>' : ''}
      </nav>
      <div class="usermenu">
        <button class="bell" id="bellBtn" title="Notifications">🔔<span class="badge hidden" id="bellBadge">0</span></button>
        <div class="who hide-sm"><b>${esc(u.name)}</b><br><small>${esc(u.org)}${isAdmin ? ' · Admin' : u.can_upload ? ' · Can upload' : ''}</small></div>
        <div class="avatar" title="${esc(u.email)}">${esc(initials(u.name))}</div>
        <button class="btn sm secondary" id="pwBtn">Password</button>
        <button class="btn sm secondary" id="logoutBtn">Sign out</button>
      </div>
    </header>
    <div id="notifRoot"></div>
    <main class="container" id="viewRoot"></main>`;
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    State.view = b.dataset.view; renderNav(); renderView();
  });
  $('#logoutBtn').addEventListener('click', logout);
  $('#pwBtn').addEventListener('click', openChangePassword);
  $('#bellBtn').addEventListener('click', toggleNotifications);
  renderNav(); renderView();
  startNotifications();
}

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
let notifTimer = null;
const Notif = { items: [], unread: 0, open: false };

async function loadNotifications() {
  try {
    const data = await api('/notifications');
    Notif.items = data.items; Notif.unread = data.unread;
    updateBell();
    if (Notif.open) renderNotifPop();
    renderRecentFeedback();
  } catch { /* ignore polling errors */ }
}
function startNotifications() {
  loadNotifications();
  if (notifTimer) clearInterval(notifTimer);
  // Poll only while the tab is visible, at a gentle interval, to keep load low
  // on shared hosting.
  notifTimer = setInterval(() => { if (!document.hidden) loadNotifications(); }, 60000);
  if (!startNotifications._wired) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && State.token) loadNotifications();
    });
    startNotifications._wired = true;
  }
}
function updateBell() {
  const b = $('#bellBadge'); if (!b) return;
  if (Notif.unread > 0) { b.textContent = Notif.unread > 99 ? '99+' : Notif.unread; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}
async function toggleNotifications() {
  Notif.open = !Notif.open;
  if (!Notif.open) { $('#notifRoot').innerHTML = ''; return; }
  renderNotifPop();
  // mark seen
  try { await api('/notifications/seen', { method: 'POST' }); Notif.unread = 0; updateBell(); } catch {}
}
function notifIcon(t) { return t === 'request' ? '📄' : '💬'; }
function renderNotifPop() {
  const root = $('#notifRoot'); if (!root) return;
  const seenAt = (State.user && State.user.notifications_seen_at) || '';
  const items = Notif.items;
  root.innerHTML = `<div class="notif-pop">
    <div class="nh"><span>Notifications</span><button class="btn ghost sm" id="notifClose">Close</button></div>
    ${items.length ? items.map((n) => {
      const label = n.type === 'request' ? 'Screensaver requested' : `${esc(n.party || '')} feedback`;
      return `<div class="notif-item" data-nv="${n.video_id || ''}">
        <div class="ic ${n.type}">${notifIcon(n.type)}</div>
        <div class="nt">
          <div class="nm"><b>${esc(n.code_name || 'Project')}</b> — ${label}</div>
          ${n.message ? `<div class="sn">${esc(n.message)}</div>` : ''}
          <div class="wh">${esc(n.actor_name || '')} · ${istDateTime(n.created_at)}</div>
        </div>
      </div>`;
    }).join('') : '<div class="notif-empty">No notifications yet.</div>'}
  </div>`;
  $('#notifClose').addEventListener('click', toggleNotifications);
  root.querySelectorAll('[data-nv]').forEach((el2) => el2.addEventListener('click', () => {
    const vid = Number(el2.dataset.nv);
    Notif.open = false; root.innerHTML = '';
    if (vid) openDetail(vid);
  }));
}

function renderNav() {
  document.querySelectorAll('#nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === State.view));
}

function renderView() {
  if (State.view === 'users' && State.user.role === 'admin') return renderUsers();
  return renderDashboard();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function renderDashboard() {
  const root = $('#viewRoot');
  root.innerHTML = `<div class="page-head"><div><h2>Project Dashboard</h2>
    <div class="muted">Track each screensaver from briefing through review to finalized delivery.</div></div>
    <div><button class="btn" id="newBtn">+ New Project</button></div></div>
    <div class="stats" id="stats"></div>
    <div id="recentFb"></div>
    <div class="toolbar" id="toolbar"></div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`;
  $('#newBtn').addEventListener('click', openNewProject);
  await refreshDashboard();
  loadNotifications();
}

async function refreshDashboard() {
  const [{ stats }, listData] = await Promise.all([
    api('/videos/stats'),
    api('/videos' + queryString()),
  ]);
  State.stats = stats;
  State.videos = listData.videos;
  renderStats();
  renderToolbar();
  renderList();
}

function queryString() {
  const p = new URLSearchParams();
  if (State.filter.country) p.set('country', State.filter.country);
  if (State.filter.status) p.set('status', State.filter.status);
  if (State.filter.requested) p.set('requested', '1');
  if (State.filter.q) p.set('q', State.filter.q);
  const s = p.toString();
  return s ? '?' + s : '';
}

function renderStats() {
  const s = State.stats;
  const cards = [
    ['total', 'Total Projects', s.total, ''],
    ['pending', 'Pending', s.pending, 'pending'],
    ['under_review', 'Under Review', s.under_review, 'under_review'],
    ['completed', 'Completed', s.completed, 'completed'],
    ['finalized', 'Finalized', s.finalized, 'finalized'],
    ['screensaver_requested', 'Screensaver Requested', s.screensaver_requested, '__req__'],
  ];
  $('#stats').innerHTML = cards.map(([key, label, n, filterVal]) => {
    const active = filterVal === '__req__' ? State.filter.requested : (State.filter.status === filterVal && filterVal);
    return `<div class="stat s-${key} ${active ? 'active' : ''}" data-status="${filterVal}">
      <div class="n">${n}</div><div class="l">${label}</div>
    </div>`;
  }).join('');
  $('#stats').querySelectorAll('.stat').forEach((c) => c.addEventListener('click', () => {
    const st = c.dataset.status;
    if (st === '__req__') {
      State.filter.requested = !State.filter.requested;
    } else {
      State.filter.status = (State.filter.status === st) ? '' : st;
    }
    refreshDashboard();
  }));
}

function renderRecentFeedback() {
  const box = document.getElementById('recentFb'); if (!box) return;
  const fb = Notif.items.filter((n) => n.type === 'feedback').slice(0, 6);
  if (!fb.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section recent-fb"><h3>Recent Feedback Received <span class="count-badge has">${fb.length}</span></h3><div class="body">
    ${fb.map((n) => {
      const cls = n.party === 'HP' ? 'hp' : n.party === 'Arc WW' ? 'arc' : 'kin';
      return `<div class="section-row">
        <span class="code2" data-nv="${n.video_id || ''}">${esc(n.code_name || 'Project')}</span>
        <span class="party ${cls}" style="font-weight:800">${esc(n.party || '')}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.message || '')}</span>
        <span class="w">${esc(n.actor_name || '')} · ${istDateTime(n.created_at)}</span>
      </div>`;
    }).join('')}
  </div></div>`;
  box.querySelectorAll('[data-nv]').forEach((e2) => e2.addEventListener('click', () => { const v = Number(e2.dataset.nv); if (v) openDetail(v); }));
}

function renderToolbar() {
  const countries = [...new Set(State.videos.map((v) => v.country).filter(Boolean))].sort();
  // keep full country list from current data even when filtered: fetch from all is fine via videos
  const tb = $('#toolbar');
  tb.innerHTML = `
    <input class="search" id="q" placeholder="Search code or product…" value="${esc(State.filter.q)}">
    <select id="fCountry"><option value="">All countries</option>
      ${['SG','MY','TH','ID','VN','PH'].map((c) => `<option value="${c}" ${State.filter.country === c ? 'selected' : ''}>${c}</option>`).join('')}
    </select>
    <select id="fStatus"><option value="">All statuses</option>
      ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${State.filter.status === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <div class="spacer"></div>
    <span class="muted">${State.videos.length} shown</span>`;
  let t;
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { State.filter.q = e.target.value.trim(); refreshDashboard(); }, 300); });
  $('#fCountry').addEventListener('change', (e) => { State.filter.country = e.target.value; refreshDashboard(); });
  $('#fStatus').addEventListener('change', (e) => { State.filter.status = e.target.value; refreshDashboard(); });
}

function renderList() {
  const list = $('#list');
  if (!State.videos.length) { list.innerHTML = `<div class="empty">No projects match your filters.</div>`; return; }
  list.innerHTML = `
    <table><thead><tr>
      <th>Code</th><th class="hide-sm">Country</th><th>Product</th>
      <th>Working</th><th>Final</th><th class="hide-sm">Feedback</th><th>Status</th>
    </tr></thead><tbody>
    ${State.videos.map((v) => `
      <tr data-id="${v.id}">
        <td><div class="code">${esc(v.code_name)}</div><div class="prod hide-sm">${esc(v.bg_colour)} · ${esc(v.ratio)}</div></td>
        <td class="hide-sm"><span class="chip country">${esc(v.country || '—')}</span></td>
        <td><div class="prod">${esc(v.product_name || '—')}</div></td>
        <td><span class="count-badge ${v.assets.working ? 'has' : ''}">${v.assets.working}</span></td>
        <td><span class="count-badge ${v.assets.final ? 'has' : ''}">${v.assets.final}</span></td>
        <td class="hide-sm"><span class="count-badge ${v.feedback_count ? 'has' : ''}">${v.feedback_count}</span></td>
        <td><span class="pill ${v.status}">${STATUS_LABEL[v.status]}</span>${v.screensaver_requested ? '<br><span class="req-flag" style="margin-top:4px">📄 Requested</span>' : ''}</td>
      </tr>`).join('')}
    </tbody></table>`;
  list.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openDetail(Number(tr.dataset.id))));
}

/* ============================================================
   VIDEO DETAIL DRAWER
   ============================================================ */
let detailState = { fbTab: 'all', playingAssetId: null };

async function openDetail(id) {
  detailState = { fbTab: 'all', playingAssetId: null, videoId: id };
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="overlay"><div class="drawer"><div class="drawer-body"><div class="empty">Loading…</div></div></div></div>`;
  root.querySelector('.overlay').addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) closeModal(); });
  try {
    const data = await api('/videos/' + id);
    renderDetail(data);
  } catch (err) { toast(err.message, true); closeModal(); }
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

function renderDetail(data) {
  const { video: v, assets, feedback, logs } = data;
  const canUpload = State.user.role === 'admin' || State.user.can_upload;
  const working = assets.filter((a) => a.kind === 'working');
  const finals = assets.filter((a) => a.kind === 'final');
  if (!detailState.playingAssetId && assets.length) detailState.playingAssetId = assets[assets.length - 1].id;

  const requestBlock = v.status === 'finalized'
    ? ''
    : v.screensaver_requested
      ? `<div class="req-banner"><div class="txt">📄 <b>Screensaver file requested</b>${v.screensaver_requested_by ? ` by ${esc(v.screensaver_requested_by)}` : ''}${v.screensaver_requested_at ? ` · ${istDateTime(v.screensaver_requested_at)}` : ''}.${canUpload ? ' Upload the final screensaver below to fulfil it.' : ''}</div></div>`
      : `<div class="req-banner"><div class="txt">Need the final screensaver file for this project?</div><button class="btn warn" id="reqBtn">📄 Request Screensaver File</button></div>`;

  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="overlay"><div class="drawer">
    <div class="drawer-head">
      <div><div class="code" style="font-size:16px;color:#fff">${esc(v.code_name)}</div>
        <div style="opacity:.75;font-size:12.5px;margin-top:3px">${esc(v.product_name || '')}</div></div>
      <button class="x" id="closeX">×</button>
    </div>
    <div class="drawer-body">
      <!-- status + meta -->
      <div class="section"><div class="body">
        <div class="row" style="justify-content:space-between">
          <span class="pill ${v.status}">${STATUS_LABEL[v.status]}</span>
          <label class="row" style="gap:6px;font-weight:600;font-size:12.5px;margin:0">Change status:
            <select id="statusSel" style="width:auto">
              ${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${v.status === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
        </div>
        <div class="meta-grid" style="margin-top:14px">
          ${metaItem('Country', v.country)}${metaItem('Background', v.bg_colour)}
          ${metaItem('Ratio', v.ratio)}${metaItem('Processor', v.processor)}
          ${metaItem('Briefing date', istDate(v.briefing_date))}${metaItem('Warranty', v.warranty)}
          ${metaItem('KSP 1', v.ksp1)}${metaItem('KSP 2', v.ksp2)}
          ${metaItem('KSP 3', v.ksp3)}${metaItem('MS Office', v.ms_office)}
          ${metaItem('Promo / Accessory', v.promo)}
        </div>
      </div></div>

      ${requestBlock}

      <!-- player -->
      <div class="section"><h3>Video Player</h3><div class="body" id="playerBox"></div></div>

      <!-- working versions -->
      <div class="section"><h3>Working Videos <span class="count-badge ${working.length ? 'has' : ''}">${working.length}</span></h3>
        <div class="body">
          <div id="workingList">${working.length ? working.map((a) => assetRow(a)).join('') : '<div class="muted">No working videos uploaded yet.</div>'}</div>
          ${canUpload ? uploadBox('working') : ''}
        </div>
      </div>

      <!-- final versions -->
      <div class="section"><h3>Final Screensaver <span class="count-badge ${finals.length ? 'has' : ''}">${finals.length}</span></h3>
        <div class="body">
          <div id="finalList">${finals.length ? finals.map((a) => assetRow(a)).join('') : '<div class="muted">No final screensaver uploaded yet. Uploading one marks the project <b>Finalized</b>.</div>'}</div>
          ${canUpload ? uploadBox('final') : ''}
        </div>
      </div>

      <!-- feedback -->
      <div class="section"><h3>Feedback &amp; Review Log <span class="count-badge ${feedback.length ? 'has' : ''}">${feedback.length}</span></h3>
        <div class="fb-tabs" id="fbTabs">
          <button data-tab="all" class="active">All</button>
          <button data-tab="HP">HP Client</button>
          <button data-tab="Arc WW">Arc WW</button>
        </div>
        <div class="body">
          <div id="fbList"></div>
          <div class="upload-box" style="margin-top:10px">
            <div class="row" style="margin-bottom:8px">
              <label class="row" style="gap:6px;font-weight:600;margin:0">As:
                <select id="fbParty" style="width:auto">
                  ${PARTIES.map((p) => `<option value="${p}" ${State.user.org === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select></label>
            </div>
            <textarea id="fbBody" placeholder="Add feedback / revision notes…"></textarea>
            <div class="row" style="justify-content:flex-end;margin-top:8px">
              <button class="btn sm" id="fbSend">Post feedback</button>
            </div>
          </div>
        </div>
      </div>

      <!-- activity log -->
      <div class="section"><h3>Activity Log</h3><div class="body" id="logBox">
        ${logs.length ? logs.map((l) => `<div class="log-item"><span class="when">${istDateTime(l.created_at)}</span><span><b class="who">${esc(l.actor_name || 'system')}</b> — ${esc(l.detail || l.action)}</span></div>`).join('') : '<div class="muted">No activity yet.</div>'}
      </div></div>

      ${State.user.role === 'admin' ? `<div class="row" style="justify-content:flex-end"><button class="btn danger sm" id="delProj">Delete project</button></div>` : ''}
    </div>
  </div></div>`;

  const overlay = root.querySelector('.overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#closeX').addEventListener('click', closeModal);
  renderPlayer(assets);
  renderFeedbackList(feedback);

  // status change
  $('#statusSel').addEventListener('change', async (e) => {
    try { await api('/videos/' + v.id, { method: 'PATCH', body: { status: e.target.value } }); toast('Status updated'); reopen(v.id); }
    catch (err) { toast(err.message, true); }
  });
  // request screensaver file
  if ($('#reqBtn')) $('#reqBtn').addEventListener('click', async () => {
    try { await api(`/videos/${v.id}/request-screensaver`, { method: 'POST' }); toast('Screensaver file requested'); reopen(v.id); }
    catch (err) { toast(err.message, true); }
  });
  // feedback tabs
  $('#fbTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    detailState.fbTab = b.dataset.tab;
    $('#fbTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderFeedbackList(feedback);
  });
  // post feedback
  $('#fbSend').addEventListener('click', async () => {
    const body = $('#fbBody').value.trim(); if (!body) return;
    try {
      await api(`/videos/${v.id}/feedback`, { method: 'POST', body: { party: $('#fbParty').value, body } });
      toast('Feedback posted'); reopen(v.id);
    } catch (err) { toast(err.message, true); }
  });
  // asset actions (play / download / delete)
  root.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => { detailState.playingAssetId = Number(b.dataset.play); renderPlayer(assets); window.scrollTo && root.querySelector('.drawer').scrollTo({ top: 0, behavior: 'smooth' }); }));
  root.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => downloadAsset(Number(b.dataset.dl))));
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this file?')) return;
    try { await api('/assets/' + b.dataset.del, { method: 'DELETE' }); toast('File deleted'); reopen(v.id); }
    catch (err) { toast(err.message, true); }
  }));
  // upload handlers
  root.querySelectorAll('[data-upload]').forEach((box) => wireUpload(box, v.id));
  // delete project
  if ($('#delProj')) $('#delProj').addEventListener('click', async () => {
    if (!confirm('Delete this project and all its files? This cannot be undone.')) return;
    try { await api('/videos/' + v.id, { method: 'DELETE' }); toast('Project deleted'); closeModal(); refreshDashboard(); }
    catch (err) { toast(err.message, true); }
  });
}

function metaItem(k, val) { return `<div class="m"><div class="k">${esc(k)}</div><div class="v">${esc(val || '—')}</div></div>`; }

function assetRow(a) {
  const isAdmin = State.user.role === 'admin';
  const canDelete = isAdmin || a.uploaded_by === State.user.id; // uploaded_by not sent; admin can always
  const isVideo = (a.mime || '').startsWith('video');
  return `<div class="asset-row">
    <span class="vlabel ${a.kind === 'final' ? 'final' : ''}">${esc(a.version_label)}</span>
    <div class="ainfo"><div class="nm">${esc(a.original_name)}</div>
      <div class="sub">${fileSize(a.size)} · uploaded ${esc(a.uploaded_name || '')} · ${istDateTime(a.uploaded_at)}</div></div>
    ${isVideo ? `<button class="btn sm secondary" data-play="${a.id}">▶ Play</button>` : ''}
    <button class="btn sm secondary" data-dl="${a.id}">↓ Download</button>
    <button class="btn sm danger" data-del="${a.id}">Delete</button>
  </div>`;
}

function renderPlayer(assets) {
  const box = $('#playerBox'); if (!box) return;
  const a = assets.find((x) => x.id === detailState.playingAssetId);
  if (!a) { box.innerHTML = `<div class="no-video">No video selected. Upload a working video to preview it here.</div>`; return; }
  if (!(a.mime || '').startsWith('video')) {
    box.innerHTML = `<div class="no-video">“${esc(a.original_name)}” is not a previewable video. Use Download instead.</div>`;
    return;
  }
  box.innerHTML = `
    <video controls preload="metadata" src="${BASE}/api/assets/${a.id}/stream?token=${encodeURIComponent(State.token)}"></video>
    <div class="row" style="justify-content:space-between;margin-top:8px">
      <span class="muted">Now playing: <b>${esc(a.version_label)}</b> — ${esc(a.original_name)}</span>
      <button class="btn sm secondary" data-dl2="${a.id}">↓ Download this</button>
    </div>`;
  box.querySelector('[data-dl2]').addEventListener('click', () => downloadAsset(a.id));
}

function downloadAsset(id) {
  const link = document.createElement('a');
  link.href = `${BASE}/api/assets/${id}/download?token=${encodeURIComponent(State.token)}`;
  document.body.appendChild(link); link.click(); link.remove();
}

function renderFeedbackList(feedback) {
  const box = $('#fbList'); if (!box) return;
  let items = feedback;
  if (detailState.fbTab !== 'all') items = feedback.filter((f) => f.party === detailState.fbTab);
  if (!items.length) { box.innerHTML = `<div class="muted">No feedback in this view yet.</div>`; return; }
  box.innerHTML = items.map((f) => {
    const cls = f.party === 'HP' ? 'hp' : f.party === 'Arc WW' ? 'arc' : 'kin';
    const canDel = State.user.role === 'admin' || f.author_id === State.user.id;
    return `<div class="fb-item ${cls}">
      <div class="head"><span class="party ${cls}">${esc(f.party)}</span>
        <span>· ${esc(f.author_name || '')}</span>
        <span class="when">· ${istDateTime(f.created_at)}</span>
        ${canDel ? `<button class="btn ghost sm" data-fbdel="${f.id}" style="margin-left:auto">Delete</button>` : ''}</div>
      <div class="body">${esc(f.body)}</div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-fbdel]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await api('/feedback/' + b.dataset.fbdel, { method: 'DELETE' }); toast('Feedback removed');
      if (detailState.videoId) reopen(detailState.videoId); }
    catch (err) { toast(err.message, true); }
  }));
}

function uploadBox(kind) {
  return `<div class="upload-box" data-upload="${kind}" style="margin-top:12px">
    <div class="row">
      <input type="file" multiple accept="${kind === 'working' ? 'video/*' : 'video/*,.zip,.scr,.exe,.mp4,.mov'}" style="width:auto;flex:1">
      <input type="text" placeholder="Version label (optional, e.g. ${kind === 'final' ? 'Final' : 'V1'})" style="width:auto;max-width:200px">
      <button class="btn sm" data-upbtn>Upload ${kind === 'final' ? 'final' : 'working'}</button>
    </div>
    <div class="sub" style="margin-top:6px;color:var(--ink-soft)">Tip: select several files to upload multiple ${kind === 'final' ? 'final' : 'working'} versions at once — they'll be added as ${kind === 'final' ? 'Final, Final 2…' : 'V1, V2, V3…'}</div>
    <div class="upstatus muted hidden" style="margin-top:6px"></div>
    <div class="progress hidden"><i></i></div>
  </div>`;
}

function wireUpload(box, videoId) {
  const kind = box.dataset.upload;
  const fileInput = box.querySelector('input[type=file]');
  const labelInput = box.querySelector('input[type=text]');
  const btn = box.querySelector('[data-upbtn]');
  const prog = box.querySelector('.progress');
  const bar = box.querySelector('.progress > i');
  const status = box.querySelector('.upstatus');
  btn.addEventListener('click', async () => {
    const files = Array.from(fileInput.files);
    if (!files.length) { toast('Choose one or more files first', true); return; }
    const baseLabel = labelInput.value.trim();
    btn.disabled = true; prog.classList.remove('hidden');
    try {
      for (let i = 0; i < files.length; i++) {
        // With a custom label and several files, suffix the index; otherwise let
        // the server auto-number (V1, V2… / Final, Final 2…).
        const label = baseLabel ? (files.length > 1 ? `${baseLabel} ${i + 1}` : baseLabel) : '';
        if (files.length > 1) {
          status.classList.remove('hidden');
          status.textContent = `Uploading ${i + 1} of ${files.length}: ${files[i].name}`;
        }
        bar.style.width = '0%';
        await uploadAsset(videoId, files[i], kind, label, (p) => { bar.style.width = Math.round(p * 100) + '%'; });
      }
      toast(files.length > 1 ? `${files.length} files uploaded` : 'Upload complete');
      reopen(videoId);
    } catch (err) { toast(err.message, true); btn.disabled = false; prog.classList.add('hidden'); status.classList.add('hidden'); }
  });
}

function reopen(id) { openDetail(id); refreshDashboardQuiet(); loadNotifications(); }
async function refreshDashboardQuiet() { if (State.view === 'dashboard') { try { await refreshDashboard(); } catch {} } }

/* ============================================================
   NEW PROJECT MODAL
   ============================================================ */
function openNewProject() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="overlay center"><div class="modal-sm">
    <div class="mh"><h3>New Screensaver Project</h3><button class="x" id="npX" style="background:#eef2f7;color:#333">×</button></div>
    <div class="mb">
      <form id="npForm">
        <label class="field"><span>Code name *</span><input id="np_code" required placeholder="e.g. SGUBOBU00IN"></label>
        <label class="field"><span>Product name</span><input id="np_prod" placeholder="OmniBook Ultra 14&quot; Next Gen AI PC"></label>
        <div class="row">
          <label class="field" style="flex:1"><span>Country</span>
            <select id="np_country"><option value="">—</option>${['SG','MY','TH','ID','VN','PH'].map((c) => `<option>${c}</option>`).join('')}</select></label>
          <label class="field" style="flex:1"><span>Ratio</span>
            <select id="np_ratio"><option value="">—</option><option>16:10</option><option>16:9</option></select></label>
        </div>
        <label class="field"><span>Background colour</span><input id="np_bg" placeholder="e.g. 06 Electric Cobalt"></label>
        <p class="err" id="npErr"></p>
        <button class="btn block" type="submit">Create project</button>
      </form>
    </div>
  </div></div>`;
  const overlay = root.querySelector('.overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#npX').addEventListener('click', closeModal);
  $('#npForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/videos', { method: 'POST', body: {
        code_name: $('#np_code').value, product_name: $('#np_prod').value,
        country: $('#np_country').value, ratio: $('#np_ratio').value, bg_colour: $('#np_bg').value,
      } });
      toast('Project created'); closeModal(); refreshDashboard();
    } catch (err) { $('#npErr').textContent = err.message; }
  });
}

/* ============================================================
   CHANGE PASSWORD MODAL
   ============================================================ */
function openChangePassword() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="overlay center"><div class="modal-sm">
    <div class="mh"><h3>Change Password</h3><button class="x" id="cpX" style="background:#eef2f7;color:#333">×</button></div>
    <div class="mb"><form id="cpForm">
      <label class="field"><span>Current password</span><input type="password" id="cp_cur" required></label>
      <label class="field"><span>New password (min 6 chars)</span><input type="password" id="cp_new" required></label>
      <p class="err" id="cpErr"></p>
      <button class="btn block" type="submit">Update password</button>
    </form></div>
  </div></div>`;
  const overlay = root.querySelector('.overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#cpX').addEventListener('click', closeModal);
  $('#cpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/auth/password', { method: 'POST', body: { current: $('#cp_cur').value, next: $('#cp_new').value } });
      toast('Password updated'); closeModal(); }
    catch (err) { $('#cpErr').textContent = err.message; }
  });
}

/* ============================================================
   ADMIN — USERS
   ============================================================ */
async function renderUsers() {
  const root = $('#viewRoot');
  root.innerHTML = `<div class="page-head"><div><h2>User Management</h2>
    <div class="muted">Create accounts and control who can upload videos. HP &amp; Arc WW reviewers, and your team.</div></div>
    <div><button class="btn" id="newUserBtn">+ New User</button></div></div>
    <div class="card" id="userList"><div class="empty">Loading…</div></div>`;
  $('#newUserBtn').addEventListener('click', openNewUser);
  await refreshUsers();
}

async function refreshUsers() {
  const { users } = await api('/users');
  const list = $('#userList');
  list.innerHTML = `
    <table><thead><tr>
      <th>Name</th><th>Email</th><th>Org</th><th>Role</th><th>Can upload</th><th>Active</th><th></th>
    </tr></thead><tbody>
    ${users.map((u) => {
      const orgTag = u.org === 'HP' ? 'org-hp' : u.org === 'Arc WW' ? 'org-arc' : 'org-kin';
      return `<tr>
        <td><b>${esc(u.name)}</b></td>
        <td>${esc(u.email)}</td>
        <td><span class="tag ${orgTag}">${esc(u.org)}</span></td>
        <td>${u.role === 'admin' ? '<span class="tag admin">Admin</span>' : 'User'}</td>
        <td>${u.role === 'admin' ? '<span class="badge-yes">Always</span>'
          : `<label style="cursor:pointer"><input type="checkbox" data-upl="${u.id}" ${u.can_upload ? 'checked' : ''} style="width:auto"></label>`}</td>
        <td>${u.active ? '<span class="badge-yes">Yes</span>' : '<span class="badge-no">No</span>'}</td>
        <td class="row" style="justify-content:flex-end;gap:6px">
          <button class="btn ghost sm" data-edit="${u.id}">Edit</button>
          ${u.role !== 'admin' || !u.email.endsWith('kinematicapp.com') ? '' : ''}
          <button class="btn danger sm" data-deluser="${u.id}" ${u.id === State.user.id ? 'disabled title="You cannot delete yourself"' : ''}>Delete</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table>`;
  // store user objects for edit
  list._users = users;
  list.querySelectorAll('[data-upl]').forEach((cb) => cb.addEventListener('change', async () => {
    try { await api('/users/' + cb.dataset.upl, { method: 'PATCH', body: { can_upload: cb.checked } });
      toast('Upload permission ' + (cb.checked ? 'granted' : 'revoked')); }
    catch (err) { toast(err.message, true); cb.checked = !cb.checked; }
  }));
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const u = users.find((x) => x.id === Number(b.dataset.edit)); openEditUser(u);
  }));
  list.querySelectorAll('[data-deluser]').forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === Number(b.dataset.deluser));
    if (!confirm(`Delete user ${u.email}?`)) return;
    try { await api('/users/' + u.id, { method: 'DELETE' }); toast('User deleted'); refreshUsers(); }
    catch (err) { toast(err.message, true); }
  }));
}

function userFormFields(u = {}) {
  return `
    <label class="field"><span>Full name *</span><input id="u_name" required value="${esc(u.name || '')}"></label>
    <label class="field"><span>Email *</span><input id="u_email" type="email" required value="${esc(u.email || '')}" ${u.id ? 'disabled' : ''}></label>
    <div class="row">
      <label class="field" style="flex:1"><span>Organisation</span>
        <select id="u_org">${ORGS.map((o) => `<option ${u.org === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      <label class="field" style="flex:1"><span>Role</span>
        <select id="u_role"><option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></label>
    </div>
    <label class="field row" style="gap:8px;align-items:center;font-weight:600">
      <input type="checkbox" id="u_upload" ${u.can_upload ? 'checked' : ''} style="width:auto"> Allow uploading videos</label>
    <label class="field"><span>${u.id ? 'Reset password (leave blank to keep)' : 'Password *'}</span>
      <input id="u_pass" type="text" ${u.id ? '' : 'required'} placeholder="${u.id ? '••••••••' : 'min 6 characters'}"></label>`;
}

function openNewUser() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="overlay center"><div class="modal-sm">
    <div class="mh"><h3>Create User</h3><button class="x" id="nuX" style="background:#eef2f7;color:#333">×</button></div>
    <div class="mb"><form id="nuForm">${userFormFields()}
      <p class="err" id="nuErr"></p><button class="btn block" type="submit">Create user</button></form></div>
  </div></div>`;
  const overlay = root.querySelector('.overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#nuX').addEventListener('click', closeModal);
  $('#nuForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: {
        name: $('#u_name').value, email: $('#u_email').value, password: $('#u_pass').value,
        org: $('#u_org').value, role: $('#u_role').value, can_upload: $('#u_upload').checked,
      } });
      toast('User created'); closeModal(); refreshUsers();
    } catch (err) { $('#nuErr').textContent = err.message; }
  });
}

function openEditUser(u) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
  <div class="overlay center"><div class="modal-sm">
    <div class="mh"><h3>Edit ${esc(u.name)}</h3><button class="x" id="euX" style="background:#eef2f7;color:#333">×</button></div>
    <div class="mb"><form id="euForm">${userFormFields(u)}
      <p class="err" id="euErr"></p><button class="btn block" type="submit">Save changes</button></form></div>
  </div></div>`;
  const overlay = root.querySelector('.overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  $('#euX').addEventListener('click', closeModal);
  $('#euForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: $('#u_name').value, org: $('#u_org').value, role: $('#u_role').value,
      can_upload: $('#u_upload').checked,
    };
    const pass = $('#u_pass').value.trim();
    if (pass) body.password = pass;
    try { await api('/users/' + u.id, { method: 'PATCH', body }); toast('User updated'); closeModal(); refreshUsers(); }
    catch (err) { $('#euErr').textContent = err.message; }
  });
}

/* ---------- boot ---------- */
init();
