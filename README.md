# WR26 IMSDA Registration System

This repository contains the Women’s Retreat 2026 registration system using the **Option A production path**:

- **Legacy WordPress plugin** handles Fluent Forms registration intake.
- **Google Apps Script + Google Sheets** remain the source of truth.
- **IMSDA Registration PWA** is the separate CM26-style cached app for staff registration management, QR check-in, payments, magic links, and offline check-in/payment queueing.

The PWA is intentionally named **IMSDA Registration** in the browser/app UI so it can be reused or adapted more easily later. The repository and WR26 event files remain WR26-specific.

> **Canonical components (see `REVIEW-AND-ROADMAP.md`):** the production path is the
> legacy **`plugin/wr26-registration.php`** (Option A), the staff app is
> **`pwa-server/`**, and the registration form of record is
> **`form/wr26-registration-fluentforms.smart-payments.json`** (it includes the
> chargeable payment item and the `a1_*` attendee fields). The
> `imsda-registration-engine/` plugin and its `pwa/imsda-checkin.html` are kept as
> future/experimental and are not the production path. Payment is
> **server-authoritative**: GAS recomputes the owed amount from the Config and
> `PromoCodes` sheets; the form's in-page total is a charge/display convenience.

---

## Current architecture

```text
Fluent Forms registration form
        ↓
Legacy WR26 WordPress plugin
        ↓
Google Apps Script Web App
        ↓
Google Sheets source of truth
        ↓
IMSDA Registration PWA server cache
        ↓
Staff mobile/desktop PWA UI
```

### What each layer does

| Layer | Purpose |
|---|---|
| `plugin/wr26-registration.php` | Production-safe legacy intake from Fluent Forms into GAS/Sheets. Keep this active. |
| `gas/*.gs` | Sheet writes, edits, check-in, payments, magic links, PWA cache snapshots. |
| `pwa-server/` | Separate Node/Express cached PWA server. Browser talks to same-origin `/api/*`, not directly to GAS. |
| `plugin/wr26-registration-portal.php` | Optional companion WordPress portal/magic-link fallback. Does not replace the PWA. |
| `form/wr26-registration-fluentforms.smart-payments.json` | Canonical Fluent Forms import JSON (chargeable payment item + `a1_*` fields). Generated from the base JSON by `tools/patch-wr26-form-smart-payments.js`. |

---

## Event details

- **Event**: Women’s Retreat 2026
- **Open Camp Meeting begins**: Wednesday, June 3, 2026
- **Early Bird deadline**: August 14, 2026
- **Regular registration deadline**: September 17, 2026
- **Housing**: no housing flow in this system
- **Boxed dinners**: no boxed dinners
- **Shirts**: optional/TBD; do not treat shirts as a required core flow
- **Pricing**:
  - Early Bird: `$120`
  - Regular: `$140`
- **Promo guidance**:
  - Half-off Early Bird should normally be a `$60` fixed discount unless intentionally configured differently.

---

## Repository map

```text
gas/
  Code.gs                 Main GAS router / Web App entry
  Config.gs               Reads Config tab
  Registration*.gs        Registration writes/edits/search
  CheckIn.gs              Check-in and payment actions
  Portal.gs               Magic-link and registration bundle actions
  PwaSync.gs              Full cache snapshot for IMSDA Registration PWA
  Setup.gs                Sheet setup/check helpers

plugin/
  wr26-registration.php          Legacy production intake plugin
  wr26-registration-portal.php   Optional WordPress portal companion

docker-compose.yml        Docker Compose entrypoint for XCloud/Compose deployments

pwa-server/
  Dockerfile
  .dockerignore
  server.js
  package.json
  public/
    index.html
    app.js
    styles.css
    manifest.json
  README.md

form/
  wr26-registration-fluentforms.json
```

---

## Google Sheet setup

Create or verify these tabs. You can use `wr26EnsureSheetSetup()` from Apps Script to add missing tabs/headers, then run `wr26SetupCheck()` to verify alignment.

### Required tabs and headers

