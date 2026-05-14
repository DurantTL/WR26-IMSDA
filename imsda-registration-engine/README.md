# IMSDA Registration Engine

Unified multi-event registration plugin for IMSDA that replaces one-plugin-per-event deployments with one core engine and admin-managed event profiles.

## 1) What it does and why
This plugin centralizes registration dispatch, queueing, admin operations, and public shortcodes across multiple events (WR26/CM26/MC26/camporee patterns).

## 2) Installation
1. Copy `imsda-registration-engine` into `wp-content/plugins`.
2. Activate **IMSDA Registration Engine**.
3. Confirm cron schedule and queue options are created.

## 3) Add your first event
1. Go to **IMSDA Reg → Events**.
2. Create identity, GAS, form/payment, capacity/pricing, features, and field-map settings.
3. Save and copy the generated GAS secret into your GAS Config sheet.
4. Use Dashboard and shortcode pages to verify connectivity.

## 4) Import event profile
Use Events import (file upload or pasted JSON). A new GAS secret is always generated.

## 5) Export event profile
Export produces `{slug}-event-profile.json` without runtime counters and without GAS secret.

## 6) GAS secret
Copy immediately to GAS Config. Imported events always receive a new secret.

## 7) Field map reference
Default map includes first/last name, email, phone, church, dates, dietary/emergency/special needs, promo code, payment method, and attendee_count.

## 8) Fluent Forms naming
Match field names to default map where possible; otherwise customize map JSON per event.

## 9) Shortcodes
- `[imsda_availability event="wr26"]`
- `[imsda_availability_banner event="wr26"]`
- `[imsda_edit_registration event="wr26"]`

## 10) Queue system
Background queue processes every 5 minutes, retries failures up to max attempts, and stores failed entries for manual retry/dismiss.

## 11) Migration from per-event plugins
For each legacy plugin: copy settings → add event profile → test end-to-end → deactivate legacy plugin.

## 12) Troubleshooting
- Verify GAS URL and secret.
- Verify form ID mapping.
- Check Dashboard queue/failed lists.
- Run queue manually from admin AJAX action.
