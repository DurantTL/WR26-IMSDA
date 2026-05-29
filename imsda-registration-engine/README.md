# IMSDA Registration Engine

> **Status: future / experimental — NOT the production path for WR26.**
> The canonical production stack is **Option A** (`plugin/wr26-registration.php` +
> `pwa-server/`); see the root `README.md` and `REVIEW-AND-ROADMAP.md`. This
> engine is kept for the longer-term multi-event direction. The blocking/HIGH
> bugs from the 2026-05-14 audit have since been fixed in code (verified
> 2026-05-28: all four seminar sessions and `attendee_type` are parsed,
> `worker_registration` is read, the `update()` method handles partial saves,
> admin reads the correct GAS response keys, and `savePromoCode`/`checkinById`
> send the correct camelCase keys). Re-verify against live GAS before any
> production use.

Unified multi-event registration plugin for IMSDA. One plugin instance manages all events (WR26, CM26, MC26, etc.). Each event has its own Fluent Forms form, Google Apps Script backend, and GAS secret.

---

## Current Implementation Status

> **Honest state as of the 2026-05-14 audit.** Some admin pages are built but have data-rendering bugs that prevent them from displaying real data. The items below reflect what actually works, not what is planned.

| Admin Page      | Status   | What works / what doesn't |
|-----------------|----------|---------------------------|
| Dashboard       | ✅ Complete | Queue counts, failed submissions, event cards, run/retry/dismiss queue buttons |
| Events          | ✅ Complete | Create, edit, delete, import, export, test connection. **Caveat:** Regenerate Secret, Generate Check-In Token, and Set PIN fail silently due to a partial-update bug in `save()` — the browser shows success but nothing is persisted. |
| Registrations   | ⚠️ Partial | Table renders. Data never populates (response key mismatch with GAS). Edit and Transfer buttons have no click handlers. Search filter broken (key name mismatch). |
| Waitlist        | ⚠️ Partial | Promote/remove UI is built. Data never populates (response key mismatch with GAS). |
| Check-In        | ⚠️ Partial | Tabs are built. Stats, search results, and recent check-in list are all blank (response key mismatches + wrong key sent for checkinById). |
| Church Rosters  | ⚠️ Partial | Filter and print UI are built. Data never populates (response key mismatch). |
| Promo Codes     | ⚠️ Partial | Create/list/delete UI is built. List never populates. Creating a promo code fails (snake_case vs camelCase key mismatch with GAS). |
| Settings        | ✅ Complete | Queue interval, admin email, max attempts, danger-zone actions all work. |

**Before using any ⚠️ Partial page in production, the cross-system key mismatches must be fixed.** See AUDIT-REPORT.md for the full list.

---

## 1. What this plugin does

- Registers a `fluentform/submission_inserted` hook that captures any form submission, resolves which event it belongs to, parses the Fluent Forms entry, and queues a dispatch to Google Apps Script.
- Handles Square/online payments via `fluentform/payment_paid`, which fires only after the payment webhook confirms the charge (15–45 s delay is expected).
- Retries failed GAS dispatches up to a configurable maximum (default 5), then moves items to a "failed" list visible in the Dashboard.
- Exposes an admin menu at **IMSDA Reg** with pages for Events, Registrations, Waitlist, Check-In, Church Rosters, Promo Codes, and Settings.
- Serves a standalone check-in PWA at `/imsda-checkin/` and its web manifest at `/imsda-checkin-manifest.json`.

---

## 2. Installation

1. Copy `imsda-registration-engine/` into `wp-content/plugins/`.
2. Activate **IMSDA Registration Engine** in the WP Plugins screen.
3. Verify that cron is working: Dashboard should show "Next Queue Run" as a future time in Settings.
4. If `/imsda-checkin/` returns 404, go to **Settings → Permalinks** and click **Save Changes**, or use **IMSDA Reg → Settings → Flush Rewrite Rules**.

---

## 3. Adding your first event

1. Go to **IMSDA Reg → Events → Add New Event**.
2. Fill in the **Identity** tab: Event Name, Event Slug (auto-generated from name, lowercase, hyphens only), Dates, Location, Status.
3. Fill in the **GAS Connection** tab: paste the Google Apps Script deployment URL. The GAS Secret will be generated on save.
4. Fill in the **Form & Payment** tab: Fluent Form ID (numeric ID from Fluent Forms → Forms list), Default Payment Method, and Edit Registration Page URL.
5. Fill in **Capacity & Pricing** if needed (0 = unlimited).
6. Enable features on the **Features** tab.
7. Click **Save Event**. A GAS Secret is generated.
8. **Copy the GAS Secret immediately** and paste it into the `SECRET` row of your Google Apps Script Config sheet. It is shown in full only at this moment; afterwards only the first 8 characters are shown.

---

## 4. Event profile fields

All fields stored per-event in the `imsda_reg_events` WP option:

