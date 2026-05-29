# PWA Server

A minimal static file server that serves the IMSDA PWA shell with a service
worker and offline support.

## Purpose

This is a lightweight alternative to the full registration engine, useful for
serving a static PWA shell or as a deployment smoke test. It does **not** include
registration, payments, seminars, or admin features — for the full platform use
[`../imsda-registration-engine`](../imsda-registration-engine/README.md).

## Quick Start

```bash
npm install
npm start
```

## Files

- `server.js` — Express static server
- `public/manifest.json` — PWA manifest
- `public/sw.js` — service worker (offline caching)
- `public/offline.html` — offline fallback page

## When to use

- Verifying PWA installability / offline behavior in isolation
- A placeholder/landing shell before the full engine is deployed

For the production registration platform, deploy the registration engine instead
(see the [root README](../README.md)).

## License

Proprietary — IMSDA internal use.
