# IMSDA Registration PWA Server

This is the CM26-style custom staff app layer for WR26.

The user-facing PWA name is **IMSDA Registration**. The repo/folder can remain WR26-specific, but the browser title, install name, manifest name, and header are generic enough for broader IMSDA registration/check-in work.

The PWA keeps Google Sheets + GAS as the source of truth, but adds a separate Node/Express app that:

- pulls a full cache snapshot from GAS,
- keeps registrations, attendees, seminar preferences, waitlist, stats, and payment data in server memory,
- serves fast same-origin `/api/*` routes to the browser,
- hides the GAS URL and GAS secret from staff browsers,
- provides a mobile-first registration manager UI similar to CM26 check-in,
- supports QR scanning,
- supports offline queueing for check-in and payment actions,
- writes edits, payments, check-ins, and magic-link requests back through GAS,
- refreshes the local cache after successful writes.

---

## Architecture

```text
Fluent Forms / legacy WR26 plugin
        ↓
Google Apps Script + Google Sheets
        ↓
IMSDA Registration cached PWA server
        ↓
Custom mobile/desktop PWA UI
```

This does **not** replace `plugin/wr26-registration.php`. The legacy plugin should still handle registration intake from Fluent Forms.

---

## Files

```text
pwa-server/
  Dockerfile
  .dockerignore
  package.json
  server.js
  public/
    index.html
    app.js
    styles.css
    manifest.json
```

---

## Required GAS support

The app depends on these GAS files/actions:

```text
gas/PwaSync.gs
gas/Portal.gs
gas/Code.gs route for portalGetCacheSnapshot
gas/Code.gs route for portalAdminSaveRegistration
gas/Code.gs route for recordPayment
gas/Code.gs route for checkinById
gas/Code.gs route for portalRequestMagicLink
```

Push/copy the updated GAS files into Apps Script, then redeploy the Web App.

Required GAS actions used by the PWA server:

```text
portalGetCacheSnapshot
portalAdminSaveRegistration
recordPayment
checkinById
portalRequestMagicLink
portalGetRegistrationByMagicToken
portalSaveRegistrationByMagicToken
```

---

## Environment variables

```bash
NODE_ENV=production
PORT=3001
WR26_GAS_URL=https://script.google.com/macros/s/...../exec
WR26_GAS_SECRET=your_config_sheet_SECRET_value
SESSION_SECRET=replace-with-long-random-string
PWA_SYNC_INTERVAL_MS=60000
SYNC_MIN_REGISTRATIONS=1
TRUST_PROXY=1
WR26_AUTH_USERS='[{"username":"registrar","password":"$2b$10$...bcrypt...","roles":["registrar","payments","checkin"]}]'
```

Notes:

- `WR26_GAS_SECRET` must match Config tab `SECRET`.
- `SESSION_SECRET` should be long and random. **Required in production** — with `NODE_ENV=production` the server refuses to start without it (an ephemeral secret would log everyone out on each restart).
- `WR26_AUTH_USERS` must use bcrypt password hashes.
- `SYNC_MIN_REGISTRATIONS` prevents replacing a good cache with a suspiciously empty snapshot.
- `TRUST_PROXY` is the number of proxy hops in front of the app (e.g. `1` behind Cloudflare/Nginx) so per-IP rate limiting and magic-link IP binding see the real client IP. Defaults to `1` in production, `0` in development.

### Hardening built in

- Per-IP rate limiting on login (10 / 15 min), reads (240 / min), writes (60 / min), and magic-link requests (8 / hour).
- Input validation on all write endpoints (payment amount/method, attendee counts, required IDs, magic-link tokens/emails).
- Stateless signed sessions (HMAC-SHA256, HttpOnly + SameSite=Strict + Secure-in-production) with a `jti` and a server-side revocation list so logout immediately invalidates the token.
- The GAS secret is never sent to the browser; the server is the only thing that talks to GAS with it.

Generate bcrypt hashes after `npm install`:

```bash
node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],10).then(console.log)" "your-password"
```

Example `WR26_AUTH_USERS`:

```json
[
  {
    "username": "registrar",
    "password": "$2b$10$REPLACE_WITH_HASH",
    "roles": ["registrar", "payments", "checkin"]
  },
  {
    "username": "viewer",
    "password": "$2b$10$REPLACE_WITH_HASH",
    "roles": ["readonly"]
  }
]
```

---

## Roles

| Role | Access |
|---|---|
| `admin` | All access |
| `registrar` | Search/edit registrations and attendees |
| `payments` | Record payments |
| `checkin` | Check in guests and record check-in payments |
| `readonly` | View/search only |

