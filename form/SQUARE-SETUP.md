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

## Part 2 — Pay-later card payments (decision needed)

Today, **Pay Later collects no card.** The registrant gets status
`pending_pay_later`, and the portal/email tells them to pay online or mail a
check (`pwa-server/public/portal.js`). There is **no online card capture in the
PWA** — there is no Square SDK, access token, or payments endpoint anywhere in
GAS or the PWA (only the `SQUARE_FEE_*` fee config). So letting pay-later people
pay by card later requires one of two approaches:

### Option A — Square hosted Payment Link in the email (recommended)

Put a **Square-hosted Checkout / Payment Link** in the confirmation and
payment-reminder emails. Square's own page collects the card; the result is
recorded back to the sheet (manually or via a Square webhook). Nothing in your
PWA touches a card, so your servers stay out of PCI scope.

- Effort: low — mostly Square dashboard config + a small change to the GAS email
  templates (`gas/Email.gs`, `gas/Reminders.gs`) to include the link.
- This matches the current architecture (all card charging stays on Square's
  surfaces).

### Option B — "Pay by card" button built into the public PWA portal

Add card capture to `/portal/` using Square's **Web Payments SDK** (tokenizes the
card in the browser) plus a **new PWA server endpoint** that calls the Square
**Payments API** with a Square access token in the server env, then reconciles
the result back to the sheet (ideally via a Square webhook).

- Effort: significant, net-new build. Brings the PWA server into **PCI SAQ-A**
  scope and requires Square credentials + webhook handling.
- Choose this only if an in-portal "Pay now" button is a hard requirement.

> Tell the team which option you want and that piece can be built next. Until
> then, Part 1 (at-registration card payments) is fully functional once the
> Square account is connected in WordPress.
