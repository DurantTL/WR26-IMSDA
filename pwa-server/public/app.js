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

function showAuth(message = '') {
  currentUser = null;
  $('auth').classList.add('visible');
  $('user-display').textContent = 'Staff sign-in required';
  if (message) {
    $('login-error').textContent = message;
    $('login-error').hidden = false;
  }
}

function hideAuth() {
  $('auth').classList.remove('visible');
  $('login-error').hidden = true;
}

async function restoreSession() {
  updateQueueUI();
  updateOnlineStatus();
  try {
    const payload = await api('/api/auth/me');
    currentUser = payload.user;
    $('user-display').textContent = `Signed in as ${currentUser.username}`;
    hideAuth();
    await bootstrap();
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
    await bootstrap();
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

function attendeeEditor(attendee = {}, index = 0) {
  return `<div class="attendee-card" data-attendee-index="${index}">
    <h3>Attendee ${index + 1}</h3>
    <div class="form-grid">
      <label>First Name<input data-a="first_name" value="${escapeHtml(attendee.first_name)}"></label>
      <label>Last Name<input data-a="last_name" value="${escapeHtml(attendee.last_name)}"></label>
      <label>Phone<input data-a="phone" value="${escapeHtml(attendee.phone)}"></label>
      <label>Email<input data-a="email" value="${escapeHtml(attendee.email)}"></label>
      <label>Church<input data-a="church" value="${escapeHtml(attendee.church)}"></label>
      <label>Adult/Child<input data-a="attendee_type" value="${escapeHtml(attendee.attendee_type)}"></label>
      <label>Meal Preference<input data-a="meal_preference" value="${escapeHtml(attendee.meal_preference)}"></label>
      <label>Childcare Needed<input data-a="childcare_needed" value="${escapeHtml(attendee.childcare_needed)}"></label>
      <label>Dietary Needs<textarea data-a="dietary_needs" rows="2">${escapeHtml(attendee.dietary_needs)}</textarea></label>
      <label>Notes<textarea data-a="notes" rows="2">${escapeHtml(attendee.notes)}</textarea></label>
    </div>
    <h4>Seminar Preferences</h4>
    <div class="form-grid">
      <label>Friday 4 PM Pref 1<input data-pref="session_1.pref_1" value="${escapeHtml(prefValue(attendee, 'session_1', 'pref_1'))}"></label>
      <label>Friday 4 PM Pref 2<input data-pref="session_1.pref_2" value="${escapeHtml(prefValue(attendee, 'session_1', 'pref_2'))}"></label>
      <label>Saturday 2 PM Pref 1<input data-pref="session_2.pref_1" value="${escapeHtml(prefValue(attendee, 'session_2', 'pref_1'))}"></label>
      <label>Saturday 2 PM Pref 2<input data-pref="session_2.pref_2" value="${escapeHtml(prefValue(attendee, 'session_2', 'pref_2'))}"></label>
      <label>Saturday 3:30 Pref 1<input data-pref="session_3.pref_1" value="${escapeHtml(prefValue(attendee, 'session_3', 'pref_1'))}"></label>
      <label>Saturday 3:30 Pref 2<input data-pref="session_3.pref_2" value="${escapeHtml(prefValue(attendee, 'session_3', 'pref_2'))}"></label>
      <label>Sunday 8:15<input data-pref="session_4.pref_1" value="${escapeHtml(prefValue(attendee, 'session_4', 'pref_1'))}"></label>
    </div>
    <input type="hidden" data-a="attendee_id" value="${escapeHtml(attendee.attendee_id)}">
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
      <div class="btn-row"><button id="goto-transfer" class="btn btn-white">Transfer / Swap</button><button id="goto-refund" class="btn btn-white">Refund</button></div></div>`;
}

function collectDetail() {
  const fields = {};
  document.querySelectorAll('#detail [data-field]').forEach((el) => { fields[el.dataset.field] = el.value; });
  const attendees = [];
  document.querySelectorAll('#detail .attendee-card').forEach((card) => {
    const attendee = { seminar_preferences: {} };
    card.querySelectorAll('[data-a]').forEach((el) => { attendee[el.dataset.a] = el.value; });
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
  const portalUrl = $('magic-url').value.trim();
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

const SEMINAR_SLOT_LABELS = {
  session_1: 'Friday 4:00–5:00 PM',
  session_2: 'Saturday 2:00–3:15 PM',
  session_3: 'Saturday 3:30–4:45 PM',
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

async function loadStaff() {
  const payload = await api('/api/staff');
  const users = payload.users || [];
  if (!users.length) { $('staff-output').innerHTML = '<div class="info-msg">No staff users yet.</div>'; return; }
  $('staff-output').innerHTML = users.map((u) => `
    <div class="seminar-row">
      <span><strong>${escapeHtml(u.username)}</strong> <span class="roster-sub">${escapeHtml((u.roles || []).join(', '))}${u.source === 'bootstrap' ? ' • server admin' : ''}</span></span>
      <span class="seminar-fill">${u.editable ? `<button class="btn btn-sm btn-white staff-edit" data-user="${escapeHtml(u.username)}" data-roles="${escapeHtml((u.roles || []).join(','))}">Edit</button> <button class="btn btn-sm btn-white staff-deactivate" data-user="${escapeHtml(u.username)}">Disable</button>` : '<span class="roster-sub">read-only</span>'}</span>
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
  const body = { username, roles };
  if (password) body.password = password;
  await api('/api/staff', { method: 'POST', body });
  $('staff-status').textContent = `Saved ${username}.`;
  $('staff-username').value = ''; $('staff-password').value = ''; setStaffRoleChecks('');
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
    if (event.target.id === 'add-attendee') {
      const count = document.querySelectorAll('#detail .attendee-card').length;
      if (count >= 5) return showToast('Maximum 5 attendees.');
      $('attendee-list').insertAdjacentHTML('beforeend', attendeeEditor({}, count));
    }
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
  $('save-worker').addEventListener('click', () => saveWorker().catch((error) => showToast(error.message)));
  $('load-staff').addEventListener('click', () => loadStaff().catch((error) => showToast(error.message)));
  $('save-staff').addEventListener('click', () => saveStaff().catch((error) => showToast(error.message)));
  $('staff-output').addEventListener('click', (event) => {
    const editBtn = event.target.closest('.staff-edit');
    if (editBtn) { $('staff-username').value = editBtn.dataset.user; setStaffRoleChecks(editBtn.dataset.roles); $('staff-password').value = ''; $('staff-status').textContent = `Editing ${editBtn.dataset.user} — leave password blank to keep it.`; }
    const offBtn = event.target.closest('.staff-deactivate');
    if (offBtn) deactivateStaff(offBtn.dataset.user).catch((error) => showToast(error.message));
  });
  populateSeminarSlots();
  restoreSession();
});
