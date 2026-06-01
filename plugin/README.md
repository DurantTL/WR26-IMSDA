# WR26 Registration — WordPress plugins

This folder holds the WordPress side of the **Women's Retreat 2026** registration
system. Only two files are part of WR26:

| File | Activate? | What it does |
|---|---|---|
| **`wr26-registration.php`** | ✅ **Yes — required** | The main plugin. Bridges Fluent Forms submissions to the Google Apps Script backend (registration, waitlist, check-in), and provides the **WR26** admin menu including **GAS Tools**. |
| `wr26-registration-portal.php` | Optional | Companion portal: magic-link registrant editing + a staff registration manager. Does **not** replace the PWA staff app; it's a WordPress-hosted fallback. |

> The old `wr26-registration-gas-tools.php` shim was removed — GAS Tools is built
> into the main plugin (**WR26 → GAS Tools**), so no separate plugin is needed.

## `archive/` — other events (not WR26)

`archive/` contains full, unrelated plugins for **other IMSDA events**, kept here
only for reference. They are **not** part of the Women's Retreat system and nothing
in WR26 references them:

- `camp-meeting-integration.php`, `camp-meeting-2026-system-plan.md`, `cm-availability.js` — **Camp Meeting 2026**
- `man-camp-registration.php`, `man-camp-registration.js` — **Man Camp**

Don't activate these for the Women's Retreat.
