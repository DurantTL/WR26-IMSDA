let currentUser = null;
let selectedRegistration = null;
let selectedBundle = null;
let html5QrCode = null;
let scannerRunning = false;
let offlineQueue = JSON.parse(localStorage.getItem('imsda_registration_queue') || '[]');

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

let loadingTimers = [];

function showLoading(message) {
  const overlay = $('loading-overlay');
  const msg = $('loading-message');
  if (!overlay) return;
  if (msg && message) msg.textContent = message;
  overlay.hidden = false;
}

function hideLoading() {
  loadingTimers.forEach(clearTimeout);
  loadingTimers = [];
  const overlay = $('loading-overlay');
  if (overlay) overlay.hidden = true;
}

// Sign-in kicks off a full data sync from Google Sheets. When the server cache
// is cold (e.g. right after a restart) and the group is large, that first sync
// can take the better part of a minute, so reassure staff while they wait.
async function bootstrapWithLoading() {
  const msg = $('loading-message');
  showLoading('Loading registrations…');
  loadingTimers.push(setTimeout(() => { if (msg) msg.textContent = 'Still loading — larger groups take a little longer the first time…'; }, 6000));
  loadingTimers.push(setTimeout(() => { if (msg) msg.textContent = 'Almost there — syncing every registration from Google Sheets. The first sign-in can take up to a minute.'; }, 18000));
  try {
    await bootstrap();
  } finally {
    hideLoading();
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function logActivity(message, good = true) {
  const list = $('activity-list');
  if (!list) return;
  const li = document.createElement('li');
  li.textContent = `${good ? '✓' : '⚠'} ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — ${message}`;
  list.prepend(li);
  while (list.children.length > 8) list.removeChild(list.lastChild);
}

function saveQueue() {
  localStorage.setItem('imsda_registration_queue', JSON.stringify(offlineQueue));
  updateQueueUI();
}

function updateQueueUI() {
  const bar = $('offline-queue-bar');
  const count = $('queue-count');
  if (!bar || !count) return;
  count.textContent = offlineQueue.length;
  bar.style.display = offlineQueue.length ? 'flex' : 'none';
}

function enqueueAction(action) {
  offlineQueue.push({ clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString(), ...action });
  saveQueue();
  logActivity(`Queued ${action.type} for ${action.registrationId}`, false);
  showToast('Offline action queued. Sync when back online.');
}

function updateOnlineStatus() {
  const status = $('connection-status');
  if (!status) return;
  const online = navigator.onLine;
  status.textContent = online ? 'Online' : 'Offline';
  status.className = `status-indicator ${online ? 'online' : 'offline'}`;
  if (online && offlineQueue.length) processOfflineQueue().catch(() => {});
}

async function api(path, options = {}) {
  const request = {
    method: options.method || 'GET',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  };
  if (options.body) request.body = JSON.stringify(options.body);
  const response = await fetch(path, request);
  const payload = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }));
  if (response.status === 401 || response.status === 403) {
    showAuth('Session expired. Sign in again.');
    throw new Error('UNAUTHORIZED');
  }
  if (!response.ok || payload.success === false) throw new Error(payload.error || payload.message || 'Request failed');
  if (payload.sync) setSync(payload.sync);
  return payload;
}

function setSync(sync) {
  if (!sync || !sync.lastSyncAt) {
    $('sync-status').textContent = 'Cache not loaded';
    return;
  }
  const d = new Date(sync.lastSyncAt);
  const label = Number.isNaN(d.getTime()) ? sync.lastSyncAt : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('sync-status').textContent = `Cached ${label} • ${sync.registrationsCached || 0} regs`;
}

function showMagicLogin() {
  $('login-magic-section').hidden = false;
  $('login-form').hidden = true;
  $('login-error').hidden = true;
}

function showPasswordLogin() {
  $('login-magic-section').hidden = true;
  $('login-form').hidden = false;
  $('login-error').hidden = true;
}

function showAuth(message = '') {
  currentUser = null;
  $('auth').classList.add('visible');
  $('user-display').textContent = 'Staff sign-in required';
  const emailEl = $('login-email');
  const sendBtn = $('send-login-link');
  const sentMsg = $('login-magic-sent');
  if (emailEl) { emailEl.disabled = false; emailEl.value = ''; }
  if (sendBtn) sendBtn.disabled = false;
  if (sentMsg) sentMsg.hidden = true;
  showMagicLogin();
  if (message) {
    $('login-error').textContent = message;
    $('login-error').hidden = false;
  }
}

function hideAuth() {
  $('auth').classList.remove('visible');
  $('login-error').hidden = true;
}

async function requestStaffMagicLink() {
  const email = $('login-email').value.trim();
  if (!email) {
    $('login-error').textContent = 'Enter your email address.';
    $('login-error').hidden = false;
    return;
  }
  $('login-error').hidden = true;
  $('send-login-link').disabled = true;
  try {
    await api('/api/auth/magic-link/request', { method: 'POST', body: { email } });
    $('login-magic-sent').textContent = 'Check your email for a login link. It expires in 30 minutes.';
    $('login-magic-sent').hidden = false;
    $('login-email').disabled = true;
  } catch (error) {
    $('login-error').textContent = error.message;
    $('login-error').hidden = false;
    $('send-login-link').disabled = false;
  }
}

async function restoreSession() {
  updateQueueUI();
  updateOnlineStatus();
  const params = new URLSearchParams(window.location.search);
  const staffToken = params.get('staff_token');
  if (staffToken) {
    window.history.replaceState({}, '', window.location.pathname);
    try {
      const payload = await api('/api/auth/magic-link/verify', { method: 'POST', body: { token: staffToken } });
      currentUser = payload.user;
      $('user-display').textContent = `Signed in as ${currentUser.username}`;
      hideAuth();
      await bootstrapWithLoading();
    } catch (error) {
      showAuth(error.message === 'UNAUTHORIZED' ? 'Login link is invalid or expired.' : error.message);
    }
    return;
  }
  try {
    const payload = await api('/api/auth/me');
    currentUser = payload.user;
    $('user-display').textContent = `Signed in as ${currentUser.username}`;
    hideAuth();
    await bootstrapWithLoading();
  } catch (_error) {
    showAuth();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  $('login-error').hidden = true;
  try {
    const payload = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('login-username').value.trim(), password: $('login-password').value },
    });
    currentUser = payload.user;
    $('login-password').value = '';
    $('user-display').textContent = `Signed in as ${currentUser.username}`;
    hideAuth();
    await bootstrapWithLoading();
  } catch (error) {
    $('login-error').textContent = error.message === 'UNAUTHORIZED' ? 'Sign in failed.' : error.message;
    $('login-error').hidden = false;
  }
}

