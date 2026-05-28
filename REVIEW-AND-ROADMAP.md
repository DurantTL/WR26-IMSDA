# WR26 / IMSDA Registration — Review, Function Map & Hardening Roadmap

**Date:** 2026-05-28
**Scope:** Fluent Forms form, WordPress plugin layer, Google Apps Script (GAS)
backend, and the staff PWA — reviewed end to end.

This document is the living companion to `AUDIT-REPORT.md`. The earlier audit
verified individual bug fixes; this one steps back to the **architecture and
end-to-end flow**, records the canonical-path decisions, and tracks the
hardening work.

---

## 1. Architecture decision (canonical path)

The repo currently contains **two of several things**, with docs pointing in
different directions. The decisions below resolve that.

| Layer | Canonical (use this) | De-emphasized (future/experimental) |
|---|---|---|
| Intake plugin | `plugin/wr26-registration.php` (+ `wr26-registration-portal.php`) — **Option A** | `imsda-registration-engine/` (multi-event; keep parked) |
| Staff app (PWA) | `pwa-server/` (full search/edit/pay/check-in/QR/offline) | `imsda-registration-engine/pwa/imsda-checkin.html` (check-in only) |
| Registration form | `form/wr26-registration-fluentforms.smart-payments.json` | base `…-fluentforms.json` (no payment item — generator input only) |
| Backend | `gas/*.gs` (single source of truth — shared by all of the above) | — |

**Why Option A:** the legacy WR26 plugin is the lower-risk production base for
the 2026 event and, on review, is already healthy — it parses all four seminar
sessions and attendee types, sends correct camelCase keys to GAS, gates the
admin script enqueue, ships a real token-based edit form, and handles Square via
Fluent Forms' native `fluentform_payment_success/_failed` hooks. The IMSDA
engine's blocking bugs are genuinely fixed in code too, but it stays parked until
there is a need for multi-event support.

**Payment model:** **server-authoritative.** The form still charges via Square,
but GAS recomputes the owed amount from the Config sheet and the `PromoCodes`
sheet and owns the recorded balance. The form's client-side calculation is a
display/charge convenience only; drift is *flagged* by GAS, not silently charged.

---

## 2. End-to-end function map

```
Registrant → Fluent Forms (smart-payments.json)
  ├─ Pay Later  → fluentform/submission_inserted ──┐
  └─ Square     → fluentform_payment_success ──────┤
                                                    ▼
        wr26_queue_entry()              plugin/wr26-registration.php:115
                                                    ▼  (WP cron, every 5 min)
        wr26_process_dispatch_queue() :317 → wr26_build_and_send() :283
                                                    ▼  HTTPS POST {secret, ...}
        GAS doPost() router             gas/Code.gs:2  → handleRegister / handleWaitlist
                                                    ▼
        Google Sheets  (Registrations / Attendees / SeminarPreferences / Waitlist / …)
                                                    ▲  cached snapshot (60s)
        portalGetCacheSnapshot (gas/PwaSync.gs) ◄── pwa-server/server.js
                                                    ▼
        Staff PWA (pwa-server/public/app.js): search, edit, pay, check-in, QR,
        magic-link, offline queue (localStorage `imsda_registration_queue`)
```

Staff/admin write paths reuse `wr26_gas_request()` (`wr26-registration.php:415`)
→ the same GAS router actions (`recordPayment`, `checkinById`,
`adminEditRegistration`, `getPromoCodes`, …).

**GAS response shapes** are flat and consumed directly by the plugin/PWA, e.g.
`{success, registrations:[…]}`, `{success, waitlist:[…]}`,
`{success, rosters:[…]}`, `{success, promoCodes:[…]}`,
`{success, stats:{…}, byChurch:[…]}`. Keep these stable when editing GAS.

---

## 3. Findings & status (canonical path)

