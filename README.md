# Women's Retreat 2026 Registration System (WR26)

## 1) Quick start
1. Create a Google Sheet with tabs and columns exactly as listed below.
2. Copy files in `/gas` to Apps Script (`clasp push`) and deploy Web App.
3. Activate WP plugin at `plugin/wr26-registration.php`.
4. In WR26 settings, set GAS URL, Fluent Form ID, Edit Registration Page URL.
5. Copy `wr26_gas_secret` from WP settings into Config sheet `SECRET`.

## 2) Google Sheet setup (tabs + exact headers)
- **Registrations**: Registration ID, Timestamp, First Name, Last Name, Email, Phone, Church, Housing Option, Arrival Date, Departure Date, Dietary Needs, Emergency Contact Name, Emergency Contact Phone, Special Needs, Promo Code, Discount Amount, Original Amount, Final Amount, Payment Method, Payment Status, Square Payment ID, FF Entry ID, Status, Transfer Notes, Checked In, Check-In Time, Check-In By, QR Token, Edit Token, Admin Notes.
- **Waitlist**: Waitlist ID, Timestamp, First Name, Last Name, Email, Phone, Church, Housing Option, FF Entry ID, Status, Position, Promoted At, Notes.
- **Housing**: optionId, optionName, pricePerNight, totalCapacity, available, reserved1, reserved2, reserved3, isUnlimited, minNights, description, status.
- **PromoCodes**: Code, Description, Discount Type, Discount Amount, Max Uses, Current Uses, Expiry Date, Active, Min Purchase.
- **TransferLog**: Transfer ID, Timestamp, Original Reg ID, New Reg ID, Original Name, New Name, Original Email, New Email, Reason, Refund Notes, Admin Notes, Transferred By.
- **CheckIns**: Check-In ID, Timestamp, Registration ID, Name, Church, Method, Admin User.
- **Config**: Key, Value.

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
- Housing: `housing_option` or `housing`
- Arrival/Departure: `arrival_date`, `departure_date`
- Dietary: `dietary_needs`
- Emergency: `emergency_contact_name`, `emergency_contact_phone`
- Special needs: `special_needs`
- Promo: `promo_code`, `discount_code`, `coupon_code`, `coupon`
- Payment method: `payment_method`, `payment`, `pay_method`

## 6) Shortcodes
- `[wr_availability]`
- `[wr_availability_banner]`
- `[wr_edit_registration]`

## 7) Edit registration page setup
Create WP page, place `[wr_edit_registration]`, copy full URL into WR26 Settings → Edit Registration Page URL.

## 8) Promo code walkthrough
WR26 Promo tab → New Promo Code → define code/type/amount/max uses/min purchase/expiry/active → Save.

## 9) Transfer process
Registrations tab → Transfer on active row → fill new registrant + reason/refund/admin notes → save.

## 10) Waitlist workflow
When full, queue action becomes `waitlist`; promote/remove from Waitlist tab; promotion creates registration + email.

## 11) Check-in day guide
Use Check-In tab QR scanner (camera) first; if needed use manual search and check-in by ID.

## 12) Deployment notes
`clasp push` then create new deployment URL; update WP `wr26_gas_url` after every redeploy URL change.

## 13) Troubleshooting
- Unauthorized: ensure WP secret equals Config SECRET.
- No sync: run queue manually from dashboard action.
- Wrong form: verify `wr26_form_id`.
- Missing edit links: verify Edit Registration Page URL in WP settings.
