# WR26 Fluent Forms JSON Review

Reviewed file:

```text
form/wr26-registration-fluentforms.json
```

## Summary

The form JSON is close for basic registration intake, but two important areas need attention before relying on it live:

1. **Attendee 1 field mismatch** — the WordPress parser expects attendee 1 to use the same `a1_*` name fields as attendees 2–5, but the current JSON starts Attendee 1 at meal preference and seminar choices.
2. **Payment item missing** — the form has a payment method and payment summary, but no chargeable payment item/product field. Square/Pay Now usually needs an actual payment item/product total to charge.

## Confirmed good items

These field names are present and align with the parser:

```text
first_name
last_name
email
phone
church
church_other
arrival_date
departure_date
emergency_contact_name
emergency_contact_phone
special_needs
attendee_notes
attendee_count
payment_method
promo_code
worker_registration
acknowledgment
```

The payment method field is present and uses the expected values:

```text
offline
square
```

The default payment method is set to:

```text
offline
```

That part is correct for Pay Later default behavior.

## Issue 1 — Attendee 1 fields are missing

The parser currently expects these fields for attendee 1:

```text
a1_first_name
a1_last_name
a1_phone
a1_attendee_type
```

The current JSON has:

```text
first_name
last_name
phone
```

for the primary contact, then Attendee 1 begins with:

```text
a1_meal_preference
a1_dietary_needs
a1_childcare_needed
a1_session1_pref1
...
```

### Why this matters

The parser loops through attendees using the uniform pattern:

```text
aN_first_name
aN_last_name
aN_phone
aN_attendee_type
```

For attendee 1, the current form does not provide those `a1_*` fields, so attendee 1 may be written with blank first name, last name, phone, and attendee type unless the parser is changed to fall back to the primary contact fields.

### Best fix

Add these fields immediately under **Attendee 1 — You**:

```text
a1_first_name
a1_last_name
a1_phone
a1_attendee_type
```

Recommended labels:

```text
Attendee 1 First Name
Attendee 1 Last Name
Attendee 1 Phone
Attendee Type
```

Recommended attendee type values:

```text
adult
child
```

For a cleaner registrant experience, you can either:

- keep these visible and explain that the primary contact may also be attendee 1, or
- use Fluent Forms default-value/merge-tag behavior to prefill them from `first_name`, `last_name`, and `phone` if supported in your setup.

## Issue 2 — Missing chargeable payment item/product

The current JSON has:

```text
payment_method
payment_summary
```

But it does **not** appear to include a chargeable payment item/product field such as a Payment Item, Custom Payment Amount, or comparable Fluent Forms payment product component.

### Why this matters

A payment method field lets the registrant choose Pay Later vs Square. A payment summary displays selected payment items. But Square still needs a chargeable payment item/total in the form. Without that, Pay Now may not create a usable transaction or may produce a zero/empty payment total.

### Best fix in Fluent Forms builder

After importing the JSON, add a **Payment Item** field before the Payment Method field.

Recommended name:

```text
registration_total
```

Recommended label:

```text
Registration Fee
```

Recommended product options if using fixed pricing by attendee count:

Early Bird version:

```text
1 attendee — $125
2 attendees — $250
3 attendees — $375
4 attendees — $500
5 attendees — $625
```

Regular version:

```text
1 attendee — $145
2 attendees — $290
3 attendees — $435
4 attendees — $580
5 attendees — $725
```

If you want one form to automatically switch between Early Bird and Regular, do that either with:

- separate early/regular form versions,
- Fluent Forms conditional payment items,
- Fluent Forms calculation fields if your installed version supports them reliably,
- or plugin-side/GAS-side balance calculation while Pay Now is disabled until confirmed.

## Safer launch recommendation

For first live testing:

1. Keep **Pay Later** as default.
2. Add/test the Payment Item field in a staging form.
3. Submit a Pay Later test with 1 attendee.
4. Submit a Pay Later test with 3 attendees.
5. Submit a Square test with 1 attendee.
6. Submit a Square test with 3 attendees.
7. Confirm the WordPress submission has payment meta/order items.
8. Confirm the Google Sheet receives:
   - Original Amount
   - Final Amount
   - Payment Method
   - Payment Status
   - Amount Paid
   - Square Payment ID when paid

## Validator added

A validator script has been added:

```text
tools/validate-wr26-form-json.js
```

Run:

```bash
node tools/validate-wr26-form-json.js
```

It checks:

- top-level field names,
- attendee field names,
- payment method options,
- Pay Later default,
- payment summary presence,
- whether a chargeable payment item/product field exists.

## Important note

The current JSON should not be considered final for Square/Pay Now until a chargeable payment item/product is added and tested in Fluent Forms. Payment Method + Payment Summary alone is not enough for a reliable payment form.
