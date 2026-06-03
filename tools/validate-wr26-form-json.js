#!/usr/bin/env node

/**
 * WR26 Fluent Forms JSON validator
 *
 * Usage:
 *   node tools/validate-wr26-form-json.js
 *   node tools/validate-wr26-form-json.js path/to/form.json
 *
 * This script does not modify the form. It checks the exported/importable Fluent
 * Forms JSON for the field names the WR26 WordPress plugin expects and flags the
 * payment-item issue that can prevent Square/Pay Now from having a chargeable total.
 */

const fs = require('fs');
const path = require('path');

const formPath = process.argv[2] || path.join(__dirname, '..', 'form', 'wr26-registration-fluentforms.json');

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

if (!fs.existsSync(formPath)) {
  fail(`Form JSON not found: ${formPath}`);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(formPath, 'utf8'));
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

const form = Array.isArray(parsed) ? parsed[0] : parsed;
if (!form || !form.form_fields || !Array.isArray(form.form_fields.fields)) {
  fail('This does not look like a Fluent Forms export with form_fields.fields.');
}

const fields = form.form_fields.fields;
const byName = new Map();
const byElement = new Map();

for (const field of fields) {
  const name = field?.attributes?.name;
  if (name) byName.set(name, field);
  const element = field?.element || '(unknown)';
  if (!byElement.has(element)) byElement.set(element, []);
  byElement.get(element).push(field);
}

const requiredTopLevel = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'church',
  'church_other',
  'arrival_date',
  'departure_date',
  'emergency_contact_name',
  'emergency_contact_phone',
  'special_needs',
  'attendee_notes',
  'attendee_count',
  'payment_method',
  'promo_code',
  'acknowledgment'
];

const expectedAttendeeFields = [];
for (let n = 1; n <= 5; n += 1) {
  expectedAttendeeFields.push(
    `a${n}_first_name`,
    `a${n}_last_name`,
    `a${n}_phone`,
    `a${n}_attendee_type`,
    `a${n}_meal_preference`,
    `a${n}_dietary_needs`,
    `a${n}_childcare_needed`,
    `a${n}_session1_pref1`,
    `a${n}_session1_pref2`,
    `a${n}_session2_pref1`,
    `a${n}_session2_pref2`,
    `a${n}_session3_pref1`,
    `a${n}_session3_pref2`,
    `a${n}_session4`
  );
}

const warnings = [];
const errors = [];

for (const name of requiredTopLevel) {
  if (!byName.has(name)) errors.push(`Missing top-level field: ${name}`);
}

// Custom roster UI fields. attendees_json is the uncapped source of truth the
// plugin parser prefers; the others are supporting/preview data. Treated as
// warnings so the legacy a{N}_* form still validates.
const rosterFields = ['attendees_json', 'seminar_counts_json', 'registration_roster_preview'];
for (const name of rosterFields) {
  if (!byName.has(name)) warnings.push(`Missing roster field: ${name} (custom roster UI will fall back to a{N}_* fields)`);
}
const hasRosterMount = fields.some((field) =>
  field.element === 'custom_html' && /id="wr26-roster"/.test(String(field?.settings?.html_codes || ''))
);
if (!hasRosterMount) warnings.push('Missing #wr26-roster mount element (custom roster UI will not render).');

// When the roster is in play, the required legacy a{N}_* fields MUST be gated
// behind roster_active so they don't block submission once the roster is active.
// If roster_active exists but a legacy field isn't gated, that's an error — it
// will make the form unsubmittable for roster users.
if (byName.has('roster_active')) {
  const ungated = fields.filter((field) => {
    const name = field?.attributes?.name || '';
    if (!/^a[1-5]_/.test(name)) return false;
    const cl = field?.settings?.conditional_logics;
    const conds = cl && !Array.isArray(cl) && Array.isArray(cl.conditions) ? cl.conditions : [];
    return !conds.some((c) => c && c.field === 'roster_active');
  });
  if (ungated.length) {
    errors.push(
      `roster_active exists but ${ungated.length} legacy a{N}_* field(s) are not gated behind it ` +
      `(e.g. ${ungated.slice(0, 3).map((f) => f.attributes.name).join(', ')}). ` +
      `These required fields will block submission when the roster is active. Re-run the patch generator.`
    );
  }
} else {
  warnings.push('Missing roster_active flag (legacy a{N}_* fields are not gated behind the roster UI).');
}

