# WR26 Square / Card Payment Setup

This is the practical, step-by-step guide for getting credit-card payments
working for the Women's Retreat 2026 registration. Read the two sections in
order — the first (at-registration card payments) is ready to go; the second
(pay-later card payments) is a decision you still need to make.

---

## TL;DR

- **You import ONE file**, not two: `form/wr26-registration-fluentforms.smart-payments.json`.
  The chargeable Square amount field is already embedded inside it. You do **not**
  add a Payment Item field by hand.
- The card is charged **entirely inside Fluent Forms by Square**. Card data never
  touches Google Apps Script or the PWA — only the resulting `squarePaymentId`
  and status come back.
- The one thing this repo **cannot** do for you: connecting your Square *account*
  to Fluent Forms (that's an account/credentials step in WordPress). Steps below.

---

## Part 1 — At-registration card payments (Fluent Forms + Square)

### What the import file already contains

`form/wr26-registration-fluentforms.smart-payments.json` was produced by
`tools/patch-wr26-form-smart-payments.js` and bundles everything in a single
importable form:

| Added | Why |
|---|---|
| `a1_first_name`, `a1_last_name`, `a1_phone`, `a1_attendee_type` | Attendee 1 parser fields the WordPress plugin expects |
| Hidden `registration_subtotal`, `discount_amount`, `processing_fee`, `registration_total`, `total_amount` | Working totals |
| **`custom_payment_amount`** (`custom_payment_component`, `is_payment_field: yes`) | **The chargeable amount Square actually bills.** This is the field the review said was missing. |
| Custom summary + recalc JavaScript | Recomputes the total live from `attendee_count` + `payment_method` (adds the 2.9% + $0.30 card fee only on the card path) and writes it into `custom_payment_amount` |

The form also already has the Fluent Forms `payment_method` gateway selector
(values `offline` = Pay Later, `square` = card) and a `payment_summary` widget,
with `has_payment: 1`. Validated with:

```bash
node tools/validate-wr26-form-json.js form/wr26-registration-fluentforms.smart-payments.json
# Result: PASS
```

### Steps in WordPress (the part only you can do)

1. **Install/confirm Fluent Forms Pro** + the **Square** payment module
   (Fluent Forms → Payments / Global Settings → Payment Methods → Square).
2. **Connect your Square account.** In Fluent Forms global Square settings,
   either connect via OAuth or paste your Square **Application ID**,
   **Access Token**, and **Location ID**. Use **Sandbox** credentials first for
   testing, then switch to **Live**. *(These credentials live in WordPress only —
   never put them in this repo, GAS, or the PWA.)*
3. **Import the form (once):** Fluent Forms → Forms → Import → upload
   `form/wr26-registration-fluentforms.smart-payments.json`.
4. **Verify the gateway on the form:** open the imported form, confirm the
   `payment_method` field offers *Pay Later (offline)* and *Credit/Debit Card
   (square)*, and that Square is the enabled gateway. Fluent Forms should
   auto-detect `custom_payment_amount` as the payment item because it is flagged
   `is_payment_field: yes` — confirm it's selected as the chargeable amount in the
   form's payment settings.
5. **Keep prices in sync.** The in-form JS uses `EARLY_PRICE=120`,
   `REGULAR_PRICE=140`, `EARLY_END=2026-08-14`. These must match the GAS Config
   sheet (`EARLY_BIRD_PRICE`, `REGULAR_PRICE`, `EARLY_BIRD_END_DATE`). GAS is the
   source of truth and re-checks the owed amount; drift is flagged, not silently
   charged. If you change prices, update both.

### Test matrix (do this in staging before going live)

1. Pay Later × 1 attendee → status `pending_pay_later`, no fee.
2. Pay Later × 3 attendees → balance = 3 × price.
3. Square × 1 attendee → card charged incl. 2.9% + $0.30 fee; sheet gets
   `squarePaymentId` and status `paid`.
4. Square × 3 attendees → same, larger amount.
5. Confirm the Google Sheet `Registrations` row shows: Original Amount, Final
   Amount, Payment Method, Payment Status, Amount Paid, Square Payment ID.

---

## Part 2 — Pay-later card payments (BUILT)

Pay Later no longer dead-ends at "mail a check." When a registrant owes a
balance, GAS now creates a **Square-hosted payment link for the exact balance it
computed** (promo discount already applied) and embeds a **"Pay by Card Now"**
button in the confirmation and payment-reminder emails. Square hosts the card
capture, so no card data touches GAS or the PWA — only a hosted URL is emailed.

This pairs with a guard added to the form (Part 1): because a promo code can't be
applied to the *instant* card checkout, **anyone who enters a promo code is
steered to Pay Later**, where this link charges the correct discounted amount.
Card-with-no-promo still pays inline at registration.

### How it works

| Path | What the registrant gets |
|---|---|
| Card, no promo | Pays inline via Fluent Forms Square at registration |
| Card + promo code | Form steers to Pay Later → email has a Square link for the discounted balance |
| Pay Later (any) | Confirmation + reminder emails include a Square "Pay by Card Now" button |

Implementation: `gas/SquarePayments.gs` (`createSquarePaymentLink_`,
`squarePaymentInfoForRegistration_`, `squarePayButtonHtml_`), wired into
`gas/Email.gs` (confirmation, unpaid branch) and `gas/Reminders.gs`. The charged
amount includes the card processing fee per the Config `SQUARE_FEE_*` keys, so
it's consistent with the inline and on-site Square paths.

### What you must set (GAS Script Properties)

Add these in the Apps Script editor → **Project Settings → Script properties**
(secrets live here, never in the Config sheet or the repo):

| Key | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | Square access token (must match the environment below) |
| `SQUARE_LOCATION_ID` | The Square location to attribute payments to |
| `SQUARE_ENVIRONMENT` | `sandbox` while testing, `production` when live (defaults to `production`) |

If these are unset, link creation is **skipped gracefully** — emails fall back to
the edit/manage link and "mail a check" wording, so nothing breaks before you
configure Square.

### Notes / reconciliation

- The link uses Square's **quick-pay** Payment Links API. A stable idempotency key
  (registration ID + amount) means re-sending a reminder reuses the same link
  rather than creating duplicates.
- Marking the registration **paid** is not yet automatic for these links. Either
  record the payment in the PWA after it lands, or (future enhancement) add a
  Square **webhook** to flip status automatically. Until then, reconcile from the
  Square dashboard.
- Test with **sandbox** credentials first: register a pay-later (or card+promo)
  entry, open the email, confirm the button charges the correct discounted amount
  on Square's hosted page.
