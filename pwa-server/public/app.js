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
  $('sync-status').textContent = `Cached ${label} • ${sync.registrationsCached || 0} regs • ${sync.attendeesCached || 0} attendees`;
}

function showAuth(message = '') {
  currentUser = null;
  $('auth').classList.add('visible');
  $('user-display').textContent = 'Not signed in';
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

function renderStats(statsPayload, paymentStats) {
  const stats = statsPayload && statsPayload.stats ? statsPayload.stats : {};
  const cards = [
    ['Registered', stats.total ?? 0],
    ['Checked In', stats.checkedIn ?? 0],
    ['Not Yet', stats.notCheckedIn ?? 0],
    ['Payments Pending', stats.paymentsPending ?? 0],
  ];
  $('stats-grid').innerHTML = cards.map(([label, value]) => `<div class="stat"><b>${escapeHtml(value)}</b><br>${escapeHtml(label)}</div>`).join('');
}

function switchTab(tab) {
  document.querySelectorAll('.tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((panel) => panel.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
}

function paymentClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'paid' || s === 'paid_onsite') return 'good';
  if (s.includes('pending')) return 'warn';
  return '';
}

async function search() {
  const params = new URLSearchParams();
  if ($('search').value.trim()) params.set('q', $('search').value.trim());
  if ($('payment-filter').value) params.set('paymentStatus', $('payment-filter').value);
  const payload = await api(`/api/registrations?${params.toString()}`);
  renderResults(payload.registrations || []);
}

function renderResults(rows) {
  if (!rows.length) {
    $('results').innerHTML = '<div class="empty-state">No registrations found.</div>';
    return;
  }
  $('results').innerHTML = rows.map((r) => `
    <article class="result-card ${selectedRegistration === r.registrationId ? 'selected' : ''}" data-id="${escapeHtml(r.registrationId)}">
      <div><strong>${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</strong> <span class="pill">${escapeHtml(r.registrationId)}</span></div>
      <div class="meta">${escapeHtml(r.email)} • ${escapeHtml(r.phone || '')}</div>
      <div class="meta">${escapeHtml(r.church || 'No church listed')}</div>
      <div><span class="pill ${paymentClass(r.paymentStatus)}">${escapeHtml(r.paymentStatus || 'payment unknown')}</span><span class="pill">$${escapeHtml(r.finalAmount ?? '')}</span><span class="pill">Attendees: ${escapeHtml(r.attendeeCount ?? 0)}</span>${String(r.checkedIn).toLowerCase() === 'true' ? '<span class="pill good">Checked In</span>' : ''}</div>
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
  $('detail-empty').hidden = true;
  $('detail').hidden = false;
  $('detail').innerHTML = `<div class="card">
    <div class="detail-head"><div><h2>${escapeHtml(reg.firstName)} ${escapeHtml(reg.lastName)}</h2><p class="meta">${escapeHtml(reg.registrationId)} • ${escapeHtml(reg.email)}</p></div><div><span class="pill ${paymentClass(reg.paymentStatus)}">${escapeHtml(reg.paymentStatus)}</span><span class="pill">$${escapeHtml(reg.finalAmount)}</span></div></div>
    <div class="form-grid">
      ${field('firstName', 'First Name', reg.firstName)}${field('lastName', 'Last Name', reg.lastName)}${field('phone', 'Phone', reg.phone)}${field('church', 'Church', reg.church)}${field('arrivalDate', 'Arrival Date', reg.arrivalDate)}${field('departureDate', 'Departure Date', reg.departureDate)}${field('emergencyContactName', 'Emergency Contact Name', reg.emergencyContactName)}${field('emergencyContactPhone', 'Emergency Contact Phone', reg.emergencyContactPhone)}${field('dietaryNeeds', 'Dietary Needs', reg.dietaryNeeds, 'textarea')}${field('specialNeeds', 'Special Needs', reg.specialNeeds, 'textarea')}
    </div>
  </div>
  <div class="card"><h2>Attendees</h2><div id="attendee-list">${(reg.attendees || []).map(attendeeEditor).join('')}</div><button id="add-attendee" class="btn secondary">Add Attendee</button></div>
  <button id="save-detail" class="btn primary">Save Registration</button>`;
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
  document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('search-btn').addEventListener('click', search);
  $('search').addEventListener('keydown', (event) => { if (event.key === 'Enter') search(); });
  $('payment-filter').addEventListener('change', search);
  $('results').addEventListener('click', (event) => { const card = event.target.closest('.result-card'); if (card) selectRegistration(card.dataset.id); });
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
