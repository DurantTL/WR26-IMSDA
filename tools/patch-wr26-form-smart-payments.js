#!/usr/bin/env node

/**
 * Patch WR26 Fluent Forms JSON with the CM26-style smart payment pattern.
 *
 * What it adds:
 * - Missing Attendee 1 parser fields: a1_first_name, a1_last_name, a1_phone, a1_attendee_type
 * - Hidden subtotal / discount / fee / total fields
 * - Hidden custom_payment_component named custom_payment_amount so Square has a chargeable amount
 * - Visible custom summary showing subtotal, discount, processing fee only for card, and total
 * - JavaScript that recalculates totals from attendee_count, payment_method, and promo_code
 *
 * What it reorders / polishes:
 * - Mounts the interactive roster (#wr26-roster) directly ABOVE the Attendee 1
 *   section so the rich attendee + seminar UI is the primary experience and the
 *   legacy a{N}_* block sits below it as the collapsed, JS-gated no-JS fallback.
 * - Adds a "enter attendees manually" note shown only when JavaScript is off.
 * - Enriches the legacy seminar dropdown option labels with the speaker name so
 *   the no-JS fallback reads better (values are untouched, parsing is unaffected).
 *
 * Usage:
 *   node tools/patch-wr26-form-smart-payments.js
 *   node tools/patch-wr26-form-smart-payments.js --in-place
 *   node tools/patch-wr26-form-smart-payments.js input.json output.json
 *
 * Defaults:
 *   input:  form/wr26-registration-fluentforms.json
 *   output: form/wr26-registration-fluentforms.smart-payments.json
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const defaultInput = path.join(repoRoot, 'form', 'wr26-registration-fluentforms.json');
const defaultOutput = path.join(repoRoot, 'form', 'wr26-registration-fluentforms.smart-payments.json');

const args = process.argv.slice(2);
const inPlace = args.includes('--in-place');
const cleanedArgs = args.filter((arg) => arg !== '--in-place');
const inputPath = cleanedArgs[0] ? path.resolve(cleanedArgs[0]) : defaultInput;
const outputPath = inPlace ? inputPath : (cleanedArgs[1] ? path.resolve(cleanedArgs[1]) : defaultOutput);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function fieldsOf(exportJson) {
  const form = Array.isArray(exportJson) ? exportJson[0] : exportJson;
  if (!form?.form_fields?.fields || !Array.isArray(form.form_fields.fields)) {
    throw new Error('Could not find form_fields.fields in the Fluent Forms export.');
  }
  return { form, fields: form.form_fields.fields };
}

function fieldName(field) {
  return field?.attributes && typeof field.attributes === 'object' ? field.attributes.name : '';
}

function hasField(fields, name) {
  return fields.some((field) => fieldName(field) === name);
}

function requiredRule(required) {
  return {
    required: {
      value: !!required,
      message: 'This field is required',
      global_message: 'This field is required',
      global: true,
    },
  };
}

function inputText(index, name, label, placeholder = '', required = true) {
  return {
    index,
    element: 'input_text',
    attributes: { type: 'text', name, value: '', id: '', class: '', placeholder, maxlength: '' },
    settings: {
      container_class: '',
      label,
      label_placement: '',
      admin_field_label: label,
      help_message: '',
      prefix_label: '',
      suffix_label: '',
      validation_rules: requiredRule(required),
      conditional_logics: [],
      visible: true,
      is_unique: 'no',
      unique_validation_message: 'This value need to be unique.',
    },
    editor_options: { title: 'Simple Text', icon_class: 'ff-edit-text', template: 'inputText' },
    uniqElKey: `el_WR26_patch_${name}`,
  };
}

function phoneField(index, name, label, required = true) {
  return {
    index,
    element: 'phone',
    attributes: { name, class: '', value: '', type: 'tel', placeholder: '' },
    settings: {
      container_class: '',
      placeholder: '',
      auto_select_country: 'no',
      label,
      label_placement: '',
      help_message: '',
      admin_field_label: label,
      phone_country_list: { active_list: 'all', visible_list: [], hidden_list: [] },
      default_country: '',
      validation_rules: {
        required: { value: !!required, global: true, message: 'This field is required', global_message: 'This field is required' },
        valid_phone_number: { value: false, global: true, message: 'Phone number is not valid', global_message: 'Phone number is not valid' },
      },
      conditional_logics: [],
      visible: true,
    },
    editor_options: { title: 'Phone/Mobile', icon_class: 'el-icon-phone-outline', template: 'inputText' },
    uniqElKey: `el_WR26_patch_${name}`,
  };
}

function selectField(index, name, label, options, required = true) {
  return {
    index,
    element: 'select',
    attributes: { name, value: '', id: '', class: '' },
    settings: {
      dynamic_default_value: '',
      label,
      admin_field_label: label,
      help_message: '',
      container_class: '',
      label_placement: '',
      placeholder: '- Select -',
      advanced_options: options.map((option, id) => ({ label: option.label, value: option.value, calc_value: '', id })),
      validation_rules: requiredRule(required),
      conditional_logics: [],
      visible: true,
      calc_value_status: false,
      enable_image_input: false,
      values_visible: false,
      enable_select_2: 'no',
      randomize_options: 'no',
      inventory_type: false,
      inventory_stockout_message: 'This Item is Stock Out',
      hide_choice_when_stockout: 'no',
      hide_input_when_stockout: 'no',
      disable_input_when_stockout: 'no',
      show_stock: 'no',
      simple_inventory: '',
      single_inventory_stock: 10,
      stock_quantity_label: ' - {remaining_quantity} available',
      global_inventory: '',
    },
    editor_options: { title: 'Dropdown', icon_class: 'ff-edit-dropdown', element: 'select', template: 'select' },
    uniqElKey: `el_WR26_patch_${name}`,
  };
}

function hiddenField(name, label) {
  return {
    index: 0,
    element: 'input_hidden',
    attributes: { type: 'hidden', name, value: '' },
    settings: { admin_field_label: label || name },
    editor_options: { title: 'Hidden Field', icon_class: 'ff-edit-hidden-field', template: 'inputHidden' },
    uniqElKey: `el_WR26_patch_${name}`,
  };
}

function customPaymentAmountField() {
  return {
    index: 6,
    element: 'custom_payment_component',
    attributes: {
      type: 'number',
      name: 'custom_payment_amount',
      value: '',
      id: '',
      class: 'ff-hidden',
      placeholder: '',
      'data-payment_item': 'yes',
    },
    settings: {
      container_class: 'ff-hidden',
      is_payment_field: 'yes',
      label: 'WR26 - Registration Total',
      admin_field_label: 'WR26 - Registration Total',
      label_placement: '',
      help_message: '',
      number_step: '',
      prefix_label: '',
      suffix_label: '',
      validation_rules: {
        required: { value: false, global: true, message: 'This field is required', global_message: 'This field is required' },
        numeric: { value: true, global: true, message: 'This field must contain numeric value', global_message: 'This field must contain numeric value' },
        min: { value: '', global: true, message: 'Validation fails for minimum value', global_message: 'Validation fails for minimum value' },
        max: { value: '', global: true, message: 'Validation fails for maximum value', global_message: 'Validation fails for maximum value' },
      },
      conditional_logics: [],
      calculation_settings: { status: false, formula: '' },
    },
    editor_options: { title: 'Custom Payment Amount', icon_class: 'ff-edit-keyboard-o', template: 'inputText' },
    uniqElKey: 'el_WR26_patch_custom_payment_amount',
  };
}

function paymentSummaryHtml() {
  const html = `
<div class="wr26-summary-box" style="background:#f7fafc;border:2px solid #7c3aed;border-radius:10px;padding:20px;margin:15px 0;font-family:Arial,Helvetica,sans-serif;">
  <h3 style="color:#4c1d95;margin:0 0 12px 0;">Your Registration Summary</h3>
  <table style="width:100%;border-collapse:collapse;">
    <tbody>
      <tr><td>Registration</td><td id="wr26-sum-registration" style="text-align:right;font-weight:bold;">$0.00</td></tr>
      <tr id="wr26-sum-discount-row"><td>Promo Discount</td><td id="wr26-sum-discount" style="text-align:right;color:#166534;">-$0.00</td></tr>
      <tr style="border-top:1px solid #ddd;"><td>Subtotal</td><td id="wr26-sum-subtotal" style="text-align:right;">$0.00</td></tr>
      <tr id="wr26-sum-fee-row"><td>Credit/Debit Card Processing Fee (2.9% + $0.30)</td><td id="wr26-sum-fee" style="text-align:right;">$0.00</td></tr>
      <tr style="border-top:2px solid #7c3aed;font-size:1.2em;font-weight:bold;"><td>Total</td><td id="wr26-sum-total" style="text-align:right;color:#7c3aed;">$0.00</td></tr>
    </tbody>
  </table>
  <p id="wr26-pay-note" style="font-size:0.9em;color:#5b6470;margin:10px 0 0 0;">Pay Later is selected. No card fee is added.</p>
</div>`;
  // The live recalc script is intentionally NOT embedded here. Fluent Forms
  // sanitizes Custom HTML and strips <script> tags, which left the JS rendering
  // as visible text and the totals frozen at $0.00. The script now ships as a
  // real asset (plugin/assets/wr26-form-summary.js) enqueued by the WR26 plugin.

  return {
    index: 96,
    element: 'custom_html',
    attributes: [],
    settings: { html_codes: html, conditional_logics: [], container_class: '', visible: true },
    editor_options: { title: 'Custom HTML', icon_class: 'ff-edit-html', template: 'customHTML' },
    uniqElKey: 'el_WR26_patch_payment_summary_script',
  };
}

function patchAttendeeOne(fields) {
  const needed = [
    inputText(17, 'a1_first_name', 'Attendee 1 First Name', 'First name', true),
    inputText(18, 'a1_last_name', 'Attendee 1 Last Name', 'Last name', true),
    phoneField(19, 'a1_phone', 'Attendee 1 Phone', false),
    selectField(20, 'a1_attendee_type', 'Attendee Type', [
      { label: 'Adult', value: 'adult' },
      { label: 'Child', value: 'child' },
    ], true),
  ].filter((field) => !hasField(fields, fieldName(field)));

  if (!needed.length) return 0;

  const sectionIndex = fields.findIndex((field) => field.uniqElKey === 'el_WR26_16_a1_section' || String(field?.settings?.label || '').startsWith('Attendee 1'));
  const insertAt = sectionIndex >= 0 ? sectionIndex + 1 : 0;
  fields.splice(insertAt, 0, ...needed);
  return needed.length;
}

function patchPayment(fields) {
  const additions = [
    hiddenField('registration_price_each', 'registration price each'),
    hiddenField('registration_subtotal', 'registration subtotal'),
    hiddenField('discount_amount', 'discount amount'),
    hiddenField('processing_fee', 'processing fee'),
    hiddenField('registration_total', 'registration total'),
    hiddenField('total_amount', 'total amount'),
    customPaymentAmountField(),
    paymentSummaryHtml(),
  ].filter((field) => {
    const name = fieldName(field);
    const nameAlreadyExists = name ? hasField(fields, name) : false;
    const keyAlreadyExists = fields.some((existing) => existing.uniqElKey === field.uniqElKey);
    return !nameAlreadyExists && !keyAlreadyExists;
  });

  if (!additions.length) return 0;

  const paymentMethodIndex = fields.findIndex((field) => fieldName(field) === 'payment_method');
  const insertAt = paymentMethodIndex >= 0 ? paymentMethodIndex : fields.length;
  fields.splice(insertAt, 0, ...additions);
  return additions.length;
}

function rosterMountHtml() {
  // Just the mount point. The interactive roster/seminar-card UI is NOT embedded
  // here — Fluent Forms strips <script> from Custom HTML, so the behavior ships as
  // a real asset (plugin/assets/wr26-roster.js + .css) enqueued by the WR26 plugin.
  // The script renders its own intro heading + cards inside #wr26-roster, so no
  // static heading lives here (that avoids a duplicate heading once JS runs). When
  // JavaScript is off this stays an empty div and the gated legacy block below
  // (with its own "enter attendees manually" note) is the fallback.
  const html = `<div id="wr26-roster"></div>`;
  return {
    index: 16,
    element: 'custom_html',
    attributes: [],
    settings: { html_codes: html, conditional_logics: [], container_class: '', visible: true },
    editor_options: { title: 'Custom HTML', icon_class: 'ff-edit-html', template: 'customHTML' },
    uniqElKey: 'el_WR26_patch_roster_mount',
  };
}

// No-JavaScript fallback banner shown only when the roster UI is NOT active
// (roster_active != 1). It tells visitors with JS off to use the manual attendee
// fields below and points them at the seminar-description box for details. Gated
// here at creation so gateLegacyBehindRoster() leaves it alone.
function legacyFallbackNoteHtml() {
  const html = `
<div class="wr26-legacy-note" style="padding:12px 14px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:6px;margin:8px 0;font-family:Arial,Helvetica,sans-serif;">
  <strong style="color:#92400e;">Entering attendees manually</strong>
  <p style="margin:6px 0 0;color:#5b4a1f;font-size:0.92em;">The interactive attendee picker needs JavaScript and it doesn't appear to be running, so please fill in each attendee and their seminar choices using the fields below. Seminar descriptions are in the &ldquo;Breakout Session Descriptions&rdquo; box above.</p>
</div>`;
  return {
    index: 17,
    element: 'custom_html',
    attributes: [],
    settings: {
      html_codes: html,
      conditional_logics: { status: true, type: 'all', conditions: [{ field: 'roster_active', operator: '!=', value: '1' }] },
      container_class: '',
      visible: true,
    },
    editor_options: { title: 'Custom HTML', icon_class: 'ff-edit-html', template: 'customHTML' },
    uniqElKey: 'el_WR26_patch_legacy_fallback_note',
  };
}

function patchRoster(fields) {
  // The custom roster UI serializes everything into these hidden fields. The WR26
  // plugin parser reads attendees_json (uncapped) in preference to the legacy
  // a{N}_* fields, which remain in the form as a no-JS fallback.
  const additions = [
    hiddenField('attendees_json', 'attendees json'),
    hiddenField('seminar_counts_json', 'seminar counts json'),
    hiddenField('registration_roster_preview', 'registration roster preview'),
    hiddenField('roster_active', 'roster active'),
    rosterMountHtml(),
    legacyFallbackNoteHtml(),
  ].filter((field) => {
    const name = fieldName(field);
    const nameAlreadyExists = name ? hasField(fields, name) : false;
    const keyAlreadyExists = fields.some((existing) => existing.uniqElKey === field.uniqElKey);
    return !nameAlreadyExists && !keyAlreadyExists;
  });

  if (!additions.length) return 0;

  // Mount the roster right BEFORE the "Attendee 1 — You" section break so the rich
  // attendee + seminar UI is the primary experience and sits directly under the
  // Primary Contact / seminar-description block. The legacy a{N}_* block then
  // follows immediately below it as the (gated, hidden-when-JS-runs) no-JS
  // fallback, preceded by the legacy-fallback note. This is what makes the flow
  // read: primary contact → roster + seminars → [collapsed legacy fallback] →
  // payment. Fall back to the "Payment & Promo Code" section, then payment_method,
  // then end of form if the attendee section can't be located.
  const attendeeOneIndex = fields.findIndex((field) =>
    field.uniqElKey === 'el_WR26_16_a1_section' ||
    (field.element === 'section_break' && /^Attendee\s*1\b/i.test(String(field?.settings?.label || '')))
  );
  const paymentSectionIndex = fields.findIndex((field) =>
    field.element === 'section_break' && /Payment\s*&?\s*Promo/i.test(String(field?.settings?.label || ''))
  );
  const paymentMethodIndex = fields.findIndex((field) => fieldName(field) === 'payment_method');
  const insertAt = attendeeOneIndex >= 0
    ? attendeeOneIndex
    : (paymentSectionIndex >= 0
      ? paymentSectionIndex
      : (paymentMethodIndex >= 0 ? paymentMethodIndex : fields.length));
  fields.splice(insertAt, 0, ...additions);
  return additions.length;
}

/**
 * Merge a `roster_active != 1` condition into one field's conditional logic,
 * preserving any existing conditions (combined with AND). Idempotent.
 */