| Field | Type | Notes |
|-------|------|-------|
| `slug` | string | Immutable after creation. Lowercase, a-z 0-9 hyphen. |
| `name` | string | Display name. |
| `dates` | string | Free text, e.g. "October 9–11, 2026". |
| `location` | string | Free text, e.g. "Des Moines, IA". |
| `status` | enum | `active` | `inactive` | `closed`. Only `active` events accept submissions. |
| `gas_url` | URL | GAS web app deployment URL. |
| `gas_secret` | string | 32-char random string. Must match `SECRET` in GAS Config sheet. |
| `form_id` | int | Fluent Forms form ID. |
| `checkin_token` | string | Token for PWA authentication. Generated via Check-In page. |
| `checkin_pin` | string | 4–6 digit numeric PIN for PWA login. |
| `payment_default` | enum | `pay_later` | `square` | `check` | `cash`. |
| `capacity` | int | 0 = unlimited. |
| `waitlist_enabled` | bool | Used by the capacity check at submission time. |
| `early_bird_price` | float | |
| `early_bird_end_date` | date | YYYY-MM-DD. |
| `regular_price` | float | |
| `regular_end_date` | date | YYYY-MM-DD. |
| `edit_page_url` | URL | Full URL of the WP page with `[imsda_edit_registration event='slug']`. |
| `feature_waitlist` | bool | Enable waitlist admin page for this event. |
| `feature_promo_codes` | bool | |
| `feature_checkin` | bool | |
| `feature_transfers` | bool | |
| `feature_church_rosters` | bool | |
| `feature_attendees` | bool | Enable multi-attendee flat field parsing (`a1_`…`a5_` prefixes). |
| `field_map` | object | Key→candidates map. See Section 6. |
| `created_at` | datetime | Set on first save, never overwritten. |
| `updated_at` | datetime | Updated on every save. |
| `created_by` | string | WP username of creator. |

---

## 5. Field map reference

The field map controls which form field names the parser accepts for each canonical key. Default:

```json
{
  "first_name":               ["first_name"],
  "last_name":                ["last_name"],
  "email":                    ["email"],
  "phone":                    ["phone"],
  "church":                   ["church","home_church","church_name"],
  "arrival_date":             ["arrival_date","check_in"],
  "departure_date":           ["departure_date","check_out"],
  "dietary_needs":            ["dietary_needs","dietary"],
  "emergency_contact_name":   ["emergency_contact_name","emergency_name"],
  "emergency_contact_phone":  ["emergency_contact_phone","emergency_phone"],
  "special_needs":            ["special_needs","special_requests","notes"],
  "promo_code":               ["promo_code","discount_code","coupon_code","coupon"],
  "payment_method":           ["payment_method","payment","pay_method"],
  "attendee_count":           ["attendee_count"]
}
```

Each value is a list of candidate form field names tried in order. The first non-empty match is used.

**Custom map:** Edit the JSON on the Field Map tab when creating or editing an event. Use **Validate JSON** before saving.

**`church` special case:** If the resolved church value is `"Other"`, the parser automatically reads `church_other` from the raw form data.

---

## 6. Fluent Forms field naming requirements

### Primary registrant (top-level flat fields)
- `first_name`, `last_name`, `email`, `phone`
- `church` (use `church_other` for "Other" text box)
- `arrival_date`, `departure_date`
- `emergency_contact_name`, `emergency_contact_phone`
- `dietary_needs`, `special_needs`
- `attendee_count` (integer 1–5)
- `payment_method` (Fluent Forms payment method field, values: `offline` → normalizes to `pay_later`, `square` → `square`)
- `promo_code`
- `worker_registration` (flag field — **note:** parser currently reads `worker_flag` instead of `worker_registration`; this is a known bug — see AUDIT-REPORT.md Section 2.12)

### Multi-attendee fields (when `feature_attendees` is enabled)

Attendee 1 uses top-level fields plus:
- `a1_meal_preference`, `a1_dietary_needs`, `a1_childcare_needed`
- `a1_session1_pref1`, `a1_session1_pref2`
- `a1_session2_pref1`, `a1_session2_pref2`
- (**Note:** sessions 3 and 4 are not currently parsed — see AUDIT-REPORT.md Section 2.11)

Attendees 2–5 (replace N with 2–5):
- `aN_first_name`, `aN_last_name`, `aN_phone`
- `aN_meal_preference`, `aN_dietary_needs`, `aN_childcare_needed`
- `aN_session1_pref1`, `aN_session1_pref2`
- `aN_session2_pref1`, `aN_session2_pref2`
- (**Note:** `aN_attendee_type` is in the form but not forwarded to GAS — see AUDIT-REPORT.md Section 2.13)

---

## 7. Shortcodes

Only these shortcodes are implemented:

| Shortcode | Description |
|-----------|-------------|
| `[imsda_availability event="slug"]` | Displays raw JSON availability from GAS. Intended as a building block — the output is `JSON.stringify(r)` and should be styled/replaced. |
| `[imsda_availability_banner event="slug"]` | Same as above wrapped in a `<div class="imsda-availability-banner">`. |
| `[imsda_edit_registration event="slug"]` | Renders a minimal edit form. Loads current registration from GAS via the `token` query parameter. Allows editing: first name, last name, phone. Does not support email or payment changes. |

