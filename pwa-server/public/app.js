let currentUser = null;
let selectedRegistration = null;
let selectedBundle = null;

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

async function bootstrap() {
  const payload = await api('/api/bootstrap');
  renderStats(payload.stats, payload.paymentStats);
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

function switchTab(tab) {
  document.querySelectorAll('.search-tabs .tab-btn').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.search-section .tab').forEach((panel) => panel.classList.remove('active'));
  const panel = $(`tab-${tab}`);
  if (panel) panel.classList.add('active');

  setVisible('results', tab !== 'detail' && tab !== 'payments' && tab !== 'checkin' && tab !== 'magic');
  setVisible('detail-wrap', tab === 'detail' && !!selectedRegistration);
  setVisible('payment-panel', tab === 'payments');
  setVisible('checkin-panel', tab === 'checkin');
  setVisible('magic-panel', tab === 'magic');

  if (tab === 'detail' && !selectedRegistration) showToast('Select a registration first.');
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
  $('payment-target').textContent = `${selectedBundle.firstName} ${selectedBundle.lastName} • ${selectedBundle.registrationId}`;
  $('pay-amount').value = selectedBundle.finalAmount || '';
  $('checkin-target').textContent = `${selectedBundle.firstName} ${selectedBundle.lastName} • ${selectedBundle.registrationId}`;
  $('magic-email').value = selectedBundle.email || '';
  switchTab('detail');
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
    <div class="detail-actions"><button id="save-detail" class="btn btn-primary full-width">Save Registration</button></div>`;
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
  await selectRegistration(selectedRegistration);
}

async function savePayment() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  await api('/api/payment', {
    method: 'POST',
    body: { registrationId: selectedRegistration, paymentMethod: $('pay-method').value, amountPaid: $('pay-amount').value, checkNumber: $('pay-check').value, paymentNotes: $('pay-notes').value },
  });
  showToast('Payment saved.');
  await selectRegistration(selectedRegistration);
}

async function checkInSelected() {
  if (!selectedRegistration) return showToast('Select a registration first.');
  await api('/api/check-in', { method: 'POST', body: { registrationId: selectedRegistration } });
  showToast('Checked in.');
  await selectRegistration(selectedRegistration);
}

async function sendMagicLink() {
  const email = $('magic-email').value.trim();
  const portalUrl = $('magic-url').value.trim();
  const payload = await api('/api/magic-link/request', { method: 'POST', body: { email, portalUrl } });
  $('magic-status').textContent = payload.message || 'Link request processed.';
}

document.addEventListener('DOMContentLoaded', () => {
  $('login-form').addEventListener('submit', handleLogin);
  $('logout-btn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); showAuth('Signed out.'); });
  $('refresh-btn').addEventListener('click', async () => { await api('/api/sync/refresh', { method: 'POST' }); await bootstrap(); showToast('Cache refreshed.'); });
  document.querySelectorAll('.search-tabs .tab-btn').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('search-btn').addEventListener('click', () => search().catch((error) => showToast(error.message)));
  $('search').addEventListener('keydown', (event) => { if (event.key === 'Enter') search().catch((error) => showToast(error.message)); });
  $('payment-filter').addEventListener('change', () => search().catch((error) => showToast(error.message)));
  $('results').addEventListener('click', (event) => { const card = event.target.closest('.result-card'); if (card) selectRegistration(card.dataset.id).catch((error) => showToast(error.message)); });
  $('detail').addEventListener('click', (event) => {
    if (event.target.id === 'save-detail') saveDetail().catch((error) => showToast(error.message));
    if (event.target.id === 'add-attendee') {
      const count = document.querySelectorAll('#detail .attendee-card').length;
      if (count >= 5) return showToast('Maximum 5 attendees.');
      $('attendee-list').insertAdjacentHTML('beforeend', attendeeEditor({}, count));
    }
  });
  $('save-payment').addEventListener('click', () => savePayment().catch((error) => showToast(error.message)));
  $('checkin-btn').addEventListener('click', () => checkInSelected().catch((error) => showToast(error.message)));
  $('send-magic').addEventListener('click', () => sendMagicLink().catch((error) => { $('magic-status').textContent = error.message; }));
  restoreSession();
});
