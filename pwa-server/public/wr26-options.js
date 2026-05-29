/* Shared option lists + <select> helpers so the staff app, registrant portal, and
 * worker page all present the same dropdowns the Fluent Form uses. Loaded as a
 * plain global (no modules) before the page script. Values match the Fluent Form
 * exactly so data stays consistent across intake paths. */
(function (global) {
  const MEAL_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'vegan', label: 'Vegan' },
    { value: 'gluten_free', label: 'Gluten-Free' },
    { value: 'other', label: 'Other' },
  ];
  const ATTENDEE_TYPE_OPTIONS = [
    { value: 'adult', label: 'Adult' },
    { value: 'teen', label: 'Teen' },
    { value: 'child', label: 'Child' },
  ];
  const CHILDCARE_OPTIONS = [
    { value: 'no', label: 'No' },
    { value: 'yes', label: 'Yes' },
  ];
  // 8 breakouts across 4 slots. Fallback options (stable Fluent values) are used
  // only until the Seminars sheet is populated with real titles, at which point
  // the dropdowns are driven by that sheet so choices == assignable seminars.
  const SEMINAR_SLOTS = [
    { slot: 'session_1', label: 'Friday 4:00–5:00 PM', ranks: 2 },
    { slot: 'session_2', label: 'Saturday 2:00–3:15 PM', ranks: 2 },
    { slot: 'session_3', label: 'Saturday 3:30–4:45 PM', ranks: 2 },
    { slot: 'session_4', label: 'Sunday 8:15–9:15 AM', ranks: 1 },
  ];
  const SEMINAR_FALLBACK = {
    session_1: [{ value: 'fri_opt_1', label: 'Friday Option A' }, { value: 'fri_opt_2', label: 'Friday Option B' }],
    session_2: [{ value: 'sat_2pm_opt_1', label: 'Sat 2PM Option A' }, { value: 'sat_2pm_opt_2', label: 'Sat 2PM Option B' }, { value: 'sat_2pm_opt_3', label: 'Sat 2PM Option C' }],
    session_3: [{ value: 'sat_330_opt_1', label: 'Sat 3:30PM Option A' }, { value: 'sat_330_opt_2', label: 'Sat 3:30PM Option B' }],
    session_4: [{ value: 'sun_opt_1', label: 'Sunday Option A' }],
  };

  // Live seminar options grouped by slot, loaded from the server when available.
  let seminarBySlot = null;

  function escapeAttr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Render a <select> for the given attribute string (e.g. 'data-a="meal_preference"').
  // Preserves an unknown/legacy current value by appending it as a selected option,
  // so editing never silently drops data the dropdown doesn't list.
  function selectHtml(attrString, currentValue, options, placeholder) {
    const current = String(currentValue == null ? '' : currentValue);
    const known = options.some((o) => String(o.value) === current);
    const parts = [`<select ${attrString}>`];
    parts.push(`<option value=""${current === '' ? ' selected' : ''}>${escapeAttr(placeholder || '- Select -')}</option>`);
    options.forEach((o) => {
      parts.push(`<option value="${escapeAttr(o.value)}"${String(o.value) === current ? ' selected' : ''}>${escapeAttr(o.label)}</option>`);
    });
    if (current && !known) parts.push(`<option value="${escapeAttr(current)}" selected>${escapeAttr(current)}</option>`);
    parts.push('</select>');
    return parts.join('');
  }

  function seminarOptions(slot) {
    if (seminarBySlot && seminarBySlot[slot] && seminarBySlot[slot].length) return seminarBySlot[slot];
    return SEMINAR_FALLBACK[slot] || [];
  }

  // Fetch live seminars and group them by slot. Accepts the {seminars:[{slot,title}]}
  // shape returned by both /api/seminars and /api/seminars/public. Safe to call
  // without auth where a public endpoint is provided; falls back silently.
  async function loadSeminars(url) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return false;
      const payload = await response.json();
      const list = Array.isArray(payload.seminars) ? payload.seminars : [];
      if (!list.length) return false;
      const grouped = {};
      list.forEach((s) => {
        if (s.active === false) return;
        const slot = String(s.slot || '');
        const title = String(s.title || s.seminarTitle || '').trim();
        if (!slot || !title) return;
        (grouped[slot] = grouped[slot] || []).push({ value: title, label: title });
      });
      if (Object.keys(grouped).length) { seminarBySlot = grouped; return true; }
      return false;
    } catch (_error) {
      return false;
    }
  }

  global.WR26_OPTIONS = {
    MEAL_OPTIONS,
    ATTENDEE_TYPE_OPTIONS,
    CHILDCARE_OPTIONS,
    SEMINAR_SLOTS,
    selectHtml,
    seminarOptions,
    loadSeminars,
  };
})(window);
