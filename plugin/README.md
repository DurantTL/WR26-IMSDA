# WR26 Registration — WordPress plugins

This folder holds the WordPress side of the **Women's Retreat 2026** registration
system. Only two files are part of WR26:

| File | Activate? | What it does |
|---|---|---|
| **`wr26-registration.php`** | ✅ **Yes — required** | The main plugin. Bridges Fluent Forms submissions to the Google Apps Script backend (registration, waitlist, check-in), and provides the **WR26** admin menu including **GAS Tools**. |
| `wr26-registration-portal.php` | Optional | Companion portal: magic-link registrant editing + a staff registration manager. Does **not** replace the PWA staff app; it's a WordPress-hosted fallback. |

> The old `wr26-registration-gas-tools.php` shim was removed — GAS Tools is built
> into the main plugin (**WR26 → GAS Tools**), so no separate plugin is needed.

## Troubleshooting: "GAS returned a non-JSON response" (HTTP 400)

If **WR26 → GAS Tools** (Ping or Send Fake Registration) returns something like:

```json
{ "success": false, "message": "...", "http_code": 400,
  "raw_body": "<!DOCTYPE html> ... Error 400 (Bad Request)!!1 ..." }
```

the HTML in `raw_body` is **Google's front-end error page**, not a reply from the
script. The request never reached Apps Script. This is almost always a
configuration problem, not a code bug:

1. **GAS URL is wrong or stale.** Open **WR26 → Settings → GAS URL**. It must be
   the deployed *Web app* URL ending in **`/exec`**
   (`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`). The editor URL,
   a `/dev` URL, or a truncated value all produce a Google 400. The GAS Tools
   **Connection Summary** now flags a URL that doesn't match this shape.
2. **Deployment is out of date.** In Apps Script: **Deploy → Manage deployments**,
   edit the Web app deployment, pick a **New version**, and deploy. Copy the
   resulting `/exec` URL back into Settings.
3. **Access too restricted.** Deploy with **Execute as: Me** and
   **Who has access: Anyone** (a sign-in page instead of JSON means this is wrong).

After fixing the URL/deployment, re-run **Ping GAS / Cache Snapshot** — a healthy
backend returns JSON with `"success": true`.

## `archive/` — other events (not WR26)

`archive/` contains full, unrelated plugins for **other IMSDA events**, kept here
only for reference. They are **not** part of the Women's Retreat system and nothing
in WR26 references them:

- `camp-meeting-integration.php`, `camp-meeting-2026-system-plan.md`, `cm-availability.js` — **Camp Meeting 2026**
- `man-camp-registration.php`, `man-camp-registration.js` — **Man Camp**

Don't activate these for the Women's Retreat.