function applyRoleVisibility() {
  const roles = (currentUser && Array.isArray(currentUser.roles)) ? currentUser.roles : [];
  const staffBtn = $('staff-tab-btn');
  if (staffBtn) staffBtn.hidden = !roles.includes('admin');
}

async function bootstrap() {
  applyRoleVisibility();
  // Load live seminar titles so attendee + worker dropdowns match what's
  // assignable. Non-fatal — falls back to built-in option values.
  await window.WR26_OPTIONS.loadSeminars('/api/seminars/public').catch(() => {});
  const meal = $('worker-meal');
  if (meal && !meal.options.length) meal.innerHTML = window.WR26_OPTIONS.selectHtml('', '', window.WR26_OPTIONS.MEAL_OPTIONS).replace(/^<select[^>]*>/, '').replace(/<\/select>$/, '');
  const payload = await api('/api/bootstrap');
  renderStats(payload.stats);
  await search();
}

function renderStats(statsPayload) {
  const stats = statsPayload && statsPayload.stats ? statsPayload.stats : {};
  const cards = [
    ['Checked In', stats.checkedIn ?? 0],
    ['Expected', stats.notCheckedIn ?? 0],
    ['Pending Pay', stats.paymentsPending ?? 0],
  ];
  $('dashboard-stats').innerHTML = cards.map(([label, value]) => `<div class="stat-card"><span class="stat-val">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`).join('');
}

function setVisible(id, visible) {
  const el = $(id);
  if (el) el.hidden = !visible;
}

async function stopScanner() {
  if (html5QrCode && scannerRunning) {
    await html5QrCode.stop().catch(() => {});
    scannerRunning = false;
  }
  const reader = $('reader');
  if (reader) reader.style.display = 'none';
  const scanBtn = $('scan-btn');
  if (scanBtn) scanBtn.textContent = '📷 Start Scanner';
}

function switchTab(tab) {
  document.querySelectorAll('.search-tabs .tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.search-section .tab').forEach((panel) => panel.classList.remove('active'));
  const panel = $(`tab-${tab}`);
  if (panel) panel.classList.add('active');

  const detailTabs = ['detail', 'payments', 'checkin', 'magic', 'transfer'];
  setVisible('results', !detailTabs.includes(tab) && tab !== 'scan' && tab !== 'tools' && tab !== 'staff');
  setVisible('detail-wrap', tab === 'detail' && !!selectedRegistration);
  setVisible('payment-panel', tab === 'payments');
  setVisible('checkin-panel', tab === 'checkin');
  setVisible('magic-panel', tab === 'magic');
  setVisible('transfer-panel', tab === 'transfer');
  setVisible('tools-panel', tab === 'tools');
  setVisible('staff-panel', tab === 'staff');
  if (tab === 'checkin' && selectedBundle) renderCheckinBalance(selectedBundle);
  if (tab !== 'scan') stopScanner().catch(() => {});

  if (detailTabs.includes(tab) && !selectedRegistration) showToast('Select a registration first.');
}

function paymentClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid' || s === 'paid_onsite') return 'checked-in';
  if (s.includes('pending')) return 'not-arrived';
  return 'neutral';
}

async function search() {
  const params = new URLSearchParams();
  if ($('search').value.trim()) params.set('q', $('search').value.trim());
  if ($('payment-filter').value) params.set('paymentStatus', $('payment-filter').value);
  const payload = await api(`/api/registrations?${params.toString()}`);
  renderResults(payload.registrations || []);
  switchTab('registrations');
}

function renderResults(rows) {
  if (!rows.length) {
    $('results').innerHTML = '<div class="info-msg">No registrations found.</div>';
    return;
  }
  $('results').innerHTML = rows.map((r) => `
    <article class="card result-card ${selectedRegistration === r.registrationId ? 'selected' : ''}" data-id="${escapeHtml(r.registrationId)}">
      <div class="result-header"><strong>${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</strong><span class="badge">${escapeHtml(r.registrationId)}</span></div>
      <div class="result-meta">${escapeHtml(r.email)}${r.phone ? ' • ' + escapeHtml(r.phone) : ''}<br>${escapeHtml(r.church || 'No church listed')}</div>
      <div class="result-badges"><span class="status-badge ${paymentClass(r.paymentStatus)}">${escapeHtml(r.paymentStatus || 'payment unknown')}</span><span class="status-badge neutral">$${escapeHtml(r.finalAmount ?? '')}</span><span class="status-badge neutral">${escapeHtml(r.attendeeCount ?? 0)} attendees</span>${String(r.checkedIn).toLowerCase() === 'true' ? '<span class="status-badge checked-in">Checked In</span>' : ''}</div>
      <div class="result-action"><button class="btn btn-primary btn-sm">Open →</button></div>
    </article>
  `).join('');
}

async function selectRegistration(id) {
  selectedRegistration = id;
  const payload = await api(`/api/registration/${encodeURIComponent(id)}`);
  selectedBundle = payload.registration;
  renderDetail(selectedBundle);
  fillActionTargets(selectedBundle);
  switchTab('detail');
}

async function openScannedRegistration(scanValue) {
  const payload = await api(`/api/scan/${encodeURIComponent(scanValue)}`);
  selectedBundle = payload.registration;
  selectedRegistration = selectedBundle.registrationId;
  renderDetail(selectedBundle);
  fillActionTargets(selectedBundle);
  logActivity(`Scanned ${selectedBundle.firstName || ''} ${selectedBundle.lastName || ''}`.trim() || selectedBundle.registrationId);
  await stopScanner();
  switchTab('detail');
}

// Square card processing fee (matches GAS calculateSquareFee defaults: 2.9% + $0.30).
// Used only to *display* the card total at check-in so staff can collect via the
// Square app; the authoritative charge is still recorded server-side.
const SQUARE_FEE_PERCENT = 2.9;
const SQUARE_FEE_FIXED = 0.30;

