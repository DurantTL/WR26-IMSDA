# WR26 Registration — WordPress plugins

This folder holds the WordPress side of the **Women's Retreat 2026** registration
system. Only two files are part of WR26:

| File | Activate? | What it does |
|---|---|---|
| **`wr26-registration.php`** | ✅ **Yes — required** | The main plugin. Bridges Fluent Forms submissions to the Google Apps Script backend (registration, waitlist, check-in), and provides the **WR26** admin menu including **GAS Tools**. |
| `wr26-registration-portal.php` | Optional | Companion portal: magic-link registrant editing + a staff registration manager. Does **not** replace the PWA staff app; it's a WordPress-hosted fallback. |

> The old `wr26-registration-gas-tools.php` shim was removed — GAS Tools is built
> into the main plugin (**WR26 → GAS Tools**), so no separate plugin is needed.

## Front-end assets (`assets/`)

Fluent Forms strips `<script>` from Custom HTML fields, so the interactive parts
of the registration form ship as real plugin assets enqueued by
`wr26-registration.php`. They self-gate (no-op on pages without the WR26 form).

| Asset | What it does |
|---|---|
| `assets/wr26-roster.js` + `wr26-roster.css` | The **custom attendee roster + seminar-selection cards**. Renders a friendly multi-attendee UI into the form's `#wr26-roster` mount, with 1st/2nd-choice seminar cards and live availability badges/progress bars. Serializes everything into hidden fields: `attendees_json` (uncapped source of truth), `attendee_count`, `seminar_counts_json`, `registration_roster_preview`, and sets `roster_active=1`. |
| `assets/wr26-form-summary.js` | Live registration-total recalc for the in-page summary box and the inline Square amount. Reads the attendee count from `attendees_json` (no cap). |

### How the roster data flows

```text
wr26-roster.js  →  attendees_json (+ counts/totals)  →  Fluent Forms submit
   →  wr26_parse_ff_entry() prefers attendees_json (decoded, sanitized, uncapped)
   →  payload.attendees  →  GAS writes Registrations / Attendees / SeminarPreferences
```

The parser falls back to the legacy `a1_*`–`a5_*` fields only when `attendees_json`
is absent (no-JS). Those legacy fields are required, so they're gated behind
`roster_active` in the form's conditional logic — see `form/README.md`.

### Seminar availability proxy

The seminar cards show counts-only availability from GAS `getSeminarAvailability`.
The plugin exposes a cached public proxy so the GAS secret never reaches the
browser:

```text
wp_ajax_wr26_seminar_availability        (logged-in)
wp_ajax_nopriv_wr26_seminar_availability (public form visitors)
```

It returns capacity, first/second-choice interest, assigned count, and a status
per seminar — **never attendee names** — cached for 60 seconds. The card titles
come from `wr26_seminar_catalog()` (mirrors `tools/seminars-seed.csv`); keep that
list in sync with the GAS `Seminars` sheet titles.

## Troubleshooting: "GAS returned a non-JSON response" (HTTP 400)

If **WR26 → GAS Tools** (Ping or Send Fake Registration) returns something like:

```json
{ "success": false, "message": "...", "http_code": 400,
  "raw_body": "<!DOCTYPE html> ... Error 400 (Bad Request)!!1 ..." }
```

the HTML in `raw_body` is **Google's front-end error page**, not a reply from the
script. The request never reached Apps Script. This is almost always a
configuration problem, not a code bug:

1. **GAS URL is wrong or stale.** Open **WR26 → Settings → GAS URL**. It must be
   the deployed *Web app* URL ending in **`/exec`**
   (`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`). The editor URL,
   a `/dev` URL, or a truncated value all produce a Google 400. The GAS Tools
   **Connection Summary** now flags a URL that doesn't match this shape.
2. **Deployment is out of date.** In Apps Script: **Deploy → Manage deployments**,
   edit the Web app deployment, pick a **New version**, and deploy. Copy the
   resulting `/exec` URL back into Settings.
3. **Access too restricted.** Deploy with **Execute as: Me** and
   **Who has access: Anyone** (a sign-in page instead of JSON means this is wrong).

After fixing the URL/deployment, re-run **Ping GAS / Cache Snapshot** — a healthy
backend returns JSON with `"success": true`.

## `archive/` — other events (not WR26)

`archive/` contains full, unrelated plugins for **other IMSDA events**, kept here
only for reference. They are **not** part of the Women's Retreat system and nothing
in WR26 references them:

- `camp-meeting-integration.php`, `camp-meeting-2026-system-plan.md`, `cm-availability.js` — **Camp Meeting 2026**
- `man-camp-registration.php`, `man-camp-registration.js` — **Man Camp**

Don't activate these for the Women's Retreat.
