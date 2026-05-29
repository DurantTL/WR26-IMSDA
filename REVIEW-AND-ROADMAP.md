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

### P3 — defense-in-depth / hardening (done — go-live pass)
| Item | Status |
|---|---|
| GAS: per-email cooldown on `portalRequestMagicLink` (`MAGIC_LINK_COOLDOWN_SECONDS`). | **Done** |
| GAS: optional IP binding on magic-link redemption (`MAGIC_LINK_ENFORCE_IP`, default off). | **Done** |
| GAS: TTL (30 s) on the in-execution Config cache. | **Done** |
| GAS: `AuditLog` sheet + best-effort `logAudit_()` on admin edits, payments, check-ins, transfers, waitlist promote/remove, token/portal edits. | **Done** |
| PWA: input validation on all write endpoints (amount/method, attendee counts, required IDs, tokens, email). | **Done** |
| PWA: per-IP rate limiting on reads/writes/magic-link (login already limited). | **Done** |
| PWA: server-side session revocation on logout (`jti` + in-memory revoked set). | **Done** |
| PWA: fail fast if `SESSION_SECRET` unset in production; `trust proxy` for correct client IP. | **Done** |
| Cleanup: `imsda-registration-engine/pwa/imsda-checkin.html` marked deprecated. | **Done** |

Still intentionally deferred (low value for this event):
- **Engine:** if ever promoted to canonical, re-verify the token-edit path forwards
  attendees/seminars (today it forwards contact fields only).
- **PWA persistent cache:** the in-memory cache re-syncs from GAS within seconds of
  a restart and the offline queue is client-side, so a persistent store is optional.

---

## 5. Go-live checklist (next week)

**Google Sheet / GAS**
- [ ] Push all `gas/*.gs`; run `wr26EnsureSheetSetup()` then `wr26SetupCheck()` (creates/checks the new **AuditLog** tab and `MAGIC_LINK_*` Config rows).
- [ ] Confirm Config: `SECRET`, prices, `*_END_DATE`, `CAPACITY`, `CHECKIN_PIN`/`CHECKIN_TOKEN`, `NOTIFICATION_EMAIL`.
- [ ] Deploy the Web App (Execute as Me; Anyone, even anonymous) and copy the URL.

**WordPress (Option A)**
- [ ] `plugin/wr26-registration.php` active; WR26 → Settings has GAS URL, Fluent Form ID, Edit Page URL; WP secret copied to Config `SECRET`.
- [ ] Import `form/wr26-registration-fluentforms.smart-payments.json`; in the Fluent Forms editor confirm the notification trigger is **form submission** (not payment_success) so Pay-Later registrants are emailed.
- [ ] Submit a Pay-Later test and a Square test; confirm `Registrations`/`Attendees`/`SeminarPreferences` rows and that Final Amount/Payment Status reflect the GAS recompute.

**PWA server**
- [ ] Set env incl. `NODE_ENV=production`, a strong `SESSION_SECRET`, `WR26_GAS_URL`/`WR26_GAS_SECRET`, `WR26_AUTH_USERS` (bcrypt), and `TRUST_PROXY` for your proxy.
- [ ] Serve over HTTPS (scanner requires it); sign in, verify cache, a payment, a check-in, QR scan, and offline queue + sync.

**Final**
- [ ] Spot-check the `AuditLog` tab populates after a test admin edit/payment/check-in.
- [ ] Confirm `node tools/validate-wr26-form-json.js form/wr26-registration-fluentforms.smart-payments.json` passes.

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

---

## 6. WR26 general-ideas feature build-out

Status of the WR26 planning requests on the canonical Option A stack
(Fluent Forms → `plugin/wr26-registration.php` → `gas/*.gs` + Sheets →
`pwa-server/` staff app + magic-link portal). ✅ done · ⚠️ needs live UAT only.

### Already in place before this pass (verified by review)
- ✅ Per-attendee phone / meal preference / ranked seminar prefs (all 4 sessions).
- ✅ Edit attendees after registration — staff app + magic-link registrant portal.
- ✅ Promo codes incl. half-off early bird (`PromoCodes`; GAS server-authoritative).
- ✅ Private notes (`Admin Notes`) + full `AuditLog`.
- ✅ QR check-in with offline queue.
- ✅ Pay-Later **default** in the Fluent Form (`default_payment: offline`).
- ✅ Big "check your email" confirmation message + payment-link mention + loading note.
- ✅ Childcare capture + conditional message; worker (non-paying) Google Form URL.
- ✅ Pricing $120/$140 and date cutoffs in Config.

### Built in this pass
- ✅ **Refunds** — `Refunds` sheet + `recordRefund`; staff Refund panel; sets
  `refunded`/`partial_refund`, dated note, audited. (`gas/Refunds.gs`,
  `/api/refund`.)
- ✅ **Transfer / "taking place of"** surfaced in the staff app — Transfer/Swap
  panel creates the replacement registration while keeping the original and the
  linkage (`TransferLog`, original kept as `transferred`). (`/api/transfer`.)
- ✅ **Seminar assignment & capacity** — `Seminars` sheet (8 breakouts / 4 slots,
  per-breakout capacity), rank-honoring assignment engine with graceful "full"
  handling, preview + run, fill summary, seminar roster. (`gas/Seminars.gs`,
  `/api/seminars*`.)
- ✅ **Pending-charge reminders** — on-demand emails to pay-later registrants who
  still owe, with a "preview who owes" dry-run. (`gas/Reminders.gs`,
  `/api/reminders/pending-charges`.)
- ✅ **Church roster** — printable per-church individual list in the staff app
  (`/api/church-rosters`).
- ✅ **Check-in balance** — shows amount owed and the Square card total
  (base + 2.9% + $0.30) so staff can collect in the Square app.
- ✅ **Registrant portal** now shows balance due / paid-in-full.

### Remaining (live UAT — cannot be exercised without a deployed GAS + Sheet)
1. Run `wr26EnsureSheetSetup()` to create the new `Refunds` and `Seminars` tabs,
   then `wr26SetupCheck()`.
2. Populate the `Seminars` sheet with the 8 breakout titles + capacities (or via
   the staff Tools tab), then run a dry-run and a real assignment.
3. Smoke-test refund, transfer, reminder, and check-in-balance flows end to end
   against live data; confirm `AuditLog` rows appear.