function balanceFor(reg) {
  const billed = Number(reg.finalAmount || 0);
  const collected = Number(reg.amountPaid != null && reg.amountPaid !== '' ? reg.amountPaid : 0);
  return Math.round((billed - collected) * 100) / 100;
}

function squareTotal(amount) {
  if (!(amount > 0)) return 0;
  return Math.round((amount + amount * (SQUARE_FEE_PERCENT / 100) + SQUARE_FEE_FIXED) * 100) / 100;
}

function renderCheckinBalance(reg) {
  const box = $('checkin-balance');
  if (!box) return;
  const status = String(reg.paymentStatus || '').toLowerCase();
  const balance = balanceFor(reg);
  if (status === 'paid' || status === 'paid_onsite' || balance <= 0) {
    box.className = 'balance-box paid';
    box.innerHTML = `<span class="balance-amount">Paid in full</span><span class="balance-sub">${escapeHtml(reg.paymentStatus || '')}</span>`;
  } else {
    box.className = 'balance-box';
    box.innerHTML = `<span class="balance-amount">Balance due: $${escapeHtml(balance.toFixed(2))}</span><span class="balance-sub">If paying by card in the Square app, charge $${escapeHtml(squareTotal(balance).toFixed(2))} (incl. ${SQUARE_FEE_PERCENT}% + $${SQUARE_FEE_FIXED.toFixed(2)} fee). Status: ${escapeHtml(reg.paymentStatus || 'unknown')}</span>`;
  }
  box.hidden = false;
}

function fillActionTargets(reg) {
  $('payment-target').textContent = `${reg.firstName} ${reg.lastName} • ${reg.registrationId}`;
  $('pay-amount').value = balanceFor(reg) > 0 ? balanceFor(reg) : (reg.finalAmount || '');
  $('checkin-target').textContent = `${reg.firstName} ${reg.lastName} • ${reg.registrationId}`;
  $('magic-email').value = reg.email || '';
  renderCheckinBalance(reg);
  const transferTarget = $('transfer-target');
  if (transferTarget) transferTarget.textContent = `${reg.firstName} ${reg.lastName} • ${reg.registrationId}`;
}

async function toggleScanner() {
  const reader = $('reader');
  if (!reader) return;
  if (scannerRunning) {
    await stopScanner();
    return;
  }
  if (typeof Html5Qrcode === 'undefined') {
    showToast('QR scanner library did not load.');
    return;
  }
  reader.style.display = 'block';
  $('scan-btn').textContent = 'Stop Scanner';
  html5QrCode = html5QrCode || new Html5Qrcode('reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decodedText) => openScannedRegistration(decodedText).catch((error) => showToast(error.message)),
      () => {}
    );
    scannerRunning = true;
  } catch (error) {
    reader.style.display = 'none';
    $('scan-btn').textContent = '📷 Start Scanner';
    showToast(`Camera unavailable: ${error.message || error}`);
  }
}

function field(name, label, value, type = 'text') {
  if (type === 'textarea') return `<label>${label}<textarea data-field="${name}" rows="2">${escapeHtml(value)}</textarea></label>`;
  return `<label>${label}<input data-field="${name}" value="${escapeHtml(value)}"></label>`;
}

function prefValue(attendee, slot, key) {
  const prefs = attendee.seminar_preferences || attendee.seminarPreferences || {};
  return prefs[slot] && prefs[slot][key] ? prefs[slot][key] : '';
}

function seminarPrefFields(attendee) {
  const O = window.WR26_OPTIONS;
  return O.SEMINAR_SLOTS.map((slotDef) => {
    const ranks = [];
    for (let r = 1; r <= slotDef.ranks; r += 1) {
      const label = slotDef.ranks > 1 ? `${slotDef.label} — Pref ${r}` : slotDef.label;
      const attr = `data-pref="${slotDef.slot}.pref_${r}"`;
      ranks.push(`<label>${escapeHtml(label)}${O.selectHtml(attr, prefValue(attendee, slotDef.slot, `pref_${r}`), O.seminarOptions(slotDef.slot), '- None -')}</label>`);
    }
    return ranks.join('');
  }).join('');
}

function attendeeEditor(attendee = {}, index = 0) {
  const O = window.WR26_OPTIONS;
  const attendeeId = attendee.attendee_id || '';
  const childcareYes = String(attendee.childcare_needed || '').toLowerCase() === 'yes';
  // Transfer is an in-place substitution of a saved attendee; hide it for new,
  // unsaved rows (no id yet — save the registration first).
  const transferToggle = attendeeId
    ? `<button class="btn btn-sm btn-white attendee-transfer-toggle" type="button" data-transfer-toggle="${index}">Transfer</button>`
    : '';
  const transferPanel = attendeeId ? `
    <div class="attendee-transfer" data-transfer-card="${index}" hidden>
      <h4>Transfer this person to someone else</h4>
      <p class="meta">Gives this seat to a new person and keeps the registration's payment. Meal, dietary, childcare, and seminar choices reset for the new person, who is emailed. The registration holder/payer is unchanged. Save other edits first — this writes immediately and reloads the registration.</p>
      <div class="form-grid compact-form">
        <label>New First Name<input data-transfer-field="newFirstName"></label>
        <label>New Last Name<input data-transfer-field="newLastName"></label>
        <label>New Email<input data-transfer-field="newEmail" type="email"></label>
        <label>New Phone<input data-transfer-field="newPhone" type="tel"></label>
        <label>New Church<input data-transfer-field="newChurch"></label>
        <label>Reason<input data-transfer-field="reason"></label>
      </div>
      <button class="btn btn-primary full-width" type="button" data-confirm-transfer="${index}" data-attendee-id="${escapeHtml(attendeeId)}">Transfer This Person</button>
    </div>` : '';
  return `<div class="attendee-card" data-attendee-index="${index}">
    <div class="portal-attendee-heading"><h3>Attendee ${index + 1}</h3><div class="portal-attendee-actions">${transferToggle}</div></div>
    <div class="form-grid">
      <label>First Name<input data-a="first_name" value="${escapeHtml(attendee.first_name)}"></label>
      <label>Last Name<input data-a="last_name" value="${escapeHtml(attendee.last_name)}"></label>
      <label>Phone<input data-a="phone" value="${escapeHtml(attendee.phone)}"></label>
      <label>Email<input data-a="email" value="${escapeHtml(attendee.email)}"></label>
      <label>Church<input data-a="church" value="${escapeHtml(attendee.church)}"></label>
      <label>Attendee Type${O.selectHtml('data-a="attendee_type"', attendee.attendee_type, O.ATTENDEE_TYPE_OPTIONS)}</label>
      <label>Meal Preference${O.selectHtml('data-a="meal_preference"', attendee.meal_preference, O.MEAL_OPTIONS)}</label>
      <label>Childcare Needed${O.selectHtml('data-a="childcare_needed"', attendee.childcare_needed, O.CHILDCARE_OPTIONS)}</label>
      <label class="portal-childcare-count" data-childcare-count${childcareYes ? '' : ' style="display:none"'}>How Many Children Need Care?<input data-a="childcare_children" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(attendee.childcare_children)}"></label>
      <label>Willing to Volunteer to Help?${O.selectHtml('data-a="volunteer"', attendee.volunteer, O.VOLUNTEER_OPTIONS)}</label>
      <label>Dietary Needs<textarea data-a="dietary_needs" rows="2">${escapeHtml(attendee.dietary_needs)}</textarea></label>
      <label>Notes<textarea data-a="notes" rows="2">${escapeHtml(attendee.notes)}</textarea></label>
    </div>
    <h4>Seminar Preferences</h4>
    <div class="form-grid">
      ${seminarPrefFields(attendee)}
    </div>
    <input type="hidden" data-a="attendee_id" value="${escapeHtml(attendeeId)}">
    ${transferPanel}
  </div>`;
}

