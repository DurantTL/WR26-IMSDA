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
  const html = `
<div class="wr26-roster-intro" style="margin:10px 0;">
  <h3 style="color:#4c1d95;margin:0 0 4px 0;">Who's attending &amp; seminar choices</h3>
  <p style="color:#5b6470;margin:0;font-size:0.92em;">Add each attendee and pick their seminar preferences. The registration total updates automatically.</p>
</div>
<div id="wr26-roster"></div>`;
  // The interactive roster/seminar-card UI is NOT embedded here. Fluent Forms
  // strips <script> from Custom HTML, so the behavior ships as a real asset
  // (plugin/assets/wr26-roster.js + .css) enqueued by the WR26 plugin. This field
  // only provides the #wr26-roster mount point the script renders into.
  return {
    index: 21,
    element: 'custom_html',
    attributes: [],
    settings: { html_codes: html, conditional_logics: [], container_class: '', visible: true },
    editor_options: { title: 'Custom HTML', icon_class: 'ff-edit-html', template: 'customHTML' },
    uniqElKey: 'el_WR26_patch_roster_mount',
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
    rosterMountHtml(),
  ].filter((field) => {
    const name = fieldName(field);
    const nameAlreadyExists = name ? hasField(fields, name) : false;
    const keyAlreadyExists = fields.some((existing) => existing.uniqElKey === field.uniqElKey);
    return !nameAlreadyExists && !keyAlreadyExists;
  });

  if (!additions.length) return 0;

  // Mount the roster just before the payment block so the flow reads:
  // contact → roster + seminars → payment summary.
  const paymentMethodIndex = fields.findIndex((field) => fieldName(field) === 'payment_method');
  const insertAt = paymentMethodIndex >= 0 ? paymentMethodIndex : fields.length;
  fields.splice(insertAt, 0, ...additions);
  return additions.length;
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
updateHeaderCopy(fields);
form.has_payment = '1';
writeJson(outputPath, exportJson);

console.log('WR26 smart payment patch complete.');
console.log(`Input:  ${inputPath}`);
console.log(`Output: ${outputPath}`);
console.log(`Added attendee fields: ${attendeeAdded}`);
console.log(`Added payment fields:  ${paymentAdded}`);
console.log(`Added roster fields:   ${rosterAdded}`);
console.log('Next: import the patched JSON into Fluent Forms staging and test Pay Later + Square.');
