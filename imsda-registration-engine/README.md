# IMSDA Registration Engine

A self-contained Node.js + Express registration engine for the **IMSDA Women's
Retreat 2026** ("Rooted & Rising"), packaged as an installable Progressive Web
App. This is the primary, recommended deployment for the platform.

> Business requirements: [`../IMPORTANT-INSTURCTIONS.txt`](../IMPORTANT-INSTURCTIONS.txt)
> · Current-state audit: [`../AUDIT-REPORT.md`](../AUDIT-REPORT.md)
> · Delivery plan: [`../REVIEW-AND-ROADMAP.md`](../REVIEW-AND-ROADMAP.md)

## Features

Legend: ✅ working · ⚠️ partial · ❌ planned.

- ✅ Multi-attendee registration in a single submission
- ✅ Early-bird ($120) / regular ($140) pricing, switched automatically by date
- ⚠️ Promo codes — half off the early-bird price (rule being made explicit)
- ⚠️ Per-attendee details — name, email, **phone, meal preference, seminar choices**
- ⚠️ Pay Now (Square) or **Pay Later (becoming the default)**
- ✅ Registrant self-service portal via magic link
- ⚠️ Edit attendees; ❌ move/swap a registration keeping the original record + "taking place of" linkage
- ⚠️ Refund tracking
- ✅ Private admin notes
- ⚠️ Church roster (per-church individual view in progress)
- ❌ Seminar/breakout registration: 8 breakouts, 4 time slots, ranked preferences, capacity
- ⚠️ Email confirmations via Google SMTP; ❌ pay-later payment link + pending-charge reminders
- ✅ QR-code check-in; ⚠️ show balance owed + Square-app card collection
- ❌ Childcare opt-in · ❌ optional shirts · ❌ worker (non-paying) Google Form
- ✅ Installable PWA with offline support

## Requirements

- Node.js 18+

## Quick Start

```bash
npm install
npm start
```

Server runs on port 3001 by default (configurable via `PORT`). Then open:

- `/` — public registration (PWA)
- `/portal.html` — registrant self-service portal (magic link)
- `/admin.html` — admin dashboard
- `/checkin.html` — on-site QR check-in

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `ADMIN_PASSWORD` | `changeme` | Admin dashboard password |
| `DATA_DIR` | `./data` | Directory for JSON data storage |
| `SQUARE_ACCESS_TOKEN` | — | Square API access token (card payments) |
| `SQUARE_LOCATION_ID` | — | Square location ID |
| `SMTP_HOST` | — | Google SMTP server for emails |
| `SMTP_PORT` | — | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |

## Pricing & Dates

Defined as constants at the top of `server.js`:

| Constant | Value |
|----------|-------|
| `EARLY_BIRD_PRICE` | `12000` (cents = $120) |
| `REGULAR_PRICE` | `14000` (cents = $140) |
| `EARLY_BIRD_END` | `2026-08-14` |
| `REGULAR_END` | `2026-09-17` |
| `CARD_FEE_RATE` / `CARD_FEE_FIXED` | `0.029` / `30` (Square card fee) |

Promo codes apply **half off the early-bird price**.

## Data Storage

Registrations and promos are stored as JSON files in `DATA_DIR`
(`registrations.json`, `promos.json`). Each registration record holds its
attendees, pricing, payment status/method, check-in state, notes, and (planned)
seminar selections and swap/replacement linkage. Seed data for churches lives in
`data/churches.json` (see `tools/seed.js`).

## Data Model (target)

A registration aims to carry:

- `id`, `createdAt`, `church`
- `payment`: `{ method: 'later' | 'now', status, amountDueCents, refunds[] }`
- `attendees[]`: `{ name, email, phone, mealPreference, seminarPrefs{ slot: rankedOptionIds[] }, assignedSeminars{ slot: optionId }, childcare?, shirtSize?, checkedInAt }`
- `notes[]` (private, admin-only)
- `replacement`: `{ originalRegistrationId, originalAttendee, takingPlaceOf }` when a spot is transferred

## API Endpoints

Current/representative routes (see `server.js` for the authoritative list):

- `POST /api/register` — create a registration
- `GET  /api/registrations` — list registrations (admin)
- `POST /api/checkin` — check in an attendee
- `POST /api/promo/validate` — validate a promo code

Planned additions: attendee edit, swap/move, refund, seminar capacity, and
reminder-email endpoints (see roadmap).

## Seminars / Breakouts (planned)

Eight breakouts across four time slots — Fri 4:00–5:00 PM (2 options),
Sat 2:00–3:15 PM (3 options), Sat 3:30–4:45 PM (2 options), Sun 8:15–9:15 AM
(1 option). Attendees rank preferences per slot; assignment honors rank and
respects per-seminar capacity, with graceful handling when a seminar is full.

## License

Proprietary — IMSDA internal use.