### P0 — correctness / data integrity
| # | Finding | Status |
|---|---|---|
| 1 | **No lock around capacity-check + write** in `handleRegister` / `promoteWaitlist` → concurrent submissions could exceed `CAPACITY`. | **Fixed** — `withScriptLock_()` (`gas/Utils.gs`) wraps the dup-check + capacity + write critical sections. Promo counter already locked in `validateAndApplyPromoCode`. |
| 2 | **Silent email failures** on blank/invalid address (`MailApp.sendEmail({to:''})` throws; magic-link returned success anyway). | **Fixed** — `isValidEmail_()` + `sendEmailSafe_()` (`gas/Utils.gs`); all sends in `Email.gs`/`Portal.gs` routed through it; registration is never aborted by an email error and a warning is surfaced in `register`'s `warnings[]`. |
| 3 | **Payment not server-authoritative** — form's hardcoded JS decided the charge; GAS trusted it. | **Fixed** — `handleRegister` now computes the owed amount from Config pricing × attendee count (`resolveRegistrationAmount(…, preferConfig=true)`); for paid registrations it records the actual charge and writes a `[reconcile]` note to `adminNotes` when it differs from the expected base. |

### P1 — important
| # | Finding | Status |
|---|---|---|
| 4 | Base form lacks a chargeable payment item → Square can't charge. | **Fixed** — `smart-payments.json` is the canonical form (has the payment item + `a1_*` fields); validator passes. |
| 5 | Form pricing/promo hardcoded in JS, can drift. | **Mitigated** — GAS is now authoritative and flags drift; generator constants documented as "must match GAS Config" (`tools/patch-wr26-form-smart-payments.js`). `attendee_count` is a fixed 1–5 dropdown, so no numeric min/max is needed. |
| 6 | Attendee/seminar writes silently no-op if the tab is missing. | **Fixed** — warnings now surfaced through `handleRegister`'s response `warnings[]`. |
| 7 | On-site partial payment marked fully paid; owed amount overwritten. | **Fixed** — `recordPayment` now records `amountPaid`, preserves the owed `finalAmount`, and sets `partial_onsite` vs `paid_onsite` with a balance note. |

### P2 — docs / consistency
| # | Finding | Status |
|---|---|---|
| 8 | Engine README listed long-fixed bugs as "open"; audit summary table all zeros; canonical paths unstated. | **Fixed** — `imsda-registration-engine/README.md` marked future/experimental; `AUDIT-REPORT.md` table/preamble corrected; `README.md` states the canonical plugin/PWA/form. |

### P3 — defense-in-depth / future (not yet built)
- **GAS:** rate-limit public portal actions (`portalRequestMagicLink`); optional
  IP check on magic-link redemption; TTL on the in-execution Config cache;
  lightweight `AuditLog` sheet for admin edits/payments.
- **PWA:** schema-validate POST bodies; rate-limit non-login endpoints;
  server-side session revocation on logout; fail fast if `SESSION_SECRET` unset;
  consider a persistent cache store so a server restart doesn't drop edits.
- **Engine:** if ever promoted to canonical, re-verify the token-edit path
  forwards attendees/seminars (today it forwards contact fields only).
- **Cleanup:** formally deprecate `imsda-registration-engine/pwa/imsda-checkin.html`.

---

## 4. Verification

- **GAS (Apps Script editor):** run `wr26SetupCheck()`; exercise `handleRegister`
  with (a) a blank email → row still written + warning returned, (b) an
  early-bird vs after-deadline date to confirm the Config-computed `finalAmount`,
  (c) a `payment_status:'paid'` payload whose `amount_paid` differs from the
  expected base → confirm the `[reconcile]` note; record a short on-site payment
  and confirm `partial_onsite`.
- **Form:** `node tools/validate-wr26-form-json.js form/wr26-registration-fluentforms.smart-payments.json` → PASS.
- **Plugin → GAS:** submit a Pay-Later and a Square test entry; confirm
  `Registrations` / `Attendees` / `SeminarPreferences` rows and that Final Amount
  / Payment Status reflect the GAS recompute.
- **PWA:** `cd pwa-server && npm install && npm start`; sign in; verify cache,
  search, a payment record, a check-in, and the offline queue + sync.