function gateFieldBehindRoster(field) {
  const rosterCondition = { field: 'roster_active', operator: '!=', value: '1' };
  const existing = field.settings && field.settings.conditional_logics;
  let conditions = [];
  if (existing && !Array.isArray(existing) && Array.isArray(existing.conditions)) {
    conditions = existing.conditions.slice();
  }
  if (conditions.some((c) => c && c.field === 'roster_active')) return false;
  conditions.push(rosterCondition);
  field.settings.conditional_logics = { status: true, type: 'all', conditions };
  return true;
}

/**
 * Gate the entire legacy attendee block behind the roster.
 *
 * The custom roster UI sets the hidden roster_active flag to "1". Adding a
 * `roster_active != 1` condition to each legacy field/section makes Fluent Forms
 * hide them — and crucially SKIP their (required) validation and exclude them from
 * the submission — whenever JavaScript/the roster is running. With JS off,
 * roster_active stays empty, the legacy block shows, and it remains the
 * fully-required no-JS fallback the plugin parser reads from a{N}_*.
 *
 * This covers (a) the a{N}_* input fields, (b) the "Attendee N" section-break
 * headers (so no orphaned heading shows), and (c) the legacy attendee_notes
 * textarea (so the roster isn't shadowed by a stray notes box). Existing
 * conditions (e.g. a2_* shown only when attendee_count >= 2) are preserved.
 */
