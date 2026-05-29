(() => {
  const $ = (id) => document.getElementById(id);

  function showStatus(message, type = 'info') {
    const status = $('worker-status');
    status.textContent = message || '';
    status.className = `portal-alert ${type}`;
    status.hidden = !message;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Please wait…' : label;
  }

  function collectSeminarPrefs() {
    const prefs = {};
    document.querySelectorAll('#worker-form [data-pref]').forEach((el) => {
      const value = el.value.trim();
      if (!value) return;
      const [slot, key] = el.dataset.pref.split('.');
      prefs[slot] = prefs[slot] || {};
      prefs[slot][key] = value;
    });
    return prefs;
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

  function resetForm() {
    $('worker-form').reset();
    $('worker-done-panel').hidden = true;
    $('worker-form-panel').hidden = false;
    showStatus('', 'info');
  }

  async function submitWorker(event) {
    event.preventDefault();
    const button = $('worker-submit');
    setBusy(button, true, 'Submit Worker Registration');
    showStatus('', 'info');
    try {
      const body = {
        first_name: $('w-first').value.trim(),
        last_name: $('w-last').value.trim(),
        email: $('w-email').value.trim(),
        phone: $('w-phone').value.trim(),
        church: $('w-church').value.trim(),
        worker_role: $('w-role').value.trim(),
        meal_preference: $('w-meal').value.trim(),
        dietary_needs: $('w-dietary').value.trim(),
        emergency_contact_name: $('w-ec-name').value.trim(),
        emergency_contact_phone: $('w-ec-phone').value.trim(),
        seminar_preferences: collectSeminarPrefs(),
      };
      await api('/api/worker/register', body);
      $('worker-form-panel').hidden = true;
      $('worker-done-panel').hidden = false;
      $('worker-done-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      setBusy(button, false, 'Submit Worker Registration');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('worker-form').addEventListener('submit', submitWorker);
    $('worker-another').addEventListener('click', resetForm);
  });
})();
