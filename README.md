# Women's Retreat 2026 Registration System (WR26)

## 1) Quick start
1. Create a Google Sheet with tabs and columns exactly as listed below.
2. Copy files in `/gas` to Apps Script (`clasp push`) and deploy Web App.
   - After `clasp push` and deploying, open the Apps Script editor, select any function (for example `doGet`), and click **Run** once.
   - Accept all permission prompts for `SpreadsheetApp` and `MailApp`.
   - Without this one-time authorization step, the first real form submission can fail silently with an authorization error.
3. Activate WP plugin at `plugin/wr26-registration.php`.
4. In WR26 settings, set GAS URL, Fluent Form ID, Edit Registration Page URL.
5. Copy `wr26_gas_secret` from WP settings into Config sheet `SECRET`.

## 2) Event details
- **Event**: Women’s Retreat 2026
- **Open Camp Meeting begins**: Wednesday, June 3, 2026
- **Early Bird deadline**: August 14, 2026
- **Regular registration deadline**: September 17, 2026
- **No boxed dinners**
- **Shirts**: optional / TBD (do not treat shirts as a required core flow)
- **Pricing**:
  - Early Bird: **$120**
  - Regular: **$140**
- **Promo guidance**:
  - Promo codes should support half off Early Bird pricing as a **$60 fixed discount** unless your current promo setup is intentionally percentage-based.

## 3) Google Sheet setup (tabs + exact headers)
- **Registrations**: Registration ID, Timestamp, First Name, Last Name, Email, Phone, Church, Arrival Date, Departure Date, Dietary Needs, Emergency Contact Name, Emergency Contact Phone, Special Needs, Promo Code, Discount Amount, Original Amount, Final Amount, Payment Method, Payment Status, Square Payment ID, FF Entry ID, Status, Transfer Notes, Checked In, Check-In Time, Check-In By, QR Token, Edit Token, Admin Notes.
- **Attendees** (required for multi-attendee tracking): Attendee ID, Registration ID, First Name, Last Name, Phone, Email, Church, Adult/Child, Meal Preference, Dietary Needs, Childcare Needed, Seminar Preferences Complete, Notes.
- **SeminarPreferences** (required for seminar assignment workflow): Preference ID, Registration ID, Attendee ID, Attendee Name, Session Slot, Preference Rank, Seminar Title, Seminar ID, Assigned Seminar, Assignment Status, Notes.
- **Waitlist**: Waitlist ID, Timestamp, First Name, Last Name, Email, Phone, Church, FF Entry ID, Status, Position, Promoted At, Notes.
- **PromoCodes**: Code, Description, Discount Type, Discount Amount, Max Uses, Current Uses, Expiry Date, Active, Min Purchase.
- **TransferLog**: Transfer ID, Timestamp, Original Reg ID, New Reg ID, Original Name, New Name, Original Email, New Email, Reason, Refund Notes, Admin Notes, Transferred By.
- **CheckIns**: Check-In ID, Timestamp, Registration ID, Name, Church, Method, Admin User.
- **Config**: Key, Value.

After creating the housing-free sheet, add at least one row of test data to **Registrations** before testing the plugin to confirm column alignment.

> **Schema alignment warning**: If you previously ran `wr26EnsureSheetSetup()` before this schema alignment fix, run `wr26SetupCheck()` and verify **Waitlist** and **PromoCodes** column order before live submissions.