function renderDetail(reg) {
  $('detail-wrap').hidden = false;
  $('detail').innerHTML = `<div class="card-header"><div><h2>${escapeHtml(reg.firstName)} ${escapeHtml(reg.lastName)}</h2><span class="badge-mono">${escapeHtml(reg.registrationId)} • ${escapeHtml(reg.email)}</span></div><span class="status-badge ${paymentClass(reg.paymentStatus)}">${escapeHtml(reg.paymentStatus)}</span></div>
    <div class="detail-grid">
      <p><strong>Church:</strong> ${escapeHtml(reg.church || '—')}</p>
      <p><strong>Phone:</strong> ${escapeHtml(reg.phone || '—')}</p>
      <p><strong>Amount:</strong> $${escapeHtml(reg.finalAmount || '0')}</p>
      <p><strong>Checked In:</strong> ${escapeHtml(reg.checkedIn || 'No')}</p>
    </div>
    <div class="form-grid compact-form">
      ${field('firstName', 'First Name', reg.firstName)}${field('lastName', 'Last Name', reg.lastName)}${field('phone', 'Phone', reg.phone)}${field('church', 'Church', reg.church)}${field('arrivalDate', 'Arrival Date', reg.arrivalDate)}${field('departureDate', 'Departure Date', reg.departureDate)}${field('emergencyContactName', 'Emergency Contact Name', reg.emergencyContactName)}${field('emergencyContactPhone', 'Emergency Contact Phone', reg.emergencyContactPhone)}${field('dietaryNeeds', 'Dietary Needs', reg.dietaryNeeds, 'textarea')}${field('specialNeeds', 'Special Needs', reg.specialNeeds, 'textarea')}
    </div>
    <div class="guest-list-section"><div class="guest-list-header"><strong>Attendees</strong><button id="add-attendee" class="btn btn-sm btn-white">Add</button></div><div id="attendee-list">${(reg.attendees || []).map(attendeeEditor).join('')}</div></div>
    <div class="detail-actions"><button id="save-detail" class="btn btn-primary full-width">Save Registration</button>
      <div class="btn-row"><button id="goto-transfer" class="btn btn-white">Transfer / Swap</button><button id="goto-refund" class="btn btn-white">Refund</button></div>
      <div class="resend-row">
        <input id="resend-email" type="email" autocomplete="off" placeholder="Send to a different email (optional — defaults to ${escapeHtml(reg.email || 'address on file')})">
        <button id="resend-confirmation" class="btn btn-white">Resend Confirmation Email</button>
      </div>
      <div id="resend-status" class="resend-status" aria-live="polite"></div></div>`;
}

function collectDetail() {
  const fields = {};
  document.querySelectorAll('#detail [data-field]').forEach((el) => { fields[el.dataset.field] = el.value; });
  const attendees = [];
  document.querySelectorAll('#detail .attendee-card').forEach((card) => {
    const attendee = { seminar_preferences: {} };
    card.querySelectorAll('[data-a]').forEach((el) => { attendee[el.dataset.a] = el.value; });
    // Only submit a children count when childcare is actually requested, so a stale/
    // imported count on an attendee whose childcare is "no" gets cleared rather than
    // re-saved as-is. Mirrors the registrant portal's collectPayload() gating.
    if (String(attendee.childcare_needed || '').toLowerCase() !== 'yes') attendee.childcare_children = '';
    card.querySelectorAll('[data-pref]').forEach((el) => {
      const [slot, key] = el.dataset.pref.split('.');
      attendee.seminar_preferences[slot] = attendee.seminar_preferences[slot] || {};
      attendee.seminar_preferences[slot][key] = el.value;
    });
    attendees.push(attendee);
  });
  return { fields, attendees };
}

async function saveDetail() {
  if (!selectedRegistration) return;
  const data = collectDetail();
  const payload = await api(`/api/registration/${encodeURIComponent(selectedRegistration)}`, { method: 'POST', body: data });
  selectedBundle = payload.registration || payload;
  showToast('Registration saved.');
  logActivity(`Saved ${selectedRegistration}`);
  await selectRegistration(selectedRegistration);
}

