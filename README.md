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
- **Attendees** (recommended for attendee-level tracking): Attendee ID, Registration ID, First Name, Last Name, Phone, Email, Church, Adult/Child, Meal Preference, Dietary Needs, Childcare Needed, Seminar Preferences Complete, Notes.
- **SeminarPreferences** (recommended for seminar assignment workflow): Preference ID, Registration ID, Attendee ID, Attendee Name, Session Slot, Preference Rank, Seminar Title, Seminar ID, Assigned Seminar, Assignment Status, Notes.
- **Waitlist**: Waitlist ID, Timestamp, First Name, Last Name, Email, Phone, Church, FF Entry ID, Status, Position, Promoted At, Notes.
- **PromoCodes**: Code, Description, Discount Type, Discount Amount, Max Uses, Current Uses, Expiry Date, Active, Min Purchase.
- **TransferLog**: Transfer ID, Timestamp, Original Reg ID, New Reg ID, Original Name, New Name, Original Email, New Email, Reason, Refund Notes, Admin Notes, Transferred By.
- **CheckIns**: Check-In ID, Timestamp, Registration ID, Name, Church, Method, Admin User.
- **Config**: Key, Value.

After creating the housing-free sheet, add at least one row of test data to **Registrations** before testing the plugin to confirm column alignment.

## 4) Config rows
Set keys:
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
- `PAYMENT_DEFAULT=pay_later`
- `WORKER_REGISTRATION_URL`
- `CHILDCARE_ENABLED`
- `CHILDCARE_MINIMUM_CHILDREN`
- `CHILDCARE_MESSAGE`
- `SQUARE_FEE_ENABLED`
- `SQUARE_FEE_PERCENT`
- `SQUARE_FEE_FIXED`
- `SEMINAR_FULL_BEHAVIOR=allow_with_review`
- `SEMINAR_CAPACITY_DEFAULT`

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
Existing/common field names:
- Name: nested `first_name`, `last_name` (supports Name widget array)
- Email: `email`
- Phone: `phone`
- Church: `church`
- Arrival/Departure: `arrival_date`, `departure_date`
- Dietary: `dietary_needs`
- Emergency: `emergency_contact_name`, `emergency_contact_phone`
- Special needs: `special_needs`
- Promo: `promo_code`, `discount_code`, `coupon_code`, `coupon`
- Payment method: `payment_method`, `payment`, `pay_method`

Likely attendee repeater/nested fields (example naming):
- `attendees`
- `attendee_first_name`
- `attendee_last_name`
- `attendee_phone`
- `attendee_meal_preference`
- `attendee_dietary_needs`
- `attendee_childcare_needed`
- `attendee_session_preferences`

Important:
- Exact Fluent Forms keys must match your actual form configuration.
- If field names differ, update parser mappings before go-live.

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
- `[wr_edit_registration]`

## 14) Edit registration page setup
Create WP page, place `[wr_edit_registration]`, copy full URL into WR26 Settings → Edit Registration Page URL.

The edit registration page must be publicly accessible (do not require login). If the page is behind a membership wall or login redirect, token links in confirmation emails will send attendees to a login screen instead of their registration form.

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
`clasp push` then create new deployment URL; update WP `wr26_gas_url` after every redeploy URL change.

When creating the Web App deployment, set **Execute as: Me** and **Access: Anyone, even anonymous**. If Execute as is set to **User accessing the web app**, all requests will fail with a permissions error.

## 21) Troubleshooting
- Unauthorized: ensure WP secret equals Config SECRET.
- No sync: run queue manually from dashboard action.
- Wrong form: verify `wr26_form_id`.
- Missing edit links: verify Edit Registration Page URL in WP settings.
- Square payment delay: the `fluentform/payment_paid` hook only fires after Square's webhook confirms the charge, which can take 15–45 seconds after the registrant submits. The entry will not appear in the queue until that hook fires. This is expected behavior, not a bug.

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