Create a WP page for the edit shortcode and copy its full URL into the event's "Edit Registration Page URL" field.

---

## 8. Queue system

Submissions are not sent to GAS synchronously. They are written to a WP option-based queue and processed on a schedule.

- **Default interval:** 5 minutes (configurable in Settings).
- **Retry limit:** 5 attempts (configurable in Settings).
- **On max failure:** Item moves to the Failed list; admin email receives a notification.
- **Dashboard:** Shows queue count, failed count, last run time, and a "Run Queue Now" button.
- **Per-item actions:** Retry (re-queues at 0 attempts) and Dismiss (removes from failed list without retrying).
- **Duplicate protection:** Queue refuses to add a second item for the same `event_slug` + `entry_id` combination.
- **Payment hold:** For Square/card payments, the submission is held in a `imsda_reg_pending_pay_{slug}_{entry_id}` option until `fluentform/payment_paid` fires. Only then is it enqueued.

---

## 9. PWA check-in

### Status
The standalone check-in PWA is **built and functional**. It lives at `pwa/imsda-checkin.html` and is served by WordPress at `/imsda-checkin/`.

### Features
- PIN screen (4–6 digits, validated against GAS)
- QR scanner (jsQR, environment-facing camera)
- Offline-first: IndexedDB caches all registrations locally
- Sync queue for check-ins recorded while offline
- Manual search by name, email, or church
- Record Payment sheet (cash/check/Square/other)
- Stats tab (local calculation from cached data)
- Offline banner

### Setup
1. On the **Check-In** admin page, select the event.
2. Click **Generate Token** to create a check-in token.
3. Set a check-in PIN (4–6 digits).
4. Copy the **PWA Launch URL** and share with door volunteers. The URL embeds the GAS URL, event slug, and token. Volunteers also need the PIN (share separately).
5. On first load, the PWA validates the PIN against GAS, then downloads all active registrations into IndexedDB.

### Known limitations
- Icon files (`/imsda-checkin-icon-192.png`, `/imsda-checkin-icon-512.png`) must be uploaded to the WordPress root separately — they are not included in the plugin.
- Square fee in the PWA is hardcoded at 2.9% + $0.30 and does not read `SQUARE_FEE_PERCENT`/`SQUARE_FEE_FIXED` from the GAS Config sheet.

---

## 10. Migrating from a legacy per-event plugin

For each legacy plugin:

1. Note the current GAS URL and form ID.
2. In **IMSDA Reg → Events**, add a new event with the same GAS URL and form ID.
3. Copy the generated GAS Secret into the Config sheet `SECRET` row.
4. Set the event to `active`.
5. Submit a test form entry and verify it appears in the queue and dispatches correctly.
6. Deactivate the legacy plugin.

**Important:** Before migrating, review AUDIT-REPORT.md Section 10 for a full list of features that are not yet working in the engine and would be lost on migration.

---

## 11. Known issues

The BLOCKING/HIGH items from the 2026-05-14 audit (response-key mismatches,
the `save()` partial-update bug, `savePromoCode`/`checkinById` key names,
missing Edit/Transfer handlers, sessions 3–4 parsing, the `worker_registration`
field name) have all been **fixed in code** and verified on 2026-05-28. See
`AUDIT-REPORT.md` for the original detail and `REVIEW-AND-ROADMAP.md` for the
current status.

Remaining engine notes (not production-critical, since the engine is parked):

| Note | Severity |
|------|----------|
| Token-based public edit forwards contact fields only (no attendee/seminar edits) — by design today; re-verify if the engine is ever promoted to canonical. | LOW |
| Standalone `pwa/imsda-checkin.html` is redundant with `pwa-server/` and is slated for deprecation. | LOW |

---

## 12. Troubleshooting

- **Test Connection always fails:** Verify the GAS is deployed as a Web App with "Execute as: Me" and "Access: Anyone, even anonymous". Also verify the GAS URL is correct in the event profile. If the issue persists after the 2026-05-14 audit, confirm the `getAvailability` routing fix was deployed to your GAS script.
- **Queue stuck / submissions not reaching GAS:** Run queue manually via Dashboard. Check failed submissions list. Verify GAS Secret matches the `SECRET` row in Config sheet.
- **`/imsda-checkin/` returns 404:** Go to Settings → Permalinks and click Save Changes, or use the Flush Rewrite Rules button in IMSDA Reg → Settings.
- **Wrong form capturing submissions:** Each event's form ID must be unique. Verify in Events that no two events share the same form ID.
- **Duplicate submissions in GAS:** GAS has `isDuplicateEntry()` protection. If the same entry appears twice in the Registrations sheet, check GAS logs — the duplicate guard reads FF Entry ID from column 21; confirm column order matches Setup.gs.