for (const name of expectedAttendeeFields) {
  if (!byName.has(name)) {
    const severity = name.startsWith('a1_') ? 'error' : 'warning';
    const message = `Missing attendee field: ${name}`;
    if (severity === 'error') errors.push(message);
    else warnings.push(message);
  }
}

const paymentMethod = byName.get('payment_method');
if (!paymentMethod) {
  errors.push('Missing payment_method field.');
} else {
  const options = paymentMethod?.settings?.payment_options || [];
  const values = options.map((option) => String(option.value || '').toLowerCase());
  if (!values.includes('offline')) errors.push('payment_method is missing offline / Pay Later option.');
  if (!values.includes('square')) warnings.push('payment_method is missing square / Pay Now option.');
  // No pre-selected payment method: registrants must actively choose Pay Later
  // or Pay Now, so an empty default_payment is the intended state. Only warn if a
  // method other than offline is forced as the default.
  const defaultPayment = paymentMethod?.settings?.default_payment || '';
  if (defaultPayment && defaultPayment !== 'offline') {
    warnings.push(`payment_method default_payment unexpectedly pre-selects: ${defaultPayment}`);
  }
}

const hasSummary = fields.some((field) => field.element === 'payment_summary_widget' || field.element === 'payment_summary');
if (!hasSummary) warnings.push('Missing payment summary field.');

const paymentItemElements = new Set([
  'payment_item',
  'custom_payment_component',
  'subscription_payment_component',
  'item_quantity',
  'custom_payment_amount'
]);
const paymentItems = fields.filter((field) => paymentItemElements.has(field.element));
if (!paymentItems.length) {
  errors.push(
    'No chargeable payment item/product field found. Payment Method + Payment Summary alone may not give Square anything to charge.'
  );
}

const paymentTotalFallbacks = ['total', 'payment_total', 'registration_total', 'amount', 'final_amount', 'calculated_total', 'order_total'];
const fallbackTotalsPresent = paymentTotalFallbacks.filter((name) => byName.has(name));
if (!fallbackTotalsPresent.length) {
  warnings.push(
    `No explicit total fallback field found. Plugin can read Fluent payment meta, but if payment meta is empty it only checks: ${paymentTotalFallbacks.join(', ')}.`
  );
}

console.log('\nWR26 Fluent Forms JSON Review');
console.log('================================');
console.log(`File: ${formPath}`);
console.log(`Title: ${form.title || '(untitled)'}`);
console.log(`Fields: ${fields.length}`);
console.log(`has_payment: ${form.has_payment}`);
console.log('\nPayment-related elements:');
for (const field of fields.filter((field) => String(field.element || '').includes('payment') || String(field?.attributes?.name || '').includes('payment'))) {
  console.log(`- index ${field.index}: element=${field.element}, name=${field?.attributes?.name || '(none)'}, key=${field.uniqElKey || '(none)'}`);
}

if (paymentItems.length) {
  console.log('\nChargeable payment item/product fields found:');
  for (const field of paymentItems) {
    console.log(`- index ${field.index}: element=${field.element}, name=${field?.attributes?.name || '(none)'}`);
  }
}

if (warnings.length) {
  console.log('\nWarnings:');
  warnings.forEach((warning) => console.log(`⚠️  ${warning}`));
}

if (errors.length) {
  console.log('\nErrors:');
  errors.forEach((error) => console.log(`❌ ${error}`));
  console.log('\nResult: FAIL — fix these before relying on Pay Now / Square or attendee 1 parsing.');
  process.exit(2);
}

console.log('\nResult: PASS — required fields and payment item checks look OK.');
