# IMSDA Women's Retreat 2026 — Registration Platform

> **Indiana–Michigan State Dorcas Association** · "Rooted & Rising" Women's Retreat
> A self-hosted, installable Progressive Web App (PWA) for event registration, payments, seminar sign-up, check-in, and administration.

---

## 📑 Table of Contents

1. [Overview](#overview)
2. [Event Facts](#event-facts)
3. [Feature Status](#feature-status)
4. [Architecture](#architecture)
5. [Repository Layout](#repository-layout)
6. [Quick Start](#quick-start)
7. [Configuration](#configuration)
8. [Deployment](#deployment)
9. [Registration Flow](#registration-flow)
10. [Attendee Management](#attendee-management)
11. [Seminars / Breakouts](#seminars--breakouts)
12. [Admin & Check-in](#admin--check-in)
13. [Data & Privacy](#data--privacy)
14. [Roadmap](#roadmap)
15. [License](#license)

---

## Overview

The IMSDA Women's Retreat platform is a lightweight, **self-hosted registration engine** built as a Progressive Web App. It handles the full lifecycle of event participation:

- Public registration with multiple attendees per submission, each with their own phone, meal preference, and seminar choices
- Early-bird / regular pricing, promo codes (half off early bird), and **pay-later by default**
- A self-service registrant portal (magic-link access) for editing attendees and moving/swapping registrations
- An admin dashboard for the roster, church groupings, notes, refunds, and seminar capacity
- On-site QR check-in that shows the balance owed and supports collecting card payment via the Square app
- Installable PWA with offline support

This repository contains several deployable components (see [Repository Layout](#repository-layout)) but the **primary, recommended deployment** is the `imsda-registration-engine/` Node.js service.

The authoritative business requirements live in [`IMPORTANT-INSTURCTIONS.txt`](IMPORTANT-INSTURCTIONS.txt); the detailed gap analysis lives in [`AUDIT-REPORT.md`](AUDIT-REPORT.md); the phased delivery plan lives in [`REVIEW-AND-ROADMAP.md`](REVIEW-AND-ROADMAP.md).

---

## Event Facts

| Item | Value |
|------|-------|
| Event | IMSDA Women's Retreat 2026 — "Rooted & Rising" |
| Host | Indiana–Michigan State Dorcas Association |
| Open Camp Meeting | Wednesday, June 3, 2026 |
| Early-bird price | **$120** (ends **August 14, 2026**) |
| Regular price | **$140** (ends **September 17, 2026**) |
| Promo codes | **Half off the early-bird price** |
| Worker registration | Non-paying attendees register via a separate Google Form |
| Meals | **No boxed dinners** |
| Childcare | Provided only if enough children register; otherwise no dedicated program |
| Shirts | Optional — may not be offered |

Pricing and date constants are defined in `imsda-registration-engine/server.js`
(`EARLY_BIRD_PRICE`, `REGULAR_PRICE`, `EARLY_BIRD_END`, `REGULAR_END`).

---

## Feature Status

Legend: ✅ working · ⚠️ partial · ❌ planned (see [Roadmap](#roadmap)).
Current state as of 2026-05-29 — see [`AUDIT-REPORT.md`](AUDIT-REPORT.md) for details.

### Registration
- ✅ Multi-attendee registration in a single submission
- ✅ Early-bird / regular pricing (automatic, date-driven)
- ⚠️ Promo codes — needs explicit **half-off-early-bird** rule + tests
- ⚠️ Per-attendee details — name/email present; **phone, meal preference, seminar choices** being added per attendee
- ⚠️ Loading + confirmation messaging during submit; **big "check your email" reminder** to add

### Payments
- ⚠️ Pay now / pay later — flip the **default to pay-later**
- ⚠️ Square card payments
- ⚠️ Pay-later email with an embedded **payment link/option**
- ❌ Pending-charge reminder email ("did you forget?")
- ⚠️ Refund tracking — field exists; no workflow yet

### Attendee Management
- ⚠️ Edit attendees after registration (admin only today → add self-service)
- ❌ Move / swap a registration so one person **takes another's place**, keeping the **original record + "taking place of" linkage**
- ✅ Private admin notes ("keep info safe")
- ⚠️ Church roster — data exists; needs a dedicated per-church individual view

### Seminars / Breakouts
- ❌ Seminar registration: **8 breakouts across 4 time slots** with **ranked preferences** and graceful "full" handling

### Communications
- ⚠️ Email via Google (SMTP scaffold; templates needed)
- ✅ Confirmation flow exists → add big email reminder + loading state
- ❌ Pending-charge reminder emails

### Check-in
- ✅ QR-code check-in
- ⚠️ Show **amount owed** at check-in and support the **Square app** for card payment

### Other
- ❌ Childcare opt-in (conditional program)
- ❌ T-shirt opt-in (optional)
- ❌ Worker (non-paying) registration via Google Form

### Technical
- ✅ Installable PWA, offline support (service worker + manifest)
- ✅ Self-hosted; JSON file storage

---

## Architecture

```
        ┌──────────────────────────────────────────────┐
        │            Browser / Installed PWA            │
        │  index.html · portal.html · admin.html ·      │
        │  checkin.html · app.js · sw.js · manifest.json│
        └───────────────────────┬──────────────────────┘
                                 │ HTTPS / JSON
                                 ▼
        ┌──────────────────────────────────────────────┐
        │     imsda-registration-engine (Express)       │
        │  REST API · pricing · promos · magic links ·  │
        │  QR check-in · CSV export                      │
        └───────┬───────────────┬──────────────┬────────┘
                │               │              │
                ▼               ▼              ▼
        JSON data store   Square API    Google SMTP (email)
        (registrations,   (card pay)    (confirmations,
         promos)                         reminders)
```

Optional/alternate components: a WordPress plugin (`plugin/`) that embeds the
form via shortcode (see [`OPTION-A-LEGACY-PORTAL.md`](OPTION-A-LEGACY-PORTAL.md)),
Google Apps Script backends (`gas/`, `form/`), and a minimal static shell server
(`pwa-server/`).

---

## Repository Layout

```
WR26-IMSDA/
├── imsda-registration-engine/   # ⭐ Primary PWA + API (Node.js/Express)
│   ├── server.js                #    REST API, pricing, promos, check-in
│   ├── public/                  #    index, portal, admin, checkin, app.js, sw.js, manifest
│   ├── data/churches.json       #    seed church list
│   └── tools/seed.js            #    data seeding
├── pwa-server/                  # Minimal static PWA shell server (smoke test)
├── gas/                         # Google Apps Script backend (legacy/alt)
├── form/                        # Google Form integration script (worker reg)
├── plugin/                      # WordPress plugin (legacy/alt embed)
├── tools/                       # Utility scripts (seed, etc.)
├── docker-compose.yml           # One-command deployment (port 3001)
├── IMPORTANT-INSTURCTIONS.txt   # Authoritative business requirements
├── AUDIT-REPORT.md              # Current-state gap analysis
└── REVIEW-AND-ROADMAP.md        # Phased delivery plan
```

Component READMEs:
- [`imsda-registration-engine/README.md`](imsda-registration-engine/README.md)
- [`pwa-server/README.md`](pwa-server/README.md)

---

## Quick Start

```bash
cd imsda-registration-engine
npm install
npm start
```

Visit `http://localhost:3001`.

---

## Configuration

Environment variables (full list in
[`imsda-registration-engine/README.md`](imsda-registration-engine/README.md)):

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default 3001) |
| `ADMIN_PASSWORD` | Admin dashboard password |
| `DATA_DIR` | JSON data storage directory |
| `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` | Square API credentials for card payments |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Google SMTP for confirmation & reminder emails |

---

## Deployment

Recommended deployment is via Docker Compose:

```bash
docker compose up -d
```

This builds and runs the `imsda-registration-engine` on port 3001.

---

## Registration Flow

1. Attendee visits the site (installable PWA).
2. Chooses how many attendees to register.
3. Enters per-attendee details — name, email, **phone, meal preference, seminar preferences (ranked)**.
4. Applies a promo code (optional; half off early bird).
5. Chooses **Pay Later (default)** or Pay Now (Square).
6. Sees a loading/confirmation message, then a **large reminder to check email**.
7. Receives a confirmation email with a QR code (and, for pay-later, a payment link).

---

## Attendee Management

Through the admin dashboard and the magic-link registrant portal:

- **Edit** any attendee's details after registration.
- **Move / swap** a registration so one person takes another's place — the
  **original registration is retained** and a "taking place of" linkage records
  who replaced whom.
- **Refunds** are recorded when a spot is given up or a registration is cancelled.
- **Private notes** can be attached to a registration to keep sensitive info safe.
- **Church roster** view lists each church's individual attendees.

---

## Seminars / Breakouts

Eight breakout sessions run across four time slots:

| Time slot | Options |
|-----------|---------|
| Friday 4:00–5:00 PM | 2 |
| Saturday 2:00–3:15 PM | 3 |
| Saturday 3:30–4:45 PM | 2 |
| Sunday 8:15–9:15 AM | 1 |

Each attendee **ranks preferences** per slot. Seminars have capacity; when one
fills, the system assigns the next-ranked choice — a full seminar is handled
gracefully, not as an error.

---

## Admin & Check-in

- Admin dashboard at `/admin.html` — roster, church groupings, notes, refunds,
  seminar capacity, CSV export.
- Check-in at `/checkin.html` — QR scan or search by name; shows the **balance
  owed** so staff can collect card payment via the **Square app**.

---

## Data & Privacy

Registration data is stored server-side as JSON in `DATA_DIR`. Private notes and
attendee contact details are visible only behind the admin password / magic-link
portal. See component READMEs for storage details.

---

## Roadmap

See [`REVIEW-AND-ROADMAP.md`](REVIEW-AND-ROADMAP.md) for the phased plan. In short:

1. **Core correctness** — pay-later default, half-off-early-bird promo, per-attendee phone/meal validation.
2. **Seminars** — 8 breakouts / 4 slots with ranked preferences and capacity.
3. **Attendee management** — self-service editing, move/swap with original-record linkage, refunds workflow, church roster view.
4. **Communications** — Google email confirmations, pay-later payment link, pending-charge reminders, big email reminder + loading state.
5. **Check-in & payments** — show balance owed, Square app collection.
6. **Polish** — childcare opt-in, optional shirts, worker (non-paying) Google Form.

---

## License

Proprietary — IMSDA internal use.