async function resendConfirmation() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const emailEl = $('resend-email');
  const statusEl = $('resend-status');
  const email = emailEl ? emailEl.value.trim() : '';
  if (statusEl) { statusEl.textContent = 'Sending…'; statusEl.classList.remove('error'); }
  try {
    const payload = await api(`/api/registration/${encodeURIComponent(selectedRegistration)}/resend-confirmation`, { method: 'POST', body: email ? { email } : {} });
    const sentTo = payload.sentTo || email || (selectedBundle && selectedBundle.email) || '';
    if (statusEl) statusEl.textContent = `Confirmation email sent${sentTo ? ' to ' + sentTo : ''}.`;
    if (emailEl) emailEl.value = '';
    showToast('Confirmation email sent.');
    logActivity(`Resent confirmation for ${selectedRegistration}${email ? ' → ' + email : ''}`);
  } catch (error) {
    if (statusEl) { statusEl.textContent = error.message; statusEl.classList.add('error'); }
    showToast(error.message);
  }
}

async function savePayment() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const action = { type: 'payment', registrationId: selectedRegistration, paymentMethod: $('pay-method').value, amountPaid: $('pay-amount').value, checkNumber: $('pay-check').value, paymentNotes: $('pay-notes').value };
  if (!navigator.onLine) return enqueueAction(action);
  await api('/api/payment', { method: 'POST', body: action });
  showToast('Payment saved.');
  logActivity(`Payment saved for ${selectedRegistration}`);
  await selectRegistration(selectedRegistration);
}

async function checkInSelected() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const action = { type: 'check-in', registrationId: selectedRegistration };
  if (!navigator.onLine) return enqueueAction(action);
  await api('/api/check-in', { method: 'POST', body: { registrationId: selectedRegistration } });
  showToast('Checked in.');
  logActivity(`Checked in ${selectedRegistration}`);
  await selectRegistration(selectedRegistration);
}

async function processOfflineQueue() {
  if (!offlineQueue.length || !navigator.onLine) return;
  const payload = await api('/api/offline-actions', { method: 'POST', body: { actions: offlineQueue } });
  const failedIds = new Set((payload.results || []).filter((r) => !r.success).map((r) => r.clientId));
  const successCount = (payload.results || []).filter((r) => r.success).length;
  offlineQueue = offlineQueue.filter((action) => failedIds.has(action.clientId));
  saveQueue();
  if (successCount) {
    showToast(`Synced ${successCount} offline action${successCount === 1 ? '' : 's'}.`);
    logActivity(`Synced ${successCount} offline action${successCount === 1 ? '' : 's'}`);
    await bootstrap();
  }
  if (offlineQueue.length) showToast(`${offlineQueue.length} offline action(s) still need attention.`);
}

async function sendMagicLink() {
  const email = $('magic-email').value.trim();
  const portalUrl = `${window.location.origin}/portal/`;
  const payload = await api('/api/magic-link/request', { method: 'POST', body: { email, portalUrl } });
  $('magic-status').textContent = payload.message || 'Link request processed.';
  logActivity(`Magic link requested for ${email}`);
}

async function saveRefund() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const amount = Number($('refund-amount').value);
  if (!(amount > 0)) return showToast('Enter a refund amount.');
  await api('/api/refund', { method: 'POST', body: { registrationId: selectedRegistration, amount, method: $('refund-method').value, reason: $('refund-reason').value, refundNotes: $('refund-notes').value } });
  $('refund-amount').value = ''; $('refund-reason').value = ''; $('refund-notes').value = '';
  showToast('Refund recorded.');
  logActivity(`Refund $${amount} for ${selectedRegistration}`);
  await selectRegistration(selectedRegistration);
}

async function saveTransfer() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const body = {
    registrationId: selectedRegistration,
    newFirstName: $('transfer-first').value.trim(),
    newLastName: $('transfer-last').value.trim(),
    newEmail: $('transfer-email').value.trim(),
    newPhone: $('transfer-phone').value.trim(),
    newChurch: $('transfer-church').value.trim(),
    reason: $('transfer-reason').value.trim(),
    refundNotes: $('transfer-refund-notes').value.trim(),
  };
  if (!body.newFirstName || !body.newLastName || !body.newEmail) return showToast('New first name, last name, and email are required.');
  const payload = await api('/api/transfer', { method: 'POST', body });
  $('transfer-status').textContent = `Transferred. New registration: ${payload.newRegId || ''}`;
  ['transfer-first', 'transfer-last', 'transfer-email', 'transfer-phone', 'transfer-church', 'transfer-reason', 'transfer-refund-notes'].forEach((id) => { $(id).value = ''; });
  showToast('Registration transferred.');
  logActivity(`Transferred ${selectedRegistration} → ${payload.newRegId || 'new'}`);
  if (payload.newRegId) await selectRegistration(payload.newRegId);
}

async function transferAttendeeStaff(button) {
  if (!selectedRegistration) return showToast('Select a registration first.');
  const card = button.closest('.attendee-card');
  if (!card) return;
  const get = (field) => {
    const el = card.querySelector(`[data-transfer-field="${field}"]`);
    return el ? el.value.trim() : '';
  };
  const attendeeId = button.dataset.attendeeId || '';
  const newFirstName = get('newFirstName');
  const newLastName = get('newLastName');
  const newEmail = get('newEmail');
  if (!attendeeId) return showToast('Save the registration before transferring this attendee.');
  if (!newFirstName || !newLastName || !newEmail) return showToast('New first name, last name, and email are required.');
  if (!window.confirm(`Transfer this seat to ${newFirstName} ${newLastName}? Unsaved edits on this registration will be lost.`)) return;
  await api('/api/attendee-transfer', {
    method: 'POST',
    body: { registrationId: selectedRegistration, attendeeId, newFirstName, newLastName, newEmail, newPhone: get('newPhone'), newChurch: get('newChurch'), reason: get('reason') },
  });
  showToast(`Attendee transferred to ${newFirstName} ${newLastName}.`);
  logActivity(`Transferred attendee ${attendeeId} → ${newFirstName} ${newLastName} (${selectedRegistration})`);
  await selectRegistration(selectedRegistration);
}

const SEMINAR_SLOT_LABELS = {
  session_1: 'Friday 4:00–5:00 PM',
  session_2: 'Sabbath 2:00–3:15 PM',
  session_3: 'Sabbath 4:15–5:30 PM',
  session_4: 'Sunday 8:15–9:15 AM',
};