**Registrations**

```text
Registration ID, Timestamp, First Name, Last Name, Email, Phone, Church, Arrival Date, Departure Date, Dietary Needs, Emergency Contact Name, Emergency Contact Phone, Special Needs, Promo Code, Discount Amount, Original Amount, Final Amount, Payment Method, Payment Status, Square Payment ID, FF Entry ID, Status, Transfer Notes, Checked In, Check-In Time, Check-In By, QR Token, Edit Token, Admin Notes, Amount Paid, Coupon Used
```

**Attendees**

```text
Attendee ID, Registration ID, First Name, Last Name, Phone, Email, Church, Adult/Child, Meal Preference, Dietary Needs, Childcare Needed, Seminar Preferences Complete, Notes
```

**SeminarPreferences**

```text
Preference ID, Registration ID, Attendee ID, Attendee Name, Session Slot, Preference Rank, Seminar Title, Seminar ID, Assigned Seminar, Assignment Status, Notes
```

**Waitlist**

```text
Waitlist ID, Timestamp, First Name, Last Name, Email, Phone, Church, FF Entry ID, Status, Position, Promoted At, Notes
```

**PromoCodes**

```text
Code, Description, Discount Type, Discount Amount, Max Uses, Current Uses, Expiry Date, Active, Min Purchase
```

**TransferLog**

```text
Transfer ID, Timestamp, Original Reg ID, New Reg ID, Original Name, New Name, Original Email, New Email, Reason, Refund Notes, Admin Notes, Transferred By
```

**CheckIns**

```text
Check-In ID, Timestamp, Registration ID, Name, Church, Method, Admin User
```

**Config**

```text
Key, Value
```

**MagicLinks**

```text
Token, Timestamp, Email, Registration ID, Expires At, Last Used At, Status, Purpose, Request IP, Notes
```

**AuditLog**

```text
Audit ID, Timestamp, Action, Registration ID, Actor, Details, Source IP
```

The `AuditLog` tab records staff/admin mutations (admin edits, payments,
refunds, check-ins, transfers, waitlist promotions/removals, seminar
assignment, and registrant self-service edits). Writing to it is best-effort:
if the tab is absent, the action still succeeds and logging is skipped.

**Refunds**

```text
Refund ID, Timestamp, Registration ID, Name, Amount, Method, Reason, Status, Refunded By, Notes
```

Refunds are recorded here (additive — the `Registrations` column map is
unchanged). Recording a refund sets the registration's payment status to
`refunded` or `partial_refund` (based on how much was collected) and appends a
dated note to `Admin Notes`. Multiple partial refunds accumulate.

**Seminars**

```text
Slot, Slot Label, Seminar Title, Capacity, Assigned Count, Active, Notes
```

Defines the 8 breakouts across the 4 time slots (`Slot` values `session_1`–
`session_4`). `Capacity` of `0` means unlimited. The assignment engine reads
this sheet, places each attendee by ranked preference within capacity, and
writes the result back to `SeminarPreferences` (`Assigned Seminar` /
`Assignment Status`) and the live `Assigned Count` here. When a seminar is full
the behavior follows Config `SEMINAR_FULL_BEHAVIOR` (`allow_with_review`
over-fills the top choice and flags it `full_review`; otherwise the attendee is
left `unassigned_full`).

Both `Refunds` and `Seminars` are created automatically by
`wr26EnsureSheetSetup()`.

**Staff**

```text
Username, Password Hash, Roles, Active, Created At, Created By, Updated At, Notes
```

Staff PWA logins, managed from the app's **Staff** tab (admin only). Passwords
are **bcrypt-hashed by the Node server before they reach GAS** — this sheet never
stores plaintext. The `WR26_AUTH_USERS` env var remains the bootstrap admin set
and always works even if this sheet is empty, so an operator can't be locked out;
bootstrap admins are shown in the UI but can't be edited or disabled there.
Created automatically by `wr26EnsureSheetSetup()`.

### Setup helpers

Run from Apps Script after copying/pushing the GAS files:

```javascript
wr26EnsureSheetSetup();
wr26SetupCheck();
```

If `wr26SetupCheck()` reports out-of-order columns, manually reorder the sheet headers before live submissions.

---

## Config sheet keys

At minimum, configure these rows in the **Config** tab:

```text
SECRET
ADMIN_EMAIL
NOTIFICATION_EMAIL
CAPACITY=350
EVENT_NAME=Women's Retreat 2026
EVENT_DATES
EVENT_LOCATION
GAS_VERSION
EARLY_BIRD_PRICE=120
REGULAR_PRICE=140
EARLY_BIRD_END_DATE=2026-08-14
REGULAR_END_DATE=2026-09-17
OPEN_CAMP_MEETING_DATE=2026-06-03
EDIT_PAGE_URL
PORTAL_URL
PORTAL_LINK_TTL_DAYS=60
PAYMENT_DEFAULT=pay_later
WORKER_REGISTRATION_URL
CHILDCARE_ENABLED=true
CHILDCARE_MINIMUM_CHILDREN=0
CHILDCARE_MESSAGE
SQUARE_FEE_ENABLED=true
SQUARE_FEE_PERCENT=2.9
SQUARE_FEE_FIXED=0.30
SEMINAR_FULL_BEHAVIOR=allow_with_review
SEMINAR_CAPACITY_DEFAULT=0
CHECKIN_PIN
CHECKIN_TOKEN
MAGIC_LINK_ENFORCE_IP=false
MAGIC_LINK_COOLDOWN_SECONDS=60
```

Important:

- `SECRET` must match the WordPress plugin secret and the PWA server `WR26_GAS_SECRET`.
- **`PORTAL_URL` is the public address of the PWA registrant portal** (e.g. `https://registration.imsda.org/portal/`). Set this so GAS emails (confirmation, transfer, waitlist promotion, payment reminder) embed a **real PWA magic link** that opens the portal. Each emailed link mints a `MagicLinks` token valid for `PORTAL_LINK_TTL_DAYS` (default 60). If `PORTAL_URL` is blank, emails fall back to the legacy `EDIT_PAGE_URL` + edit-token link.
- `CHECKIN_PIN` and `CHECKIN_TOKEN` are still available for legacy check-in flows, but the new IMSDA Registration PWA uses server-side staff login. Staff accounts come from `WR26_AUTH_USERS` (bootstrap admins) **plus** the `Staff` sheet managed in-app from the **Staff** tab (admin only).
- `SQUARE_FEE_*` controls passing card processing fees to registrants. WR26 passes Square fees, so these default to enabled (`2.9% + $0.30`). The online registration form already adds this surcharge on the card path; these Config keys apply the same fee to on-site Square payments recorded through the PWA. Set `SQUARE_FEE_ENABLED=false` to stop passing fees.
- `MAGIC_LINK_COOLDOWN_SECONDS` throttles repeat magic-link requests per email (anti-spam). `MAGIC_LINK_ENFORCE_IP` is **off by default**; set it to `true` only if you want to reject a magic link used from a different network than it was requested from (this can lock out mobile/forwarded users, so leave off unless needed).

---

## GAS deployment

1. Copy or push all files in `/gas` to the Apps Script project.
2. In Apps Script, run any function once, such as `doGet`, and accept permissions for `SpreadsheetApp` and `MailApp`.
3. Run:

```javascript
wr26EnsureSheetSetup();
wr26SetupCheck();
```

4. Deploy as a Web App:
   - **Execute as**: Me
   - **Who has access**: Anyone / Anyone, even anonymous
5. Copy the Web App URL.
6. Put the Web App URL into:
   - WordPress WR26 settings
   - PWA server environment variable `WR26_GAS_URL`

Important: if you create a new deployment URL, update both WordPress and the PWA server environment.

`gas/.clasp.json` should contain only a placeholder script ID in the repo. Replace it locally with the real script ID before `clasp push`, and do not commit the private ID.

---

## WordPress legacy intake setup

