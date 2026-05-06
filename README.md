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

## 2) Google Sheet setup (tabs + exact headers)
- **Registrations**: Registration ID, Timestamp, First Name, Last Name, Email, Phone, Church, Arrival Date, Departure Date, Dietary Needs, Emergency Contact Name, Emergency Contact Phone, Special Needs, Promo Code, Discount Amount, Original Amount, Final Amount, Payment Method, Payment Status, Square Payment ID, FF Entry ID, Status, Transfer Notes, Checked In, Check-In Time, Check-In By, QR Token, Edit Token, Admin Notes.
- **Waitlist**: Waitlist ID, Timestamp, First Name, Last Name, Email, Phone, Church, FF Entry ID, Status, Position, Promoted At, Notes.
- **PromoCodes**: Code, Description, Discount Type, Discount Amount, Max Uses, Current Uses, Expiry Date, Active, Min Purchase.
- **TransferLog**: Transfer ID, Timestamp, Original Reg ID, New Reg ID, Original Name, New Name, Original Email, New Email, Reason, Refund Notes, Admin Notes, Transferred By.
- **CheckIns**: Check-In ID, Timestamp, Registration ID, Name, Church, Method, Admin User.
- **Config**: Key, Value.

After creating the housing-free sheet, add at least one row of test data to **Registrations** before testing the plugin to confirm column alignment.

## 3) Config rows
Set keys: `SECRET`, `ADMIN_EMAIL`, `NOTIFICATION_EMAIL`, `CAPACITY=350`, `EVENT_NAME`, `EVENT_DATES`, `EVENT_LOCATION`, `GAS_VERSION`.

## 4) WordPress setup
- Activate plugin.
- Open WR26 → Settings.
- Set `GAS URL`, `Form ID`, `Edit Registration Page URL`.
- Copy GAS secret to Config sheet.

## 5) Fluent Forms parser field names
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

## 6) Shortcodes
- `[wr_edit_registration]`

## 7) Edit registration page setup
Create WP page, place `[wr_edit_registration]`, copy full URL into WR26 Settings → Edit Registration Page URL.

The edit registration page must be publicly accessible (do not require login). If the page is behind a membership wall or login redirect, token links in confirmation emails will send attendees to a login screen instead of their registration form.

## 8) Promo code walkthrough
WR26 Promo tab → New Promo Code → define code/type/amount/max uses/min purchase/expiry/active → Save.

## 9) Transfer process
Registrations tab → Transfer on active row → fill new registrant + reason/refund/admin notes → save.

## 10) Waitlist workflow
When full, queue action becomes `waitlist`; promote/remove from Waitlist tab; promotion creates registration + email.

## 11) Check-in day guide
Use Check-In tab QR scanner (camera) first; if needed use manual search and check-in by ID.

## 12) On-site payment collection
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

## 13) Deployment notes
`clasp push` then create new deployment URL; update WP `wr26_gas_url` after every redeploy URL change.

When creating the Web App deployment, set **Execute as: Me** and **Access: Anyone, even anonymous**. If Execute as is set to **User accessing the web app**, all requests will fail with a permissions error.

## 14) Troubleshooting
- Unauthorized: ensure WP secret equals Config SECRET.
- No sync: run queue manually from dashboard action.
- Wrong form: verify `wr26_form_id`.
- Missing edit links: verify Edit Registration Page URL in WP settings.
- Square payment delay: the `fluentform/payment_paid` hook only fires after Square's webhook confirms the charge, which can take 15–45 seconds after the registrant submits. The entry will not appear in the queue until that hook fires. This is expected behavior, not a bug.