async function loadRosters() {
  const payload = await api('/api/church-rosters');
  const rosters = payload.rosters || [];
  if (!rosters.length) { $('rosters-output').innerHTML = '<div class="info-msg">No active registrations.</div>'; return; }
  $('rosters-output').innerHTML = rosters.map((r) => `
    <div class="roster-church">
      <h3>${escapeHtml(r.church)} <span class="roster-sub">— ${escapeHtml(r.registrationCount)} reg / ${escapeHtml(r.attendeeCount)} attendees</span></h3>
      <ul>${r.members.map((m) => `<li>${escapeHtml(m.primaryName)} <span class="roster-sub">${escapeHtml(m.email || '')}${m.phone ? ' • ' + escapeHtml(m.phone) : ''} • ${escapeHtml(m.paymentStatus || '')}</span>${m.attendees && m.attendees.length ? '<ul>' + m.attendees.map((a) => `<li>${escapeHtml(a.name)}${a.mealPreference ? ' <span class="roster-sub">(' + escapeHtml(a.mealPreference) + ')</span>' : ''}</li>`).join('') + '</ul>' : ''}</li>`).join('')}</ul>
    </div>`).join('');
}

function populateSeminarSlots() {
  const select = $('seminar-slot');
  if (!select || select.options.length) return;
  select.innerHTML = Object.entries(SEMINAR_SLOT_LABELS).map(([slot, label]) => `<option value="${slot}">${escapeHtml(label)}</option>`).join('');
}

async function loadSeminars() {
  populateSeminarSlots();
  const payload = await api('/api/seminars');
  const seminars = payload.seminars || [];
  if (!seminars.length) { $('seminars-output').innerHTML = '<div class="info-msg">No breakouts defined yet. Add them below.</div>'; return; }
  const bySlot = {};
  seminars.forEach((s) => { (bySlot[s.slot] = bySlot[s.slot] || []).push(s); });
  $('seminars-output').innerHTML = Object.keys(SEMINAR_SLOT_LABELS).filter((slot) => bySlot[slot]).map((slot) => `
    <div class="roster-church"><h3>${escapeHtml(SEMINAR_SLOT_LABELS[slot])}</h3>
    ${bySlot[slot].map((s) => { const cap = Number(s.capacity || 0); const full = cap > 0 && Number(s.assignedCount || 0) >= cap; return `<div class="seminar-row ${full ? 'full' : ''}"><span>${escapeHtml(s.title)}${s.active ? '' : ' (inactive)'}</span><span class="seminar-fill">${escapeHtml(s.assignedCount || 0)}${cap > 0 ? ' / ' + escapeHtml(cap) : ' / ∞'}</span></div>`; }).join('')}
    </div>`).join('');
}

async function saveSeminar() {
  const slot = $('seminar-slot').value;
  const title = $('seminar-title').value.trim();
  if (!title) return showToast('Enter a breakout title.');
  await api('/api/seminars', { method: 'POST', body: { slot, title, capacity: Number($('seminar-capacity').value || 0) } });
  $('seminar-title').value = '';
  showToast('Breakout saved.');
  await loadSeminars();
}

async function runAssignment(dryRun) {
  const payload = await api('/api/seminars/assign', { method: 'POST', body: { dryRun } });
  const summary = (payload.summary || []).slice().sort((a, b) => (a.slot + a.title).localeCompare(b.slot + b.title));
  $('assign-output').innerHTML = `<div class="info-msg">${dryRun ? 'Preview' : 'Assigned'}: ${escapeHtml(payload.assignmentCount || 0)} attendee-slot placements.</div>` +
    (summary.length ? `<div class="roster-church">${summary.map((s) => { const full = s.capacity > 0 && s.assigned >= s.capacity; return `<div class="seminar-row ${full ? 'full' : ''}"><span>${escapeHtml(SEMINAR_SLOT_LABELS[s.slot] || s.slot)}: ${escapeHtml(s.title)}</span><span class="seminar-fill">${escapeHtml(s.assigned)}${s.capacity > 0 ? ' / ' + escapeHtml(s.capacity) : ''}</span></div>`; }).join('')}</div>` : '');
  if (!dryRun) { showToast('Seminar assignment complete.'); logActivity('Ran seminar assignment'); await loadSeminars(); }
}

async function runReminders(dryRun) {
  const payload = await api('/api/reminders/pending-charges', { method: 'POST', body: { dryRun } });
  if (dryRun) {
    $('reminders-output').innerHTML = `<div class="info-msg">${escapeHtml(payload.owing || 0)} registration(s) still owe a balance${payload.skipped ? `; ${escapeHtml(payload.skipped)} have no valid email` : ''}.</div>`;
  } else {
    $('reminders-output').innerHTML = `<div class="info-msg">Sent ${escapeHtml(payload.sent || 0)} reminder(s). Skipped ${escapeHtml(payload.skipped || 0)}, failed ${escapeHtml(payload.failed || 0)}.</div>`;
    showToast(`Sent ${payload.sent || 0} reminder(s).`);
    logActivity(`Sent ${payload.sent || 0} payment reminder(s)`);
  }
}

async function saveWorker() {
  const first = $('worker-first').value.trim();
  const last = $('worker-last').value.trim();
  const email = $('worker-email').value.trim();
  if (!first || !last || !email) return showToast('Worker first name, last name, and email are required.');
  const body = {
    first_name: first,
    last_name: last,
    email,
    phone: $('worker-phone').value.trim(),
    church: $('worker-church').value.trim(),
    worker_role: $('worker-role').value.trim(),
    meal_preference: $('worker-meal').value.trim(),
    dietary_needs: $('worker-dietary').value.trim(),
  };
  const payload = await api('/api/worker/add', { method: 'POST', body });
  $('worker-status').textContent = `Added worker ${first} ${last} (${payload.registrationId || ''}).`;
  ['worker-first', 'worker-last', 'worker-email', 'worker-phone', 'worker-church', 'worker-role', 'worker-meal', 'worker-dietary'].forEach((id) => { $(id).value = ''; });
  showToast('Worker added.');
  logActivity(`Added worker ${first} ${last}`);
}