Use the legacy plugin as the production intake path.

1. Activate:

```text
plugin/wr26-registration.php
```

2. Go to **WR26 → Settings**.
3. Configure:
   - GAS URL
   - Fluent Form ID
   - Edit Registration Page URL
4. Go to **WR26 → GAS Tools**. GAS Tools is part of the main WR26 Registration plugin, so only the main plugin needs to be active.
5. Copy the displayed GAS Secret into the Google Sheet **Config** tab as `SECRET`.
6. Use **Ping GAS / Cache Snapshot** first to verify the WordPress-to-GAS connection and matching secret.
7. Use **Send Fake Registration to GAS** only for testing. It creates real test rows in the Sheet, so delete those test rows after confirming the connection.
8. Submit a test Fluent Forms registration.
9. Confirm rows are written to:
   - `Registrations`
   - `Attendees`
   - `SeminarPreferences`

The legacy plugin should remain active even when using the separate IMSDA Registration PWA.

---

## Fluent Forms expected field names

The parser is field-name sensitive. Make sure the imported form JSON uses these keys.

### Primary registration/contact fields

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

### Attendee fields

Attendee 1 should now use the same attendee-level pattern as the other attendees. This avoids the old issue where attendee 1 was partly implied by the primary contact.

For attendee 1:

```text
a1_first_name
a1_last_name
a1_phone
a1_attendee_type
a1_meal_preference
a1_dietary_needs
a1_childcare_needed
a1_session1_pref1
a1_session1_pref2
a1_session2_pref1
a1_session2_pref2
a1_session3_pref1
a1_session3_pref2
a1_session4
```

For attendees 2–5, replace `N` with `2`, `3`, `4`, or `5`:

```text
aN_first_name
aN_last_name
aN_phone
aN_attendee_type
aN_meal_preference
aN_dietary_needs
aN_childcare_needed
aN_session1_pref1
aN_session1_pref2
aN_session2_pref1
aN_session2_pref2
aN_session3_pref1
aN_session3_pref2
aN_session4
```

### Seminar option values

Keep these values stable even if labels change:

```text
Session 1 Friday 4 PM: fri_opt_1, fri_opt_2
Session 2 Saturday 2 PM: sat_2pm_opt_1, sat_2pm_opt_2, sat_2pm_opt_3
Session 3 Saturday 3:30 PM: sat_330_opt_1, sat_330_opt_2
Session 4 Sunday 8:15 AM: sun_opt_1
```

### Payment method values

```text
offline -> normalized to pay_later
square  -> normalized to square
```

---

## IMSDA Registration PWA setup

The separate PWA lives in `pwa-server/` and is the recommended staff-facing registration manager and check-in app.

Read the full setup guide here:

```text
pwa-server/README.md
```

### What the PWA does

- Staff login
- Cached registration search
- Registration detail editor
- Attendee editor, up to 5 attendees
- Seminar preference editor for all 4 sessions
- QR scanner
- Check-in
- On-site payment recording
- Registrant magic-link sending
- Offline queue for check-in and payment actions
- Manual cache refresh

### Basic local start

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

### Required environment variables

```bash
PORT=3001
WR26_GAS_URL=https://script.google.com/macros/s/...../exec
WR26_GAS_SECRET=your_config_sheet_SECRET_value
SESSION_SECRET=replace-with-long-random-string
PWA_SYNC_INTERVAL_MS=60000
WR26_AUTH_USERS='[{"username":"registrar","password":"$2b$10$...bcrypt...","roles":["registrar","payments","checkin"]}]'
```

The scanner requires HTTPS on phones. Localhost works for development, but production must be served over HTTPS through a reverse proxy, Cloudflare Tunnel, or another HTTPS deployment path.

---

## PWA staff roles

| Role | Access |
|---|---|
| `admin` | All access |
| `registrar` | Search/edit registrations and attendees |
| `payments` | Record payments |
| `checkin` | Check in guests and record check-in payments |
| `readonly` | View/search only |

Generate bcrypt hashes for `WR26_AUTH_USERS` inside `pwa-server` after `npm install`:

