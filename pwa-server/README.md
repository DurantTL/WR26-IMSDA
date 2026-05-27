# WR26 Cached PWA Server

This is the CM26-style custom app layer for Women's Retreat 2026.

It keeps Google Sheets + GAS as the source of truth, but adds a separate Node/Express app that:

- pulls a full cache snapshot from GAS,
- keeps registrations/attendees/seminars in server memory,
- serves fast same-origin `/api/*` routes to the browser,
- hides the GAS URL and GAS secret from staff browsers,
- provides a custom registration manager UI,
- writes edits/payments/check-ins back through GAS,
- refreshes the local cache after writes.

## Architecture

```text
Fluent Forms / legacy WR26 plugin
        ↓
Google Apps Script + Google Sheets
        ↓
WR26 cached PWA server
        ↓
Custom browser/PWA UI
```

This does **not** replace `plugin/wr26-registration.php`. The legacy plugin should still handle registration intake from Fluent Forms.

## Files

```text
pwa-server/
  package.json
  server.js
  public/
    index.html
    app.js
    styles.css
    manifest.json
```

## Required GAS support

The app depends on these GAS files/actions:

- `gas/PwaSync.gs`
- `gas/Portal.gs`
- `gas/Code.gs` route for `portalGetCacheSnapshot`
- `gas/Code.gs` routes for portal/admin save actions

Run `clasp push` or otherwise copy the updated GAS files into Apps Script, then redeploy the Web App.

## Environment variables

```bash
PORT=3000
WR26_GAS_URL=https://script.google.com/macros/s/...../exec
WR26_GAS_SECRET=your_config_sheet_SECRET_value
SESSION_SECRET=replace-with-long-random-string
PWA_SYNC_INTERVAL_MS=60000
WR26_AUTH_USERS='[{"username":"registrar","password":"$2b$10$...bcrypt...","roles":["registrar","payments","checkin"]}]'
```

Roles supported by the server:

- `admin` — all access
- `registrar` — search/edit registrations and attendees
- `payments` — record payments
- `checkin` — check in guests and record check-in payments
- `readonly` — view/search only

Passwords must be bcrypt hashes, same style as CM26.

## Local development

```bash
cd pwa-server
npm install
npm start
```

Open:

```text
http://localhost:3000/app/
```

Health check:

```text
http://localhost:3000/health
```

## Main API routes

Staff/auth routes:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Cache routes:

- `GET /api/bootstrap`
- `GET /api/sync/status`
- `POST /api/sync/refresh`

Registration routes:

- `GET /api/registrations?q=...`
- `GET /api/registration/:id`
- `POST /api/registration/:id`

Operations:

- `POST /api/payment`
- `POST /api/check-in`

Registrant magic-link helper routes:

- `POST /api/magic-link/request`
- `POST /api/magic-link/registration`
- `POST /api/magic-link/save`

## Current UI features

- Sign-in screen
- Cached registration search
- Payment-status filter
- Registration detail editor
- Attendee editor, up to 5 attendees
- Seminar preference editor for all 4 sessions
- Record payment panel
- Check-in button
- Magic-link sender
- Manual cache refresh

## Current limitations

This is the first custom app pass. It is functional but not final-polished.

Known limitations:

- Cache is in-memory only; restarting the server reloads from GAS.
- Offline browser editing is not implemented yet.
- QR scanner is not implemented in this new UI yet.
- The app uses the existing GAS save helpers, which replace attendee/seminar rows for a registration when saving.
- Staff accounts are configured by environment JSON, not yet managed from a UI.
- Icons are not included yet.

## Recommended testing checklist

1. Deploy GAS updates.
2. Confirm `portalGetCacheSnapshot` works from Apps Script logs or the app health/sync status.
3. Start the Node app locally with real environment variables.
4. Sign in with a test account.
5. Confirm registrations appear quickly after the first cache sync.
6. Search by primary name, attendee name, email, phone, and church.
7. Open a multi-attendee registration.
8. Edit attendee meal preference and seminar preferences.
9. Save and confirm `Attendees` and `SeminarPreferences` update in the Google Sheet.
10. Record a test payment.
11. Check in a test registration.
12. Refresh cache and confirm updated status remains visible.

## Next pass ideas

- Add QR scanner using camera.
- Add offline queue for check-in and payments.
- Add printable church rosters.
- Add seminar roster reports.
- Add payment dashboard / pending payment cleanup screen.
- Add dedicated role management instead of environment-only accounts.
- Add icons and install polish.
