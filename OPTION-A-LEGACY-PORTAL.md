# Option A: Legacy WR26 Plugin + Registration Portal

This path keeps the existing `plugin/wr26-registration.php` legacy plugin as the production registration bridge and adds a companion portal for registration management.

## Why Option A

The legacy WR26 plugin is the safer production base right now because it already captures Fluent Forms submissions, queues them, and sends attendee/seminar data to Google Apps Script. The IMSDA Registration Engine remains useful long-term, but it still has blocking admin/rendering and parser issues documented in `AUDIT-REPORT.md`.

## What was added

### Google Apps Script

New file:

- `gas/Portal.gs`

Updated files:

- `gas/Code.gs`
- `gas/Setup.gs`

New GAS actions:

- `portalRequestMagicLink`
- `portalGetRegistrationByMagicToken`
- `portalSaveRegistrationByMagicToken`
- `portalGetRegistrationBundle`
- `portalAdminSaveRegistration`
- `portalSearchRegistrations`

New sheet:

- `MagicLinks`

Headers:

`Token, Timestamp, Email, Registration ID, Expires At, Last Used At, Status, Purpose, Request IP, Notes`

## WordPress companion plugin

New file:

- `plugin/wr26-registration-portal.php`

Install it alongside the current legacy plugin. Do not deactivate `wr26-registration.php`.

The portal plugin reuses the existing legacy plugin options:

- `wr26_gas_url`
- `wr26_gas_secret`
- `wr26_edit_page_url`

## Shortcodes

### Magic-link request form

Place this on a public page where registrants can request their secure link:

```text
[wr26_magic_link_request portal_url="https://YOUR-SITE.org/wr26-registration-portal/"]
```

The email field is intentionally privacy-safe: it returns a generic success message whether or not a registration exists.

### Registrant portal page

Create a public page and place:

```text
[wr26_registration_portal]
```

This page is opened from the magic-link email with a `?token=...` URL. Registrants can update:

- contact name
- phone
- church
- arrival/departure dates
- emergency contact
- dietary needs
- special needs
- attendees 1–5
- attendee meal preference
- attendee dietary needs
- childcare needed
- seminar preferences for all 4 sessions

Payment status is displayed but not directly editable by registrants.

### Staff registration manager

Create a staff-only WordPress page and place:

```text
[wr26_staff_registration_manager]
```

Only users with `manage_options` can view it. It allows staff to search registrations and edit contact, attendee, and seminar data without opening the Google Sheet.

## Deployment steps

1. Push the updated `/gas` files to Apps Script.
2. Redeploy the Apps Script Web App.
3. Update WR26 → Settings if the deployment URL changed.
4. Run `wr26EnsureSheetSetup()` in Apps Script.
5. Run `wr26SetupCheck()` and confirm `MagicLinks`, `Attendees`, and `SeminarPreferences` pass.
6. Install/activate `plugin/wr26-registration-portal.php` in WordPress.
7. Create the two public pages:
   - Magic link request page
   - Registration portal page
8. Create the staff manager page and restrict visibility as desired.
9. Submit a test registration with 2+ attendees.
10. Request a magic link and verify edits write to `Registrations`, `Attendees`, and `SeminarPreferences`.

## Important Fluent Forms requirement

The portal expects the same attendee naming pattern as the legacy parser:

- `attendee_count`
- `a1_first_name`, `a1_last_name`, `a1_phone`, `a1_attendee_type`
- `a1_meal_preference`, `a1_dietary_needs`, `a1_childcare_needed`
- `a1_session1_pref1`, `a1_session1_pref2`
- `a1_session2_pref1`, `a1_session2_pref2`
- `a1_session3_pref1`, `a1_session3_pref2`
- `a1_session4`

Repeat the same structure for `a2_` through `a5_`.

## Current limitations

- The portal is intentionally lightweight. It is functional, not a final polished UI.
- Staff access currently uses WordPress admin capability `manage_options`; a future pass can add roles like `wr26_registrar` or magic-link staff login.
- Magic links expire after 14 days.
- The registrant portal does not take payments directly yet; it displays payment state and keeps payment changes in staff/admin workflows.
- The portal replaces attendee/seminar rows for a registration when saved. This keeps the sheet consistent but should be tested before live use.

## Recommended next pass

1. Polish the staff UI into dashboard tabs: Registrations, Attendees, Payments, Seminars, Church Rosters, Waitlist.
2. Add a dedicated non-admin staff role instead of requiring `manage_options`.
3. Add payment-link button or payment instructions inside the registrant portal.
4. Add change-log rows for attendee/seminar changes.
5. Improve the Fluent Forms JSON so Attendee 1 uses the same `a1_*` pattern as attendees 2–5.