```bash
node -e "const bcrypt=require('bcrypt'); bcrypt.hash(process.argv[1],10).then(console.log)" "your-password"
```

---

## PWA API routes

The browser talks to the Node server, not directly to GAS.

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

### Workers (non-paying)

```text
POST /api/worker/register           (public, rate-limited — self-serve worker page)
POST /api/worker/add                (staff; registrar role)
GET  /worker/                       (public worker registration page)
```

### Staff management (admin only)

```text
GET  /api/staff                     (list bootstrap + sheet users)
POST /api/staff                     (add/update; password bcrypt-hashed here)
POST /api/staff/deactivate          (soft-disable a sheet user)
```

These power the staff app's **Tools** tab (rosters, seminar capacity +
assignment, payment reminders), the **Transfer/Swap** and **Refund** panels,
and the balance-due display at check-in (which also shows the Square card total,
base + 2.9% + $0.30, for collection in the Square app). `/api/refund`,
`/api/transfer`, `/api/seminars` (POST), and `/api/seminars/assign` require the
`registrar` (or `payments` for refunds) role; reads require any staff role.

### Magic-link helper routes

```text
POST /api/magic-link/request
POST /api/magic-link/registration
POST /api/magic-link/save
```

---

## QR scanner behavior

The IMSDA Registration PWA can open a registration from scanned QR content if the scan contains:

- the exact `Registration ID`,
- the exact `QR Token`,
- a URL with `registrationId`, `regId`, `id`, `token`, or `qrToken`,
- or a URL path segment containing the registration ID or QR token.

Camera access requires HTTPS in production.

---

## Offline queue behavior

The PWA queues these actions when the device is offline:

- check-in
- payment recording

Queued actions are stored in browser `localStorage` under:

```text
imsda_registration_queue
```

When the device comes back online, the app automatically attempts to sync queued actions through:

```text
POST /api/offline-actions
```

The queue can also be synced manually with the **Sync Now** button in the bottom queue bar.

Important: full offline editing of registration/attendee details is not implemented yet. Only check-in and payment actions are queued offline.

---

## Magic-link registration management

**The PWA is the single registrant self-service surface.** The staff app is at
`/app/` and the registrant portal is at `/portal/` (also `/portal.html`;
`/manage/` redirects to `/portal/`). Set the `PORTAL_URL` Config key to your
deployed `/portal/` address so GAS emails link there.

There are three ways a registrant reaches the portal — all open the same PWA:

### 1. From a GAS email (automatic)

Confirmation, transfer, waitlist-promotion, and payment-reminder emails embed a
real PWA magic link (a `MagicLinks` token appended to `PORTAL_URL`). This is the
primary path and requires only that `PORTAL_URL` is set.

### 2. Self-service request

A registrant visits `/portal/`, enters their email, and receives a privacy-safe
management link.

### 3. Staff-initiated

Staff open a registration and use the **Link** tab to email a secure edit link on
demand.

### Optional WordPress companion plugin (legacy)

`plugin/wr26-registration-portal.php` provides WordPress-hosted magic-link pages.
It is **legacy** — for new deployments, standardize on the PWA portal above and
keep the WordPress plugin doing registration *intake* only. If you do run it:

Shortcodes:

```text
[wr26_magic_link_request portal_url="https://YOUR-SITE.org/wr26-registration-portal/"]
[wr26_registration_portal]
[wr26_staff_registration_manager]
```

Notes:

- The companion plugin reuses the existing legacy plugin options: GAS URL and GAS secret.
- `[wr26_staff_registration_manager]` currently requires a WordPress user with `manage_options`.
- The PWA is still the preferred staff tool.

---

## Check-in day guide

Use the **IMSDA Registration PWA** as the primary check-in tool.

Recommended flow:

1. Staff sign in.
2. Confirm the header shows `Online` and recent cache status.
3. Use **Scan** tab for QR codes.
4. Use **Search** tab if a QR code does not scan.
5. Open registration details.
6. Confirm attendee information.
7. Record outstanding payment if needed.
8. Tap **Check-In**.
9. If the device goes offline, continue check-in/payment work; queued actions will appear in the bottom bar.
10. When online again, tap **Sync Now** or let the app auto-sync.

---

## Payment flow

Default expectation:

- Pay Later is the default method.
- Pay Now can remain available if enabled.
- Outstanding balances can be recorded before or during check-in.

If Square/credit card fees are passed through, configure:

```text
SQUARE_FEE_ENABLED=true
SQUARE_FEE_PERCENT
SQUARE_FEE_FIXED
```

The PWA records payment actions back to GAS/Sheets and refreshes its local cache after successful writes.

---

## Childcare

- Childcare is conditional.
- Collect childcare interest per attendee/child.
- If only a few children register, a dedicated childcare program may not be offered.
- Confirmation messaging should state childcare details will be confirmed later if needed.

Recommended Config keys:

```text
CHILDCARE_ENABLED
CHILDCARE_MINIMUM_CHILDREN
CHILDCARE_MESSAGE
```

---

## Worker / non-paying attendee registration

Workers (volunteers, presenters, staff) register for **free**, built natively
into the PWA — no external Google Form needed.

Two entry points, both calling GAS `workerRegister` through the Node server:

- **Public self-serve page** at `/worker/` — anyone can register as a worker
  (rate-limited, validated; the browser never holds the GAS secret). Route:
  `POST /api/worker/register` (no auth).
- **Staff "Add Worker"** in the app's Tools tab — `POST /api/worker/add`
  (`registrar` role).

Workers are written to the same `Registrations` / `Attendees` /
`SeminarPreferences` sheets, so they appear in church rosters, meal counts, and
seminar assignment — but with `finalAmount` 0 and payment status
`worker_no_charge`. They are excluded from the paid `CAPACITY` check, payment
reminders, and revenue totals, and are tagged `[worker]` in `Admin Notes`. They
receive a confirmation email with a check-in QR code and a portal magic link.

`WORKER_REGISTRATION_URL` (Config) remains available if you still want to link
out to an external form instead, but the built-in `/worker/` page is the
recommended path.

---

## Promo code workflow

Promo handling is split by payment path:

- **Card / Pay Now discounts are handled by Fluent Forms' native coupon field.** The
  coupon discounts the chargeable amount at checkout and the coupon code is reported
  back through `fluentform_payment_success` into the Sheet (`Coupon Used`). The
  registration form intentionally does **not** apply its own promo discount in
  JavaScript, so a code never gets discounted twice.
- **Pay-Later discounts** can be recorded via the GAS `PromoCodes` sheet: the
  registrant enters a code in the `promo_code` field and GAS recomputes the owed
  balance from the sheet. Use this for the occasional pay-later promo.

To create a pay-later promo, use the WR26 Promo tab in WordPress or the GAS/admin workflow.

Example half-off Early Bird promo:

```text
Code: HALFRETREAT
Discount Type: fixed amount
Discount Amount: 60
Active: yes
Expiry Date: set as needed
Min Purchase: optional
```

---

## Transfer and waitlist workflow

### Transfer

Use the legacy plugin/admin transfer flow to transfer one registration to another person. Transfers are logged to `TransferLog`.

### Waitlist

When capacity is full, the system can write to `Waitlist`. Staff can promote/remove from the waitlist through the existing admin workflow. Promotion creates a registration and sends email when supported by the configured GAS/plugin flow.

---

## First deployment checklist

### Google Sheet

- [ ] Create all required tabs.
- [ ] Add required headers.
- [ ] Add Config rows.
- [ ] Run `wr26EnsureSheetSetup()`.
- [ ] Run `wr26SetupCheck()`.

### GAS

- [ ] Push/copy all `/gas` files.
- [ ] Authorize Apps Script permissions.
- [ ] Deploy Web App as **Me** and **Anyone / Anyone, even anonymous**.
- [ ] Copy Web App URL.

### WordPress