## 4) Config rows
Set keys (these are the exact row keys `getConfig()` reads from the Config sheet — verified against `Config.gs`):
- `SECRET`
- `ADMIN_EMAIL`
- `NOTIFICATION_EMAIL`
- `CAPACITY=350`
- `EVENT_NAME`
- `EVENT_DATES`
- `EVENT_LOCATION`
- `GAS_VERSION`
- `EARLY_BIRD_PRICE=120`
- `REGULAR_PRICE=140`
- `EARLY_BIRD_END_DATE=2026-08-14`
- `REGULAR_END_DATE=2026-09-17`
- `OPEN_CAMP_MEETING_DATE=2026-06-03`
- `EDIT_PAGE_URL`
- `PAYMENT_DEFAULT=pay_later`
- `WORKER_REGISTRATION_URL`
- `CHILDCARE_ENABLED=true`
- `CHILDCARE_MINIMUM_CHILDREN=0`
- `CHILDCARE_MESSAGE`
- `SQUARE_FEE_ENABLED=false`
- `SQUARE_FEE_PERCENT=0`
- `SQUARE_FEE_FIXED=0`
- `SEMINAR_FULL_BEHAVIOR=allow_with_review`
- `SEMINAR_CAPACITY_DEFAULT=0`
- `CHECKIN_PIN` — 4–6 digit PIN for the check-in PWA login screen
- `CHECKIN_TOKEN` — random token that authenticates the check-in PWA; must match the token configured in the WP plugin

## 5) WordPress setup
- Activate plugin.
- Open WR26 → Settings.
- Set `GAS URL`, `Form ID`, `Edit Registration Page URL`.
- Copy GAS secret to Config sheet.

## 6) Attendee-level registration data
Use attendee-level data when one registration includes multiple people.

Required attendee-level expectations:
- Each attendee should have their **own phone number**.
- Each attendee should have their **own meal preference**.
- Each attendee should have their **own seminar/session preferences**.
- Dietary needs can exist at registration level and attendee level, but attendee-level should be treated as primary for multi-attendee registrations.

Implementation note:
- If your current flow only writes one row per registration to **Registrations**, add write logic for **Attendees** and link by `Registration ID` + `Attendee ID`.

## 7) Seminar / breakout registration
Seminar structure for WR26:
- **8 total breakout options** over the weekend.
- **4 session time slots**:
  - Friday, 4:00 PM–5:00 PM: 2 options
  - Saturday, 2:00 PM–3:15 PM: 3 options
  - Saturday, 3:30 PM–4:45 PM: 2 options
  - Sunday, 8:15 AM–9:15 AM: 1 option

Registration behavior:
- Attendees rank seminar preferences.
- Preferences are tracked **per attendee**, not just per registration group.
- Different attendees under one registration can have different preferences.
- If a seminar is full, registration should still continue. Follow one of these behaviors:
  - assign next ranked preference,
  - place attendee on seminar preference waitlist,
  - or flag for manual review.

Recommended default:
- `SEMINAR_FULL_BEHAVIOR=allow_with_review`

Implementation note:
- Keep seminar preference data in a dedicated **SeminarPreferences** tab instead of overloading **Registrations**.

## 8) Fluent Forms parser field names

PRIMARY REGISTRANT (top-level flat fields):
- `first_name`, `last_name`, `email`, `phone`
- `church` (uses `church_other` value when `church` = "Other")
- `church_other`
- `arrival_date` (values: `2026-10-09`, `2026-10-10`)
- `departure_date` (value: `2026-10-11`)
- `emergency_contact_name`, `emergency_contact_phone`
- `special_needs`, `attendee_notes`
- `attendee_count` (1–5)
- `payment_method` (`offline` = pay_later | `square`)
- `promo_code`
- `worker_registration` (`no` | `yes`)
- `acknowledgment` (`yes`)