let groupParsed = { attendees: [], errors: [] };
// Stable submission id, retained across retries so a lost response / re-click
// de-dupes in GAS instead of importing the group twice. Reset after success.
let groupEntryId = null;
function ensureGroupEntryId() {
  if (!groupEntryId) groupEntryId = `group-${(self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  return groupEntryId;
}

function renderGroupPreview() {
  groupParsed = window.WR26_OPTIONS.parseRoster($('group-roster').value);
  const { attendees, errors } = groupParsed;
  const out = $('group-preview');
  if (!attendees.length && !errors.length) { out.innerHTML = ''; return; }
  const max = window.WR26_OPTIONS.MAX_ATTENDEES;
  const rows = attendees.map((a, i) => `<div class="seminar-row"><span>${i + 1}. <strong>${escapeHtml(`${a.first_name} ${a.last_name}`.trim())}</strong>${a.email ? ` <span class="roster-sub">${escapeHtml(a.email)}</span>` : ' <span class="roster-sub">(no email)</span>'}</span></div>`).join('');
  const errBlock = errors.length ? `<div class="info-msg">⚠️ ${escapeHtml(errors.join('; '))}. Fix these lines before importing.</div>` : '';
  const capBlock = attendees.length > max ? `<div class="info-msg">⚠️ ${attendees.length} exceeds the limit of ${max} per group.</div>` : '';
  out.innerHTML = `<div class="info-msg"><strong>${attendees.length}</strong> attendee(s) ready.</div>${capBlock}${errBlock}${rows}`;
}

function readGroupFile() {
  const file = $('group-file').files && $('group-file').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { $('group-roster').value = String(reader.result || ''); renderGroupPreview(); };
  reader.readAsText(file);
}

async function saveGroup() {
  const first = $('group-first').value.trim();
  const last = $('group-last').value.trim();
  const email = $('group-email').value.trim();
  if (!first || !last || !email) return showToast('Coordinator first name, last name, and email are required.');
  renderGroupPreview();
  if (!groupParsed.attendees.length) return showToast('Paste at least one attendee.');
  if (groupParsed.errors.length) return showToast(`Fix the roster: ${groupParsed.errors.join('; ')}.`);
  if (groupParsed.attendees.length > window.WR26_OPTIONS.MAX_ATTENDEES) return showToast(`At most ${window.WR26_OPTIONS.MAX_ATTENDEES} attendees per group.`);
  const body = {
    first_name: first,
    last_name: last,
    email,
    phone: $('group-phone').value.trim(),
    church: $('group-church').value.trim(),
    payment_method: $('group-payment').value,
    promo_code: $('group-promo').value.trim(),
    entry_id: ensureGroupEntryId(),
    attendees: groupParsed.attendees,
  };
  const payload = await api('/api/group/add', { method: 'POST', body });
  const total = payload.finalAmount != null ? ` Total: $${payload.finalAmount}.` : '';
  $('group-import-status').textContent = `Imported ${payload.attendeeCount || groupParsed.attendees.length} attendee(s) for ${first} ${last} (${payload.registrationId || ''}).${total}`;
  ['group-first', 'group-last', 'group-email', 'group-phone', 'group-church', 'group-promo', 'group-roster'].forEach((id) => { $(id).value = ''; });
  $('group-preview').innerHTML = '';
  groupParsed = { attendees: [], errors: [] };
  groupEntryId = null;
  showToast('Group imported.');
  logActivity(`Imported group for ${first} ${last} (${payload.attendeeCount || ''} attendees)`);
}

async function loadStaff() {
  const payload = await api('/api/staff');
  const users = payload.users || [];
  if (!users.length) { $('staff-output').innerHTML = '<div class="info-msg">No staff users yet.</div>'; return; }
  $('staff-output').innerHTML = users.map((u) => `
    <div class="seminar-row">
      <span><strong>${escapeHtml(u.username)}</strong> <span class="roster-sub">${escapeHtml((u.roles || []).join(', '))}${u.source === 'bootstrap' ? ' • server admin' : ''}${u.email ? ' • ' + escapeHtml(u.email) : ''}</span></span>
      <span class="seminar-fill">${u.editable ? `<button class="btn btn-sm btn-white staff-edit" data-user="${escapeHtml(u.username)}" data-roles="${escapeHtml((u.roles || []).join(','))}" data-email="${escapeHtml(u.email || '')}">Edit</button> <button class="btn btn-sm btn-white staff-deactivate" data-user="${escapeHtml(u.username)}">Disable</button>` : '<span class="roster-sub">read-only</span>'}</span>
    </div>`).join('');
}

function setStaffRoleChecks(roles) {
  const set = new Set((roles || '').split(',').map((r) => r.trim()).filter(Boolean));
  document.querySelectorAll('.staff-roles .role-check input').forEach((cb) => { cb.checked = set.has(cb.value); });
}

async function saveStaff() {
  const username = $('staff-username').value.trim();
  if (!username) return showToast('Enter a username.');
  const roles = [...document.querySelectorAll('.staff-roles .role-check input:checked')].map((cb) => cb.value);
  const password = $('staff-password').value;
  const email = $('staff-email').value.trim();
  const body = { username, roles };
  if (password) body.password = password;
  if (email) body.email = email;
  await api('/api/staff', { method: 'POST', body });
  $('staff-status').textContent = `Saved ${username}.`;
  $('staff-username').value = ''; $('staff-email').value = ''; $('staff-password').value = ''; setStaffRoleChecks('');
  showToast('Staff user saved.');
  logActivity(`Saved staff user ${username}`);
  await loadStaff();
}

async function deactivateStaff(username) {
  if (!confirm(`Disable staff login "${username}"?`)) return;
  await api('/api/staff/deactivate', { method: 'POST', body: { username } });
  showToast(`Disabled ${username}.`);
  logActivity(`Disabled staff user ${username}`);
  await loadStaff();
}

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  $('login-form').addEventListener('submit', handleLogin);
  $('send-login-link').addEventListener('click', () => requestStaffMagicLink().catch((error) => { $('login-error').textContent = error.message; $('login-error').hidden = false; }));
  $('use-password-link').addEventListener('click', (e) => { e.preventDefault(); showPasswordLogin(); });
  $('use-magic-link').addEventListener('click', (e) => { e.preventDefault(); showMagicLogin(); });
  $('logout-btn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); showAuth('Signed out.'); });
  $('refresh-btn').addEventListener('click', async () => { await api('/api/sync/refresh', { method: 'POST' }); await bootstrap(); showToast('Cache refreshed.'); });
  $('sync-btn').addEventListener('click', () => processOfflineQueue().catch((error) => showToast(error.message)));
  $('scan-btn').addEventListener('click', () => toggleScanner().catch((error) => showToast(error.message)));
  document.querySelectorAll('.search-tabs .tab-btn').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('search-btn').addEventListener('click', () => search().catch((error) => showToast(error.message)));
  $('search').addEventListener('keydown', (event) => { if (event.key === 'Enter') search().catch((error) => showToast(error.message)); });
  $('payment-filter').addEventListener('change', () => search().catch((error) => showToast(error.message)));
  $('results').addEventListener('click', (event) => { const card = event.target.closest('.result-card'); if (card) selectRegistration(card.dataset.id).catch((error) => showToast(error.message)); });
  $('detail').addEventListener('click', (event) => {
    if (event.target.id === 'save-detail') saveDetail().catch((error) => showToast(error.message));
    if (event.target.id === 'goto-transfer') switchTab('transfer');
    if (event.target.id === 'goto-refund') switchTab('payments');
    if (event.target.id === 'resend-confirmation') resendConfirmation().catch((error) => showToast(error.message));
    if (event.target.id === 'add-attendee') {
      const count = document.querySelectorAll('#detail .attendee-card').length;
      const maxAttendees = (window.WR26_OPTIONS && window.WR26_OPTIONS.MAX_ATTENDEES) || 50;
      if (count >= maxAttendees) return showToast(`Maximum ${maxAttendees} attendees.`);
      $('attendee-list').insertAdjacentHTML('beforeend', attendeeEditor({}, count));
    }
    const transferToggle = event.target.closest('[data-transfer-toggle]');
    if (transferToggle) {
      const panel = transferToggle.closest('.attendee-card').querySelector('[data-transfer-card]');
      if (panel) panel.hidden = !panel.hidden;
    }
    const confirmTransfer = event.target.closest('[data-confirm-transfer]');
    if (confirmTransfer) transferAttendeeStaff(confirmTransfer).catch((error) => showToast(error.message));
  });
  // Show the children-needing-care count only while childcare is requested, and clear it
  // when childcare is turned off so a stale number isn't saved.
  $('detail').addEventListener('change', (event) => {
    const select = event.target.closest('[data-a="childcare_needed"]');
    if (!select) return;
    const card = select.closest('.attendee-card');
    const countLabel = card && card.querySelector('[data-childcare-count]');
    if (!countLabel) return;
    const show = String(select.value).toLowerCase() === 'yes';
    countLabel.style.display = show ? '' : 'none';
    if (!show) { const input = countLabel.querySelector('input'); if (input) input.value = ''; }
  });
  $('save-payment').addEventListener('click', () => savePayment().catch((error) => showToast(error.message)));
  $('save-refund').addEventListener('click', () => saveRefund().catch((error) => showToast(error.message)));
  $('save-transfer').addEventListener('click', () => saveTransfer().catch((error) => showToast(error.message)));
  $('checkin-btn').addEventListener('click', () => checkInSelected().catch((error) => showToast(error.message)));
  $('send-magic').addEventListener('click', () => sendMagicLink().catch((error) => { $('magic-status').textContent = error.message; }));
  $('load-rosters').addEventListener('click', () => loadRosters().catch((error) => showToast(error.message)));
  $('print-rosters').addEventListener('click', () => window.print());
  $('load-seminars').addEventListener('click', () => loadSeminars().catch((error) => showToast(error.message)));
  $('save-seminar').addEventListener('click', () => saveSeminar().catch((error) => showToast(error.message)));
  $('preview-assign').addEventListener('click', () => runAssignment(true).catch((error) => showToast(error.message)));
  $('run-assign').addEventListener('click', () => runAssignment(false).catch((error) => showToast(error.message)));
  $('preview-reminders').addEventListener('click', () => runReminders(true).catch((error) => showToast(error.message)));
  $('send-reminders').addEventListener('click', () => runReminders(false).catch((error) => showToast(error.message)));
  const workerLink = $('worker-link');
  if (workerLink) workerLink.value = `${window.location.origin}/worker/`;
  $('copy-worker-link').addEventListener('click', async () => {
    const link = $('worker-link').value;
    try { await navigator.clipboard.writeText(link); showToast('Worker link copied.'); }
    catch (_e) { $('worker-link').select(); document.execCommand('copy'); showToast('Worker link copied.'); }
  });
  $('save-worker').addEventListener('click', () => saveWorker().catch((error) => showToast(error.message)));
  const groupLink = $('group-link');
  if (groupLink) groupLink.value = `${window.location.origin}/group/`;
  const copyGroupLink = $('copy-group-link');
  if (copyGroupLink) copyGroupLink.addEventListener('click', async () => {
    const link = $('group-link').value;
    try { await navigator.clipboard.writeText(link); showToast('Group link copied.'); }
    catch (_e) { $('group-link').select(); document.execCommand('copy'); showToast('Group link copied.'); }
  });
  if ($('group-preview-btn')) $('group-preview-btn').addEventListener('click', renderGroupPreview);
  if ($('group-roster')) $('group-roster').addEventListener('blur', renderGroupPreview);
  if ($('group-file')) $('group-file').addEventListener('change', readGroupFile);
  if ($('save-group')) $('save-group').addEventListener('click', () => saveGroup().catch((error) => showToast(error.message)));
  $('load-staff').addEventListener('click', () => loadStaff().catch((error) => showToast(error.message)));
  $('save-staff').addEventListener('click', () => saveStaff().catch((error) => showToast(error.message)));
  $('staff-output').addEventListener('click', (event) => {
    const editBtn = event.target.closest('.staff-edit');
    if (editBtn) { $('staff-username').value = editBtn.dataset.user; $('staff-email').value = editBtn.dataset.email || ''; setStaffRoleChecks(editBtn.dataset.roles); $('staff-password').value = ''; $('staff-status').textContent = `Editing ${editBtn.dataset.user} — leave password blank to keep it.`; }
    const offBtn = event.target.closest('.staff-deactivate');
    if (offBtn) deactivateStaff(offBtn.dataset.user).catch((error) => showToast(error.message));
  });
  populateSeminarSlots();
  restoreSession();
});