- [ ] Activate `plugin/wr26-registration.php`.
- [ ] Configure GAS URL.
- [ ] Configure Fluent Form ID.
- [ ] Configure Edit Registration Page URL.
- [ ] Copy WP secret to Config `SECRET`.
- [ ] Submit a test form.
- [ ] Confirm Registrations, Attendees, and SeminarPreferences rows are created.


### XCloud Docker Compose deployment

For XCloud, deploy the IMSDA Registration PWA with **Custom Docker → Docker Compose From Git**. Use:

| XCloud setting | Value |
|---|---|
| Compose file name | `docker-compose.yml` |
| Primary service port | `3001` |
| Environment file directory | `pwa-server` |
| Health check | `https://registration.imsda.org/health` |
| App URL | `https://registration.imsda.org/app/` |

The root `docker-compose.yml` defines the `imsda-registration` service, builds `./pwa-server/Dockerfile`, publishes `3001:3001`, and reads runtime environment variables from `./pwa-server/.env`. Do not commit real secrets; supply the environment file through XCloud.

Required XCloud environment variables:

```bash
NODE_ENV=production
PORT=3001
WR26_GAS_URL=https://script.google.com/macros/s/...../exec
WR26_GAS_SECRET=your_config_sheet_SECRET_value
SESSION_SECRET=replace-with-long-random-string
WR26_AUTH_USERS='[{"username":"registrar","password":"$2b$10$...bcrypt...","roles":["registrar","payments","checkin"]}]'
TRUST_PROXY=1
```

Keep the existing non-Docker Node deployment path available for local development or other hosts; Docker Compose is an additional deployment option.

### IMSDA Registration PWA

- [ ] Configure environment variables.
- [ ] Install dependencies with `npm install`.
- [ ] Start with `npm start`.
- [ ] Sign in with a test user.
- [ ] Confirm cache loads.
- [ ] Search by primary name, attendee name, email, phone, and church.
- [ ] Test a multi-attendee edit.
- [ ] Test payment record.
- [ ] Test check-in.
- [ ] Test QR scan over HTTPS.
- [ ] Test offline check-in/payment queue and sync.

---

## Troubleshooting

### Unauthorized

- Confirm WordPress secret, Config `SECRET`, and PWA `WR26_GAS_SECRET` match.
- Confirm GAS Web App deployment is accessible.

### PWA has no registrations

- Confirm `portalGetCacheSnapshot` is routed in `gas/Code.gs`.
- Confirm `gas/PwaSync.gs` was deployed.
- Check `/health` and `/api/sync/status`.
- Confirm the Google Sheet has at least one valid registration row.

### QR scanner unavailable

- Confirm the app is served over HTTPS.
- Confirm browser camera permission is allowed.
- Confirm `html5-qrcode` can load.

### Offline queue does not sync

- Confirm staff session is still valid.
- Confirm the device is online.
- Confirm `/api/offline-actions` is reachable.
- Check whether a queued action references a registration ID that no longer exists.

### Form imports but public form is blank

- Check Fluent Forms field types and container/repeater compatibility.
- Re-import the JSON after validating field names.
- Verify the active Fluent Form ID matches WR26 settings.

### Attendees or seminars are missing

- Confirm `a1_*` through `a5_*` field names match the expected parser keys.
- Confirm `attendee_count` is set correctly.
- Confirm `Attendees` and `SeminarPreferences` headers are correct.

---

## Current limitations

- PWA cache is in memory; restarting the Node server reloads from GAS.
- Offline queue currently supports check-in and payment actions only, not full registration editing.
- Staff accounts are configured through environment JSON, not a web UI.
- The PWA icon set is not included yet.
- Saving attendees/seminar preferences replaces rows for that registration to keep sheet data consistent; test before live use.

---

## Recommended next passes

- Add app icons and install polish.
- Add printable church rosters.
- Add seminar roster reports.
- Add payment dashboard/pending-payment cleanup screen.
- Add non-admin staff role management UI.
- Add optional persistent cache store if server restarts become an issue.