---

## Local development

```bash
cd pwa-server
npm install
npm start
```

Open the staff PWA:

```text
http://localhost:3001/app/
```

Open the registrant self-service portal:

```text
http://localhost:3001/portal/
```

Health check:

```text
http://localhost:3001/health
```

The camera scanner generally requires HTTPS on phones. Localhost is acceptable for desktop development, but production check-in devices should use HTTPS.

---

## Production deployment notes

The app is a standard Node/Express server. Put it behind HTTPS using your preferred deployment method, such as:

- reverse proxy,
- Cloudflare Tunnel,
- Portainer/Docker stack with HTTPS proxy,
- or another Node hosting platform.

Production requirements:

- HTTPS for camera access
- persistent environment variables
- secure `SESSION_SECRET`
- valid `WR26_GAS_URL`
- matching `WR26_GAS_SECRET`
- configured `WR26_AUTH_USERS`


### XCloud Docker Compose deployment

XCloud can deploy this PWA with **Custom Docker → Docker Compose From Git**. Use these settings:

| XCloud setting | Value |
|---|---|
| Compose file name | `docker-compose.yml` |
| Primary service port | `3001` |
| Environment file directory | `pwa-server` |
| Health check | `https://registration.imsda.org/health` |
| App URL | `https://registration.imsda.org/app/` |

Create the environment file in XCloud for the `pwa-server` directory (do not commit real secrets). It must include:

```bash
NODE_ENV=production
PORT=3001
WR26_GAS_URL=https://script.google.com/macros/s/...../exec
WR26_GAS_SECRET=your_config_sheet_SECRET_value
SESSION_SECRET=replace-with-long-random-string
WR26_AUTH_USERS='[{"username":"registrar","password":"$2b$10$...bcrypt...","roles":["registrar","payments","checkin"]}]'
TRUST_PROXY=1
```

The repository root includes `docker-compose.yml`; that Compose file builds `./pwa-server/Dockerfile`, publishes `3001:3001`, and loads runtime configuration from `./pwa-server/.env`. The `.env` file is intentionally ignored and excluded from the Docker build context so secrets are supplied by the deployment environment, not committed to Git.

The staff PWA should open at:

```text
https://registration.imsda.org/app/
```

The XCloud health check should use:

```text
https://registration.imsda.org/health
```

The registrant self-service portal should open at:

```text
https://registration.imsda.org/portal/
```

---

## API routes

