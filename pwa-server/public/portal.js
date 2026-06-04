(() => {
  const MAX_ATTENDEES = 5;
  const SAFE_MAGIC_LINK_MESSAGE = 'If a registration exists for that email, a link has been sent.';
  const EDITABLE_FIELDS = [
    ['firstName', 'First Name', 'text'],
    ['lastName', 'Last Name', 'text'],
    ['phone', 'Phone', 'tel'],
    ['church', 'Church', 'text'],
    ['dietaryNeeds', 'Dietary Needs', 'textarea'],
    ['emergencyContactName', 'Emergency Contact Name', 'text'],
    ['emergencyContactPhone', 'Emergency Contact Phone', 'tel'],
    ['specialNeeds', 'Special Needs', 'textarea'],
  ];
  // 'select' fields pull their options from the shared WR26_OPTIONS module so the
  // portal matches the Fluent Form dropdowns.
  const ATTENDEE_FIELDS = [
    ['first_name', 'First Name', 'text'],
    ['last_name', 'Last Name', 'text'],
    ['phone', 'Phone', 'tel'],
    ['attendee_type', 'Attendee Type', 'select', 'ATTENDEE_TYPE_OPTIONS'],
    ['meal_preference', 'Meal Preference', 'select', 'MEAL_OPTIONS'],
    ['dietary_needs', 'Dietary Needs', 'textarea'],
    ['childcare_needed', 'Childcare Needed?', 'select', 'CHILDCARE_OPTIONS'],
    // Number-of-children is shown only when childcare is requested (see attendeeCardHtml).
    ['childcare_children', 'How Many Children Need Care?', 'number'],
    ['volunteer', 'Willing to Volunteer to Help?', 'select', 'VOLUNTEER_OPTIONS'],
  ];

  const state = {
    token: '',
    bundle: null,
    attendees: [],
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\'': '&#39;', '"': '&quot;' }[char]));
  }

  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || params.get('magicToken') || params.get('t') || '';
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    if (label) {
      button.innerHTML = busy
        ? '<span class="btn-spinner" aria-hidden="true"></span>Please wait…'
        : escapeHtml(label);
    }
  }

  function showOnly(panelId) {
    ['request-panel', 'loading-panel', 'edit-panel', 'saved-panel'].forEach((id) => { $(id).hidden = id !== panelId; });
  }

  function showStatus(message, type = 'info') {
    const status = $('portal-status');
    status.textContent = message || '';
    status.className = `portal-alert ${type}`;
    status.hidden = !message;
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || 'Request failed. Please try again.');
    }
    return payload;
  }

  function fieldHtml(name, label, type, value) {
    if (type === 'textarea') {
      return `<label>${escapeHtml(label)}<textarea data-field="${escapeHtml(name)}" rows="3">${escapeHtml(value)}</textarea></label>`;
    }
    return `<label>${escapeHtml(label)}<input data-field="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"></label>`;
  }

  function renderRegistrationFields(registration = {}) {
    $('registration-fields').innerHTML = EDITABLE_FIELDS.map(([name, label, type]) => fieldHtml(name, label, type, registration[name] || '')).join('');
  }

  function attendeeCardHtml(attendee = {}, index = 0) {
    const removeButton = state.attendees.length > 1
      ? `<button class="btn btn-sm btn-white portal-remove-attendee" type="button" data-remove-attendee="${index}">Remove</button>`
      : '';
    const O = window.WR26_OPTIONS;
    const childcareYes = String(attendee.childcare_needed || '').toLowerCase() === 'yes';
    const fields = ATTENDEE_FIELDS.map(([name, label, type, optionKey]) => {
      const value = attendee[name] || '';
      if (type === 'textarea') return `<label>${escapeHtml(label)}<textarea data-attendee-field="${escapeHtml(name)}" rows="2">${escapeHtml(value)}</textarea></label>`;
      if (type === 'number') {
        // Children-needing-care count: only relevant (and shown) when childcare is requested.
        // Inline display:none (not the hidden attribute) so it beats `.form-grid label{display:block}`.
        return `<label class="portal-childcare-count" data-childcare-count${childcareYes ? '' : ' style="display:none"'}>${escapeHtml(label)}<input data-attendee-field="${escapeHtml(name)}" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(value)}"></label>`;
      }
      if (type === 'select') return `<label>${escapeHtml(label)}${O.selectHtml(`data-attendee-field="${escapeHtml(name)}"`, value, O[optionKey])}</label>`;
      return `<label>${escapeHtml(label)}<input data-attendee-field="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}"></label>`;
    }).join('');
    const prefs = attendee.seminar_preferences || attendee.seminarPreferences || {};
    const seminarFields = O.SEMINAR_SLOTS.map((slotDef) => {
      const out = [];
      for (let r = 1; r <= slotDef.ranks; r += 1) {
        const label = slotDef.ranks > 1 ? `${slotDef.label} — Pref ${r}` : slotDef.label;
        const current = (prefs[slotDef.slot] && prefs[slotDef.slot][`pref_${r}`]) || '';
        const descId = `sdesc-${index}-${slotDef.slot}-${r}`;
        const desc = current && O.SEMINAR_DESCRIPTIONS && O.SEMINAR_DESCRIPTIONS[current];
        const descHtml = desc
          ? `<div id="${escapeHtml(descId)}" class="seminar-desc-box"><span class="seminar-desc-presenter">${escapeHtml(desc.presenter || '')}</span>${desc.full}</div>`
          : `<div id="${escapeHtml(descId)}" class="seminar-desc-box" hidden></div>`;
        out.push(`<label>${escapeHtml(label)}${O.selectHtml(`data-attendee-pref="${slotDef.slot}.pref_${r}" data-desc-target="${escapeHtml(descId)}"`, current, O.seminarOptions(slotDef.slot), '- None -')}</label>${descHtml}`);
      }
      return out.join('');
    }).join('');
    return `<div class="attendee-card portal-attendee-card" data-attendee-index="${index}">
      <div class="portal-attendee-heading">
        <h3>Attendee ${index + 1}</h3>
        ${removeButton}
      </div>
      <input type="hidden" data-attendee-field="attendee_id" value="${escapeHtml(attendee.attendee_id || attendee.attendeeId || '')}">
      <div class="form-grid compact-form">${fields}</div>
      <h4>Seminar Preferences</h4>
      <div class="form-grid compact-form">${seminarFields}</div>
    </div>`;
  }

  function updateSeminarDesc(select) {
    const targetId = select.dataset.descTarget;
    if (!targetId) return;
    const box = document.getElementById(targetId);
    if (!box) return;
    const O = window.WR26_OPTIONS;
    const desc = select.value && O.SEMINAR_DESCRIPTIONS && O.SEMINAR_DESCRIPTIONS[select.value];
    if (desc) {
      box.innerHTML = `<span class="seminar-desc-presenter">${escapeHtml(desc.presenter || '')}</span>${desc.full}`;
      box.hidden = false;
    } else {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  function renderAttendees() {
    $('portal-attendee-list').innerHTML = state.attendees.map(attendeeCardHtml).join('');
    $('add-portal-attendee').disabled = state.attendees.length >= MAX_ATTENDEES;
    document.querySelectorAll('[data-remove-attendee]').forEach((button) => {
      button.addEventListener('click', () => {
        syncAttendeeStateFromDom();
        const index = Number(button.dataset.removeAttendee);
        state.attendees.splice(index, 1);
        if (!state.attendees.length) state.attendees.push({});
        renderAttendees();
      });
    });
    document.querySelectorAll('[data-attendee-pref][data-desc-target]').forEach((select) => {
      select.addEventListener('change', () => updateSeminarDesc(select));
    });
    // Show the "how many children" count only while childcare is requested, and clear
    // it when childcare is turned off so a stale number isn't saved.
    document.querySelectorAll('[data-attendee-field="childcare_needed"]').forEach((select) => {
      select.addEventListener('change', () => {
        const card = select.closest('.portal-attendee-card');
        const countLabel = card && card.querySelector('[data-childcare-count]');
        if (!countLabel) return;
        const show = String(select.value).toLowerCase() === 'yes';
        countLabel.style.display = show ? '' : 'none';
        if (!show) {
          const input = countLabel.querySelector('input');
          if (input) input.value = '';
        }
      });
    });
  }

  function formatSeminarPreference(pref = {}) {
    const bits = [pref.attendeeName, pref.sessionSlot, pref.preferenceRank ? `Rank ${pref.preferenceRank}` : '', pref.seminarTitle || pref.assignedSeminar].filter(Boolean);
    return bits.length ? bits.join(' • ') : JSON.stringify(pref);
  }

  function renderSeminarSummary(bundle = {}) {
    const prefs = Array.isArray(bundle.seminarPreferences) ? bundle.seminarPreferences : [];
    const summary = $('seminar-summary');
    const list = $('seminar-summary-list');
    if (!prefs.length) {
      summary.hidden = true;
      list.innerHTML = '';
      return;
    }
    summary.hidden = false;
    list.innerHTML = `<ul class="portal-seminar-list">${prefs.map((pref) => `<li>${escapeHtml(formatSeminarPreference(pref))}</li>`).join('')}</ul>`;
  }

  function renderPaymentNotice(registration = {}, bundle = {}) {
    const box = $('portal-balance');
    if (!box) return;
    const status = String(registration.paymentStatus || '').toLowerCase();
    const billed = Number(registration.finalAmount || 0);
    const collected = Number(registration.amountPaid != null && registration.amountPaid !== '' ? registration.amountPaid : 0);
    const balance = Math.round((billed - collected) * 100) / 100;
    if (status === 'paid' || status === 'paid_onsite' || (billed > 0 && balance <= 0)) {
      box.className = 'balance-box paid';
      box.innerHTML = '<span class="balance-amount">Paid in full</span><span class="balance-sub">Thank you! No balance is due.</span>';
      box.hidden = false;
      return;
    }
    if (balance > 0) {
      box.className = 'balance-box';
      // When GAS supplies a Square hosted-checkout link, show a real "Pay by Card"
      // button right here so registrants can pay from the portal (not just the email).
      const pay = bundle.payLink || null;
      if (pay && pay.url) {
        const amount = Number(pay.total != null ? pay.total : balance);
        const feeNote = Number(pay.fee) > 0 ? ` (includes a $${Number(pay.fee).toFixed(2)} card processing fee)` : '';
        box.innerHTML = `<span class="balance-amount">Balance due: $${escapeHtml(balance.toFixed(2))}</span>`
          + `<a class="balance-pay-button" href="${escapeHtml(pay.url)}" target="_blank" rel="noopener">Pay $${escapeHtml(amount.toFixed(2))} by Card</a>`
          + `<span class="balance-sub">Secure checkout hosted by Square${escapeHtml(feeNote)}. Or mail a check payable to IMSDA.</span>`;
      } else {
        box.innerHTML = `<span class="balance-amount">Balance due: $${escapeHtml(balance.toFixed(2))}</span><span class="balance-sub">To pay by card, use the payment link in your confirmation email, or mail a check payable to IMSDA.</span>`;
      }
      box.hidden = false;
      return;
    }
    box.hidden = true;
  }

  function renderBundle(bundle) {
    const registration = bundle.registration || {};
    const attendees = Array.isArray(bundle.attendees) ? bundle.attendees : [];
    state.bundle = bundle;
    state.attendees = attendees.length ? attendees.map((attendee) => ({ ...attendee })) : [{}];
    $('registration-heading').textContent = `${registration.firstName || ''} ${registration.lastName || ''}`.trim() || 'Manage Registration';
    $('registration-meta').textContent = [registration.registrationId, registration.email].filter(Boolean).join(' • ');
    $('registration-status').textContent = registration.paymentStatus || registration.status || 'Open';
    renderPaymentNotice(registration, bundle);
    renderRegistrationFields(registration);
    renderAttendees();
    // Seminar prefs are now editable inline per attendee; hide the old read-only summary.
    const summary = $('seminar-summary');
    if (summary) summary.hidden = true;
    showStatus('', 'info');
    showOnly('edit-panel');
  }

  function syncAttendeeStateFromDom() {
    const next = [];
    document.querySelectorAll('.portal-attendee-card').forEach((card) => {
      const index = Number(card.dataset.attendeeIndex);
      const previous = state.attendees[index] || {};
      const attendee = {
        attendee_id: previous.attendee_id || previous.attendeeId || '',
        seminar_preferences: {},
      };
      card.querySelectorAll('[data-attendee-field]').forEach((field) => {
        attendee[field.dataset.attendeeField] = field.value;
      });
      // Capture seminar preference dropdowns into the nested structure GAS expects.
      card.querySelectorAll('[data-attendee-pref]').forEach((field) => {
        const [slot, key] = field.dataset.attendeePref.split('.');
        if (!field.value) return;
        attendee.seminar_preferences[slot] = attendee.seminar_preferences[slot] || {};
        attendee.seminar_preferences[slot][key] = field.value;
      });
      next.push(attendee);
    });
    state.attendees = next;
  }

  function collectPayload() {
    syncAttendeeStateFromDom();
    const fields = {};
    document.querySelectorAll('#registration-fields [data-field]').forEach((field) => {
      fields[field.dataset.field] = field.value;
    });
    return {
      token: state.token,
      fields,
      attendees: state.attendees.slice(0, MAX_ATTENDEES).map((attendee) => ({
        attendee_id: attendee.attendee_id || attendee.attendeeId || '',
        first_name: attendee.first_name || '',
        last_name: attendee.last_name || '',
        phone: attendee.phone || '',
        attendee_type: attendee.attendee_type || '',
        meal_preference: attendee.meal_preference || '',
        dietary_needs: attendee.dietary_needs || '',
        childcare_needed: attendee.childcare_needed || '',
        // Only send a children count when childcare is actually requested.
        childcare_children: String(attendee.childcare_needed || '').toLowerCase() === 'yes' ? (attendee.childcare_children || '') : '',
        volunteer: attendee.volunteer || '',
        seminar_preferences: attendee.seminar_preferences || attendee.seminarPreferences || {},
      })),
    };
  }

  async function requestMagicLink(event) {
    event.preventDefault();
    const button = $('request-submit');
    setBusy(button, true, 'Send My Management Link');
    showStatus('', 'info');
    try {
      const email = $('request-email').value.trim();
      await api('/api/magic-link/request', { email, portalUrl: `${window.location.origin}/portal/` });
      showStatus(SAFE_MAGIC_LINK_MESSAGE, 'success');
      $('magic-request-form').reset();
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      setBusy(button, false, 'Send My Management Link');
    }
  }

  async function loadRegistration() {
    showOnly('loading-panel');
    showStatus('', 'info');
    try {
      // Load live seminar titles so dropdowns match what's assignable (non-fatal).
      await window.WR26_OPTIONS.loadSeminars('/api/seminars/public').catch(() => {});
      const bundle = await api('/api/magic-link/registration', { token: state.token });
      // Remove the token from the URL so it isn't cached in browser history or exposed to referrers.
      if (window.history && window.history.replaceState) {
        const clean = window.location.pathname;
        window.history.replaceState(null, '', clean);
      }
      renderBundle(bundle);
    } catch (error) {
      showOnly('request-panel');
      showStatus(error.message, 'error');
    }
  }

  async function saveRegistration(event) {
    event.preventDefault();
    const button = $('save-registration');
    setBusy(button, true, 'Save Changes');
    showStatus('Saving your changes… Please keep this page open and wait for the confirmation below. Do not refresh or close the tab.', 'saving');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const saved = await api('/api/magic-link/save', collectPayload());
      const reg = (saved && saved.registration) || {};
      $('saved-bundle').textContent = [
        reg.firstName && reg.lastName ? `Name: ${reg.firstName} ${reg.lastName}` : '',
        reg.email ? `Email: ${reg.email}` : '',
        reg.registrationId ? `Registration ID: ${reg.registrationId}` : '',
        reg.paymentStatus ? `Payment: ${reg.paymentStatus}` : '',
      ].filter(Boolean).join('\n') || 'Your registration was updated.';
      // renderBundle clears the status, so set the final message after it.
      renderBundle(saved);
      const warnings = Array.isArray(saved.warnings) ? saved.warnings.filter(Boolean) : [];
      if (warnings.length) {
        showStatus(`Saved — but some items may not have been written: ${warnings.join(' ')} Please contact us if your seminar choices are missing.`, 'warning');
      } else {
        showStatus('✓ Registration saved successfully. Your changes are confirmed.', 'success');
      }
      $('saved-panel').hidden = false;
      $('saved-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      setBusy(button, false, 'Save Changes');
    }
  }

  function addAttendee() {
    syncAttendeeStateFromDom();
    if (state.attendees.length >= MAX_ATTENDEES) return;
    state.attendees.push({});
    renderAttendees();
  }

  function init() {
    state.token = getTokenFromUrl();
    $('magic-request-form').addEventListener('submit', requestMagicLink);
    $('registration-form').addEventListener('submit', saveRegistration);
    $('add-portal-attendee').addEventListener('click', addAttendee);
    if (!state.token) {
      showOnly('request-panel');
      return;
    }
    loadRegistration();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