ATTENDEE 1 (primary registrant's preferences):
- `a1_meal_preference`, `a1_dietary_needs`, `a1_childcare_needed`
- `a1_session1_pref1`, `a1_session1_pref2`
- `a1_session2_pref1`, `a1_session2_pref2`
- `a1_session3_pref1`, `a1_session3_pref2`
- `a1_session4`

ATTENDEES 2–5 (replace N with 2, 3, 4, or 5):
- `aN_first_name`, `aN_last_name`, `aN_phone`, `aN_attendee_type`
- `aN_meal_preference`, `aN_dietary_needs`, `aN_childcare_needed`
- `aN_session1_pref1`, `aN_session1_pref2`
- `aN_session2_pref1`, `aN_session2_pref2`
- `aN_session3_pref1`, `aN_session3_pref2`
- `aN_session4`

Seminar option values (update labels in form only — these values never change):
- Session 1 (Friday 4PM): `fri_opt_1`, `fri_opt_2`
- Session 2 (Sat 2PM): `sat_2pm_opt_1`, `sat_2pm_opt_2`, `sat_2pm_opt_3`
- Session 3 (Sat 3:30PM): `sat_330_opt_1`, `sat_330_opt_2`
- Session 4 (Sunday 8:15AM): `sun_opt_1`

Payment method values from FF payment gateway:
- `offline` → normalized to `pay_later` in plugin
- `square` → normalized to `square` in plugin

## 9) Payment flow (Pay Later default)
Default expectation:
- **Pay Later is the default payment method**.
- **Pay Now** remains available if enabled, but should not be default.

Pay Later confirmation email should include:
- clear “you are registered” language,
- current balance due,
- payment link/button,
- edit-registration link,
- a large reminder to check the confirmation email for payment and edit details.

Pending/incomplete payment email should include:
- clear subject/message such as **“Did you forget to finish your payment?”**
- amount due,
- payment link,
- reminder that balance can still be paid later.

Check-in payment behavior:
- Check-in should display outstanding balance.
- If Square/credit card is used at check-in, amount shown/recorded should include Square/app fee **if your retreat chooses to pass fees through**.
- Configure fee behavior via:
  - `SQUARE_FEE_ENABLED=true/false`
  - `SQUARE_FEE_PERCENT`
  - `SQUARE_FEE_FIXED`

## 10) Confirmation screen / loading message
After submission, show a clear processing/confirmation message with large text.

Recommended confirmation text:
- “Registration received. Please check your email for your confirmation, payment link, and edit-registration link.”

If payment is still pending:
- “Your registration was received, but your payment may still be processing. Please check your email for payment instructions.”

## 11) Childcare
- Childcare is conditional.
- If only a few children register, there may not be a dedicated childcare program.
- Collect childcare interest/need per child or per attendee.
- Confirmation messaging should state childcare availability will be confirmed later if needed.

Recommended Config keys:
- `CHILDCARE_ENABLED=true/false`
- `CHILDCARE_MINIMUM_CHILDREN`
- `CHILDCARE_MESSAGE`

## 12) Worker / non-paying attendee registration
- Worker registration is handled separately through a Google Form.
- Workers/non-paying attendees should not use the standard paid registration flow unless explicitly instructed.
- Store worker form URL in Config as:
  - `WORKER_REGISTRATION_URL`

## 13) Shortcodes
- `[wr_edit_registration]` — **⚠ PLACEHOLDER ONLY.** The current implementation (`wr26-registration.php` line 498) returns a static `<div>` with the text "Edit form loads via AJAX using token." No edit form is rendered. The AJAX endpoints (`wr26_get_reg_by_token`, `wr26_save_edit`) are wired and functional, but the shortcode does not yet call them. Do not direct registrants to a page with this shortcode until it is replaced with a real form.

## 14) Edit registration page setup
Create a WP page for future use. Copy its full URL into WR26 → Settings → Edit Registration Page URL. The URL is passed to GAS and included in confirmation email edit links. The page must be publicly accessible — do not put it behind a login wall.

When the `[wr_edit_registration]` shortcode is fully implemented, place it on this page. Until then, confirm the URL is correct in settings so email links point to the right page even if the form is not yet functional.

## 15) Promo code walkthrough
WR26 Promo tab → New Promo Code → define code/type/amount/max uses/min purchase/expiry/active → Save.

Example half-off Early Bird promo:
- Code: `HALFRETREAT` (example)
- Discount Type: `fixed amount`
- Discount Amount: `60`
- Active: `yes`
- Expiry Date: set as needed
- Min Purchase: optional

## 16) Transfer process
Registrations tab → Transfer on active row → fill new registrant + reason/refund/admin notes → save.

## 17) Waitlist workflow
When full, queue action becomes `waitlist`; promote/remove from Waitlist tab; promotion creates registration + email.

## 18) Check-in day guide
Use Check-In tab QR scanner (camera) first; if needed use manual search and check-in by ID.

## 19) On-site payment collection
Registrants who paid by check or who arrive with an outstanding balance can have payment recorded directly from the Check-In tab without interrupting the check-in flow.

From the QR Scanner or Manual Search tab:
1. Complete check-in as normal.
2. If the result card shows a payment warning, tap Record Payment.
3. Select method (Cash / Check / Square / Other).
4. Confirm the amount and enter a check number if applicable.
5. Tap Save Payment — the registration is updated immediately in the Google Sheet.

From the Registrations tab:
- Any row with a pending payment status shows a 💲 Record button.
- Use this for pre-event payment cleanup before check-in day.

Stats tab shows a live Payments Pending count so you can track outstanding balances throughout the event.

## 20) Deployment notes
`clasp push` then create new deployment URL. Update WP **WR26 → Settings → GAS URL** after every redeploy URL change.

When creating the Web App deployment, set **Execute as: Me** and **Access: Anyone, even anonymous**. If Execute as is set to **User accessing the web app**, all requests will fail with a permissions error.

`gas/.clasp.json` in this repo should contain a placeholder script ID only. Replace it locally with your real Apps Script `scriptId` before running `clasp push`, and do not commit private IDs.

## 21) Troubleshooting
- Unauthorized: ensure WP secret equals Config `SECRET`.
- No sync: run queue manually from the WR26 Dashboard.
- Wrong form: verify `wr26_form_id` in WR26 → Settings.
- Missing edit links: verify Edit Registration Page URL in WR26 → Settings.
- **"Last Dispatch Run" always shows "Never"** in the WR26 Dashboard: this is a known bug (reads wrong option key). The queue IS running; verify via Settings → last queue run timestamp.
- Square payment delay: the `fluentform/payment_paid` hook only fires after Square's webhook confirms the charge, which can take 15–45 seconds after the registrant submits. The entry will not appear in the queue until that hook fires. This is expected behavior, not a bug.
- Promo codes do not save / list is empty: this is a known bug — see AUDIT-REPORT.md Section 2.8 and 2.9.

## Before deployment
- Run `wr26EnsureSheetSetup()`.
- Run `wr26SetupCheck()`.
- Confirm all Config values are present and correct.
- Confirm Fluent Forms attendee repeater field names match parser mappings.
- Submit a single-attendee Pay Later test.
- Submit a multi-attendee Pay Later test.
- Submit a Square/card test and ensure it remains pending until `fluentform/payment_paid`.
- Confirm Attendees rows are written correctly.
- Confirm SeminarPreferences rows are written correctly.
- Confirm confirmation email wording includes payment/edit guidance and childcare messaging.
- Confirm Check-In **Record Payment** sets status to `paid_onsite`.
- WR26 admin pages now include a lightweight fallback UI (no build step). It is suitable for staging/live event operations, but not a polished final UX.
- Registrations tab supports `getRegistrations` with search/status filter and refresh.
- Waitlist tab supports `getWaitlist`, `promoteWaitlist`, and `removeWaitlist`.
- Check-In tab supports `getCheckInStats`, `searchRegistrations`, `checkinById`, and `recordPayment`.
- Church Rosters tab supports `getChurchRosters` grouped by church with payment/check-in status.
- Promo tab supports `getPromoCodes`, `savePromoCode` (fixed/percent), and `deletePromoCode`.
- Dashboard supports queue/failure visibility plus `runQueue`, `retryFailed`, and `dismissFailed`.

### Manual runtime/data-integrity regression checklist
- Submit the same Fluent Forms entry twice (or retry queue): no duplicate registration row.
- Submit the same waitlist entry twice: no duplicate waitlist row.
- Promote a waitlist entry: no `checkCapacity()` crash.
- Public edit link save works via `wr26_save_edit`.
- Admin edit API action works (`adminEditRegistration`).
- Duplicate GAS response does not increment WordPress registered/waitlist count.
- Full-capacity register attempt fails clearly (or routes safely via existing waitlist logic).
- Registrations page loads and filters correctly.
- Waitlist promote/remove actions work and refresh list.
- Check-In search/check-in actions work.
- Check-In Record Payment updates pending balances.
- Promo create/deactivate actions work.
- Church Rosters load and group correctly.
- Queue dashboard buttons work (run/retry/dismiss).

## 22) Implementation checklist
- Confirm Fluent Forms attendee repeater field names.
- Confirm seminar titles and capacities.
- Confirm whether seminar full behavior is manual review, next preference, or waitlist.
- Confirm whether Square fee is passed to attendee.
- Confirm Pay Later is default in the front-end form.
- Confirm Pay Later email includes payment link.
- Confirm pending payment email is sent.
- Confirm confirmation screen has large check-email reminder.
- Confirm childcare wording is approved.
- Confirm worker registration Google Form URL is added.
- Test one single-attendee registration.
- Test one multi-attendee registration with different seminar and meal preferences.
- Test Pay Later flow.
- Test pending Square/payment flow.
- Test check-in payment collection.

## Remaining pre-go-live checks

- Confirm Fluent Forms payment metadata amount format is interpreted correctly (cents vs dollars).
- Confirm multi-attendee Pay Later totals calculate as attendee count × current price when payload amount is absent.
- Confirm Square/card paid users keep the original pending action captured at submission time.
- Confirm `capacityFull` registration responses reroute to waitlist and do not dead-letter.
- Confirm `Config.SECRET` is populated before deployment.
- Confirm promo Max Uses cannot be exceeded under rapid concurrent submissions.
- Confirm transfer rejects blank new registrant required fields.
- Confirm confirmation emails safely render names/churches containing `&`, `<`, and `>`.

---

## IMSDA Registration Engine migration

Status of migrating WR26 from `plugin/wr26-registration.php` to `imsda-registration-engine/`.

### What already works with the engine

- Form submission capture and queue dispatch work correctly.
- Sessions 1 and 2 seminar preferences are parsed and forwarded.
- Capacity check and waitlist routing work.
- Square/Pay Later payment hold-and-release works.
- The standalone check-in PWA is fully functional.
- All GAS backend functions (register, waitlist, check-in, transfer, promo code validation) operate correctly when called with correct payloads.
- Event import/export works.

### What is broken or missing in the engine (as of 2026-05-14 audit)

All of the following must be fixed before the engine can replace the legacy plugin:

1. **Admin page data rendering** — 7 admin views (Registrations, Waitlist, Check-In stats/search/recent, Church Rosters, Promo Codes) never display data because the engine JS reads wrong response keys from GAS. See AUDIT-REPORT.md Sections 2.2–2.8.

2. **`save()` partial-update bug** — Regenerate Secret, Set Check-In PIN, and Generate Check-In Token AJAX actions silently fail; data is not persisted. See AUDIT-REPORT.md Section 4.1.

3. **`savePromoCode` key mismatch** — Creating or updating a promo code always fails with "Missing required fields" because the engine sends `discount_type`/`discount_amount` but GAS reads `discountType`/`discountAmount`. See AUDIT-REPORT.md Section 2.9.

4. **`checkinById` key mismatch** — Admin manual check-in by registration ID always fails because the engine sends `registration_id` but GAS reads `registrationId`. See AUDIT-REPORT.md Section 2.10.

5. **Edit and Transfer click handlers absent** — Buttons exist in the Registrations table but clicking them does nothing. See AUDIT-REPORT.md Section 1.2.

6. **Sessions 3 and 4 not parsed** — The WR26 form has 4 seminar session slots. The engine parser only handles sessions 1 and 2; sessions 3 and 4 are silently discarded. See AUDIT-REPORT.md Section 2.11.

7. **`worker_registration` field name** — The parser reads `$raw['worker_flag']` but the form field is named `worker_registration`. See AUDIT-REPORT.md Section 2.12.

### What to do first

Fix items 1 and 2 above first — they block all admin visibility and make the engine unusable for day-to-day operations. Item 1 requires updating 7 JS data-read paths to use the correct GAS response keys. Item 2 requires refactoring `save()` to support partial updates or adding a separate `update_partial()` method.

Once those are fixed, fix item 3 (promo code creation) and item 4 (manual check-in). Then implement items 5–7 before going live with the engine as the sole WR26 plugin.
