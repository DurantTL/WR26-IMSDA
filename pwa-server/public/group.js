(() => {
  const $ = (id) => document.getElementById(id);
  let parsed = { attendees: [], errors: [] };

  function showStatus(message, type = 'info') {
    const status = $('group-status');
    status.textContent = message || '';
    status.className = `portal-alert ${type}`;
    status.hidden = !message;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Please wait…' : label;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload.error || payload.message || 'Request failed. Please try again.');
    }
    return payload;
  }

  function renderPreview() {
    parsed = window.WR26_OPTIONS.parseRoster($('g-roster').value);
    const { attendees, errors } = parsed;
    const out = $('g-preview');
    if (!attendees.length && !errors.length) { out.innerHTML = ''; return; }
    const rows = attendees.map((a, i) => `<div class="seminar-row"><span>${i + 1}. <strong>${escapeHtml(`${a.first_name} ${a.last_name}`.trim())}</strong>${a.email ? ` <span class="roster-sub">${escapeHtml(a.email)}</span>` : ' <span class="roster-sub">(no email)</span>'}</span></div>`).join('');
    const errBlock = errors.length ? `<div class="info-msg">⚠️ ${errors.map(escapeHtml).join('; ')}. Fix these lines before submitting.</div>` : '';
    const cap = attendees.length > window.WR26_OPTIONS.MAX_ATTENDEES ? `<div class="info-msg">⚠️ ${attendees.length} attendees exceeds the limit of ${window.WR26_OPTIONS.MAX_ATTENDEES} per group.</div>` : '';
    out.innerHTML = `<div class="info-msg"><strong>${attendees.length}</strong> attendee(s) ready.</div>${cap}${errBlock}${rows}`;
  }

  function readFile() {
    const file = $('g-file').files && $('g-file').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { $('g-roster').value = String(reader.result || ''); renderPreview(); };
    reader.readAsText(file);
  }

  function selectedPayment() {
    const checked = document.querySelector('input[name="g-pay"]:checked');
    return checked ? checked.value : 'pay_later';
  }

  function resetForm() {
    $('group-form').reset();
    $('g-preview').innerHTML = '';
    parsed = { attendees: [], errors: [] };
    $('group-done-panel').hidden = true;
    $('group-form-panel').hidden = false;
    showStatus('', 'info');
  }

  async function submitGroup(event) {
    event.preventDefault();
    const button = $('group-submit');
    showStatus('', 'info');
    renderPreview();
    if (!parsed.attendees.length) { showStatus('Add at least one attendee to your list.', 'error'); return; }
    if (parsed.errors.length) { showStatus(`Please fix your list: ${parsed.errors.join('; ')}.`, 'error'); return; }
    if (parsed.attendees.length > window.WR26_OPTIONS.MAX_ATTENDEES) { showStatus(`A group can have at most ${window.WR26_OPTIONS.MAX_ATTENDEES} attendees.`, 'error'); return; }
    setBusy(button, true, 'Submit Group Registration');
    try {
      const body = {
        first_name: $('g-first').value.trim(),
        last_name: $('g-last').value.trim(),
        email: $('g-email').value.trim(),
        phone: $('g-phone').value.trim(),
        church: $('g-church').value.trim(),
        payment_method: selectedPayment(),
        promo_code: $('g-promo').value.trim(),
        attendees: parsed.attendees,
      };
      const payload = await api('/api/group/register', body);
      const total = payload.finalAmount != null ? ` Total due: $${payload.finalAmount}.` : '';
      $('group-done-summary').textContent = `Registered ${payload.attendeeCount || parsed.attendees.length} attendee(s).${total}`;
      $('group-form-panel').hidden = true;
      $('group-done-panel').hidden = false;
      $('group-done-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      setBusy(button, false, 'Submit Group Registration');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('g-preview-btn').addEventListener('click', renderPreview);
    $('g-roster').addEventListener('blur', renderPreview);
    $('g-file').addEventListener('change', readFile);
    $('group-form').addEventListener('submit', submitGroup);
    $('group-another').addEventListener('click', resetForm);
  });
})();