function gateLegacyBehindRoster(fields) {
  let gated = 0;
  for (const field of fields) {
    const name = fieldName(field);
    const label = String((field.settings && field.settings.label) || '');
    const isAttendeeInput = /^a[1-5]_/.test(String(name || ''));
    const isAttendeeHeader = field.element === 'section_break' && /^Attendee\s/i.test(label);
    const isAttendeeNotes = name === 'attendee_notes';
    if (!isAttendeeInput && !isAttendeeHeader && !isAttendeeNotes) continue;
    if (gateFieldBehindRoster(field)) gated += 1;
  }
  return gated;
}

// Speaker per seminar, keyed by the exact option value (= seminar title). Mirrors
// the plugin's wr26_seminar_catalog(). Used to enrich the legacy dropdown option
// LABELS only — values are never touched, so GAS/parser matching is unaffected.
const SEMINAR_SPEAKERS = {
  'Color Me Golden: Embracing Life in Every Season': 'Panel Discussion',
  'Refined by Fire, Revealed in Beauty': 'Presenter TBD',
  'Repainted by Grace': 'Valerie Haveman',
  'Color Me Open': 'Mary Kendall',
  'Nourished by Color': 'Stephanie Richards',
  'Color Me Prayerful: Discovering the Beautiful Ways We Talk With God': 'Shannon Pigsley',
  'Shades of Peace': 'Melissa Morris',
  'Coloring Through the Chaos: Raising Children with Grace and Truth': 'Panel Discussion',
  'Broken Crayons Still Color': '',
  'Brushstrokes of Leadership': 'Ami Cook',
};

