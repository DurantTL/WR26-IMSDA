# IMSDA Registration Engine — Review & Roadmap

_Last updated: 2026-05-29_

## Summary

This document captures the current state of the IMSDA Women's Retreat 2026
registration platform and the prioritized plan toward a production-ready release.

- **Requirements (authoritative):** [`IMPORTANT-INSTURCTIONS.txt`](IMPORTANT-INSTURCTIONS.txt)
- **Gap analysis:** [`AUDIT-REPORT.md`](AUDIT-REPORT.md)
- **Primary deployment:** [`imsda-registration-engine/`](imsda-registration-engine/README.md)

## Current State

The `imsda-registration-engine` is a functional MVP. Working today: multi-attendee
registration, early-bird/regular pricing, promo validation, magic-link registrant
portal, admin dashboard, private notes, QR check-in, and PWA install/offline.

Partial or missing: per-attendee phone/meal/seminar data, pay-later default,
half-off-early-bird promo rule, seminar registration, attendee move/swap, refunds
workflow, church roster view, Google email confirmations + pay-later link +
pending-charge reminders, check-in balance/Square collection, childcare, shirts,
and worker registration.

## Goal

Make the PWA fully able to **edit attendees, add details to them, and move their
registrations** — alongside seminar sign-up, pay-later-by-default, Google email,
and QR check-in with balance collection.

## Roadmap

Each phase is independently shippable. Tasks marked ✅ exist, ⚠️ partial, ❌ new.

### Phase 1 — Core correctness & data model
- ⚠️ Add per-attendee fields: **phone**, **meal preference**, seminar preferences.
- ⚠️ Make **Pay Later the default** payment method (UI + server default).
- ⚠️ Promo codes = **half off the early-bird price**; make rule explicit + tested.
- ⚠️ Per-attendee validation (required phone, valid email, meal selected).
- ❌ Extend the registration data model (see engine README "Data Model (target)").

### Phase 2 — Seminars / breakouts
- ❌ Define 8 breakouts across 4 slots (Fri 1×2, Sat 2×3 + 3:30×2, Sun 1×1).
- ❌ Per-attendee **ranked preferences** per slot.
- ❌ Per-seminar **capacity** + assignment by rank; graceful "full" handling.
- ❌ Show assignments in confirmation, portal, admin, and check-in views.

### Phase 3 — Attendee management (the core ask)
- ⚠️ **Edit attendees** after registration (admin + self-service portal).
- ❌ **Move / swap** a registration: one person takes another's place, keeping the
  **original registration record** and a **"taking place of"** linkage.
- ⚠️ **Refunds** workflow (record amount, reason, link to replacement).
- ✅ Private **notes** (keep info safe) — extend coverage to portal.
- ⚠️ **Church roster** — dedicated per-church individual list view.

### Phase 4 — Communications (Google email)
- ⚠️ Google SMTP **confirmation email** with QR code.
- ❌ **Pay-later** email includes a **payment link/option**.
- ❌ **Pending-charge reminder** email ("did you forget the following?").
- ⚠️ In-app **loading + confirmation** state on submit.
- ⚠️ **Large reminder** to check email after registering.

### Phase 5 — Check-in & payments
- ✅ QR check-in.
- ⚠️ Show **amount owed** at check-in.
- ⚠️ Support **Square app** card collection (show amount incl. card fee).

### Phase 6 — Polish / optional
- ❌ **Childcare** opt-in (conditional program if enough children).
- ❌ **Shirts** opt-in (optional — may be removed).
- ❌ **Worker registration** for non-paying attendees via a separate Google Form
  (see `form/`).
- Confirm: **no boxed dinners**; Open Camp Meeting Wed June 3.

## License

Proprietary — IMSDA internal use.