### Auth

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
```

### Cache

```text
GET  /api/bootstrap
GET  /api/sync/status
POST /api/sync/refresh
```

### Registration management

```text
GET  /api/registrations?q=...
GET  /api/registration/:id
POST /api/registration/:id
GET  /api/scan/:value
```

### Operations

```text
POST /api/payment
POST /api/refund
POST /api/transfer
POST /api/check-in
POST /api/offline-actions
```

### Seminars, rosters & reminders

```text
GET  /api/seminars
POST /api/seminars                  (upsert a breakout: slot, title, capacity)
POST /api/seminars/assign           ({dryRun} for a preview)
GET  /api/seminars/roster?slot=&title=
GET  /api/church-rosters            (grouped from the live cache; printable)
POST /api/reminders/pending-charges ({dryRun} previews who owes)
```

The staff app's **Tools** tab uses these for printable church rosters, seminar
capacity + ranked-preference assignment, and pay-later reminders. The
**Transfer/Swap** and **Refund** panels use `/api/transfer` and `/api/refund`;
the check-in screen shows the balance due plus the Square card total
(base + 2.9% + $0.30). Writes require `registrar` (or `payments` for refunds).

### Magic-link helper routes

```text
POST /api/magic-link/request
POST /api/magic-link/registration
POST /api/magic-link/save
```

---

## Magic-link registration management

The staff PWA is at `/app/`. The registrant self-service portal is at `/portal/` (also available as `/portal.html`; `/manage/` redirects to `/portal/`). WordPress registration confirmation and edit emails should point users to `/portal/` for magic-link management, or include generated magic links from GAS.

Staff can select/open a registration and use the **Link** tab to send a secure edit link to the registrant email. Registrants can also request their own privacy-safe management link from `/portal/`.

---

## Current UI features

- Staff sign-in screen
- Mobile-first CM26-style layout
- Sticky status header
- Online/offline indicator
- Cached registration search
- Payment-status filter
- Registration detail editor
- Attendee editor, up to 5 attendees
- Seminar preference editor for all 4 sessions
- QR scanner tab
- Record payment panel
- Check-in button
- Magic-link sender
- Offline queue bar
- Manual cache refresh
- Recent activity log
- Installable PWA manifest

---

## QR scanner behavior

The scanner uses `html5-qrcode` and opens a registration if the scanned value contains one of these:

- exact `Registration ID`,
- exact `QR Token`,
- URL query parameter named `registrationId`, `regId`, `id`, `token`, or `qrToken`,
- or a URL path segment containing the registration ID or QR token.

The server endpoint is:

```text
GET /api/scan/:value
```

Camera access requires HTTPS in production.

---

## Offline queue behavior

When the device is offline, the PWA queues:

- check-in actions,
- payment actions.

Queued actions are stored in browser `localStorage`:

```text
imsda_registration_queue
```

The app shows a bottom queue bar when pending actions exist. It attempts to sync automatically when the browser returns online and can also sync manually through **Sync Now**.

Sync route:

```text
POST /api/offline-actions
```

Important: offline queue currently does **not** support full registration/contact/attendee edits. Only check-in and payment actions are queued offline.

---

## Cache behavior

The server keeps an in-memory cache of:

- registrations,
- attendees,
- seminar preferences,
- waitlist,
- check-in stats,
- payment stats.

Cache refreshes happen:

- on server start,
- on interval using `PWA_SYNC_INTERVAL_MS`,
- after successful writes,
- when staff taps **Refresh**.

Because cache is in memory, restarting the server reloads from GAS.

---

## Main workflows

### Search/edit registration

1. Sign in.
2. Search by primary name, attendee name, email, phone, church, or registration ID.
3. Open registration.
4. Edit contact/registration fields.
5. Edit attendees and seminar preferences.
6. Save.
7. Confirm Google Sheets updates and cache refreshes.

### QR check-in

1. Open **Scan** tab.
2. Tap **Start Scanner**.
3. Scan QR code.
4. Confirm registration opens.
5. Record payment if needed.
6. Use **Check-In** tab.

### Offline check-in/payment

1. If device is offline, continue check-in/payment actions.
2. Actions are queued in the bottom queue bar.
3. When online, tap **Sync Now** or allow auto-sync.
4. Confirm queue count clears.

### Magic link

1. Open a registration.
2. Go to **Link** tab.
3. Confirm or enter email.
4. Send secure registration management link.

---

## Testing checklist

1. Deploy GAS updates.
2. Confirm `portalGetCacheSnapshot` works.
3. Start the Node app with real environment variables.
4. Sign in with a test account.
5. Confirm registrations appear after first cache sync.
6. Search by primary name, attendee name, email, phone, church, and registration ID.
7. Open a multi-attendee registration.
8. Edit attendee meal preference and seminar preferences.
9. Save and confirm `Attendees` and `SeminarPreferences` update in Google Sheets.
10. Record a test payment.
11. Check in a test registration.
12. Refresh cache and confirm updated status remains visible.
13. Test QR scan over HTTPS.
14. Turn device offline and perform a test check-in/payment.
15. Return online and confirm queued action syncs.
16. Send a test magic link.

---

## Troubleshooting

### No users configured

Set `WR26_AUTH_USERS` with at least one bcrypt-hashed user.

### Unauthorized

Confirm:

- staff username/password are correct,
- user has needed role,
- session cookie is allowed,
- `WR26_GAS_SECRET` matches Config `SECRET`.

### Cache does not load

Confirm:

- `WR26_GAS_URL` is correct,
- GAS Web App is deployed as **Me** and accessible to anyone,
- `gas/PwaSync.gs` is deployed,
- `portalGetCacheSnapshot` is routed in `gas/Code.gs`,
- Google Sheet headers match expected schema.

### Scanner does not open

Confirm:

- app is served over HTTPS,
- browser camera permission is allowed,
- check-in device has a camera,
- `html5-qrcode` script can load.

### Offline queue does not sync

Confirm:

- browser is online,
- staff session is still valid,
- `/api/offline-actions` is reachable,
- queued registration IDs still exist,
- GAS actions `checkinById` and `recordPayment` work.

### Payment/check-in writes but UI still looks old

Use **Refresh** to force cache refresh. Also check server logs for GAS errors.

---

## Current limitations

- Cache is in-memory only.
- Offline queue supports check-in and payments only.
- Full offline registration editing is not implemented.
- Staff accounts are environment-based, not managed from a UI.
- App icons are not included yet.
- Saving attendees/seminars replaces rows for that registration to keep sheet data consistent.

---

## Recommended next pass

- Add real PWA icons.
- Add printable church rosters.
- Add seminar roster reports.
- Add payment dashboard/pending-payment cleanup screen.
- Add role/user management UI.
- Add optional persistent cache storage.