/**
 * Polish the legacy (no-JS) seminar dropdowns so the option text reads better:
 * append the speaker after an em-dash, e.g. "Session A: Color Me Golden …" becomes
 * "Session A: Color Me Golden … — Panel Discussion". Only labels change; the option
 * value (the seminar title the parser/GAS matches on) is preserved. Idempotent:
 * skips options whose label already ends with the speaker. Returns count changed.
 */
function enrichLegacySeminarLabels(fields) {
  let changed = 0;
  for (const field of fields) {
    const name = fieldName(field);
    if (!/^a[1-5]_session/.test(String(name || ''))) continue;
    const options = field?.settings?.advanced_options;
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      const speaker = SEMINAR_SPEAKERS[option.value];
      if (!speaker) continue;
      const label = String(option.label || '');
      if (label.includes(speaker)) continue;
      option.label = `${label} — ${speaker}`;
      changed += 1;
    }
  }
  return changed;
}

function updateHeaderCopy(fields) {
  const header = fields.find((field) => field.uniqElKey === 'el_WR26_1_header');
  if (header?.settings?.html_codes) {
    header.settings.html_codes = header.settings.html_codes.replace(
      'Pay Later is the default. Check your confirmation email for your payment link and edit-registration link.',
      'Pay Later is the default. If you choose Credit/Debit Card, a 2.9% + $0.30 processing fee is shown before checkout.'
    );
  }
}

const exportJson = readJson(inputPath);
const { form, fields } = fieldsOf(exportJson);
const attendeeAdded = patchAttendeeOne(fields);
const paymentAdded = patchPayment(fields);
const rosterAdded = patchRoster(fields);
const legacyGated = gateLegacyBehindRoster(fields);
const labelsEnriched = enrichLegacySeminarLabels(fields);
updateHeaderCopy(fields);
form.has_payment = '1';
writeJson(outputPath, exportJson);

console.log('WR26 smart payment patch complete.');
console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
console.log(`Added attendee fields: ${attendeeAdded}`);
console.log(`Added payment fields:  ${paymentAdded}`);
console.log(`Added roster fields:   ${rosterAdded}`);
console.log(`Gated legacy fields:   ${legacyGated}`);
console.log(`Enriched seminar opts: ${labelsEnriched}`);
console.log('Next: import the patched JSON into Fluent Forms staging and test Pay Later + Square.');
