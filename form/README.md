# WR26 Registration Form — which file do I use?

**Import this one into Fluent Forms:**

```
wr26-registration-fluentforms.smart-payments.json
```

That is the **only** file you import. It is the complete registration form with the
chargeable Square payment item (`custom_payment_amount`) and the `a1_*` attendee
fields the WordPress plugin expects. Everything else in this folder is either the
source it's built from or documentation.

> **The live "Registration Summary" recalc runs from the plugin, not the form.**
> The form only contains the summary box markup. The script that recalculates the
> totals lives in `plugin/assets/wr26-form-summary.js` and is enqueued by the WR26
> plugin. It used to be embedded as a `<script>` inside the form's Custom HTML, but
> Fluent Forms strips `<script>` tags from Custom HTML — so the code rendered as
> visible text and the totals stayed at **$0.00**. Keep the WR26 plugin active or
> the summary will not update.

> **The attendee roster + seminar cards also run from the plugin.** The form
> includes a `#wr26-roster` mount point and three hidden fields
> (`attendees_json`, `seminar_counts_json`, `registration_roster_preview`); the
> interactive UI ships as `plugin/assets/wr26-roster.js` + `wr26-roster.css`.
> It collects an **uncapped** list of attendees and their ranked seminar choices,
> serializes them into `attendees_json`, and keeps `attendee_count` in sync so the
> summary and GAS price correctly. Per attendee it also captures **how many
> children need care** (shown only when "Childcare needed? = Yes" — we no longer
> ask for each child's name/age, just the count) and a **"Willing to volunteer to
> help?"** yes/no. Both flow through `attendees_json` → the plugin parser → GAS,
> which writes them to the new **Children Needing Care** and **Volunteer** columns
> on the Attendees sheet (run `wr26EnsureSheetSetup()` once to add the columns to
> an existing sheet). They also appear in the `registration_roster_preview` summary
> used by the admin notification and the registration PDF.
>
> **Arrival/Departure dates were removed** from the registration form (we don't
> need to know when people arrive/leave). The Sheets columns and the portal date
> fields remain so old records are undisturbed; confirmation emails now omit those
> lines when empty. If you ever re-add them, put them back in the base form and the
> validator's `requiredTopLevel` list, then regenerate.
>
> **Field order matters here.** The patch generator mounts `#wr26-roster`
> *directly above* the `Attendee 1` section, so the rich roster is the primary
> experience (right under Primary Contact) and the legacy `a1_*`–`a5_*` block sits
> *below* it as a collapsed fallback — followed in turn by the Payment section,
> whose chargeable payment item (`custom_payment_amount`) comes **before**
> `payment_method` so Square has a total to charge and Fluent Forms shows the
> payment options. The legacy `a1_*`–`a5_*` fields remain as a no-JavaScript
> fallback — the plugin parser prefers `attendees_json` when present. The
> generator gives that fallback full parity with the roster: each attendee also
> gets an `a{N}_childcare_children` count (shown only when `a{N}_childcare_needed`
> = Yes) and an `a{N}_volunteer` yes/no, so a registrant with JavaScript off can
> still report the child count and volunteer interest.
> Those legacy fields are **required**, so they are gated behind a hidden
> `roster_active` flag: the roster JS sets `roster_active=1`, which makes Fluent
> Forms hide them and skip their validation. With JavaScript off, `roster_active`
> stays empty, the legacy fields show (preceded by an "enter attendees manually"
> note), and they remain the fully-required fallback. The generator also enriches
> those legacy seminar dropdowns with the speaker name in each option label.
>
> Seminar cards show the session time, speaker, an expandable **description**
> (sourced from the plugin's `wr26_seminar_catalog()` / `tools/seminars-seed.csv`),
> and live availability via the plugin's `getSeminarAvailability` proxy (counts
> only — no attendee names).

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

Prices live in `plugin/assets/wr26-form-summary.js` (`EARLY_PRICE` / `REGULAR_PRICE`,
overridable via the plugin's `WR26_FORM_PRICING`) and must match the GAS Config sheet
(`EARLY_BIRD_PRICE` / `REGULAR_PRICE`), currently **$125 / $145**. GAS is the source
of truth and re-checks the owed amount, so any drift is flagged, not silently charged.
