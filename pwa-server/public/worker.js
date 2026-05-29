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

  function renderOptionFields() {
    const O = window.WR26_OPTIONS;
    const meal = $('w-meal');
    if (meal) meal.innerHTML = O.selectHtml('', '', O.MEAL_OPTIONS).replace(/^<select[^>]*>/, '').replace(/<\/select>$/, '');
    const seminars = $('w-seminars');
    if (seminars) {
      seminars.innerHTML = O.SEMINAR_SLOTS.map((slotDef) => {
        const out = [];
        for (let r = 1; r <= slotDef.ranks; r += 1) {
          const label = slotDef.ranks > 1 ? `${slotDef.label} — Pref ${r}` : slotDef.label;
          out.push(`<label>${label}${O.selectHtml(`data-pref="${slotDef.slot}.pref_${r}"`, '', O.seminarOptions(slotDef.slot), '- None -')}</label>`);
        }
        return out.join('');
      }).join('');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await window.WR26_OPTIONS.loadSeminars('/api/seminars/public').catch(() => {});
    renderOptionFields();
    $('worker-form').addEventListener('submit', submitWorker);
    $('worker-another').addEventListener('click', resetForm);
  });
})();
