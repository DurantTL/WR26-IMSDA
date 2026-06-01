# WR26 Registration Form — which file do I use?

**Import this one into Fluent Forms:**

```
wr26-registration-fluentforms.smart-payments.json
```

That is the **only** file you import. It is the complete registration form with the
chargeable Square payment item (`custom_payment_amount`) and the `a1_*` attendee
fields the WordPress plugin expects. Everything else in this folder is either the
source it's built from or documentation.

## What each file is

| File | Use it for |
|---|---|
| **`wr26-registration-fluentforms.smart-payments.json`** | ✅ **The form you import.** Generated, validated, charges $125/$145. |
| `wr26-registration-fluentforms.json` | Source/base form (no payment item). Only the generator reads this — you don't import it. |
| `SQUARE-SETUP.md` | Step-by-step Square + Fluent Forms setup (card at registration + pay-later links). |
| `WR26_FORM_JSON_REVIEW.md` | Field-by-field review notes for the form. |

## Regenerating the import file (only if you change the base or prices)

The import file is built from the base by a script, so don't hand-edit it:

```bash
node tools/patch-wr26-form-smart-payments.js
node tools/validate-wr26-form-json.js form/wr26-registration-fluentforms.smart-payments.json   # should print PASS
```

Prices live in the script (`EARLY_PRICE` / `REGULAR_PRICE`) and must match the GAS
Config sheet (`EARLY_BIRD_PRICE` / `REGULAR_PRICE`), currently **$125 / $145**. GAS
is the source of truth and re-checks the owed amount, so any drift is flagged, not
silently charged.
