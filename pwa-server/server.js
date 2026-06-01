require('dotenv').config();

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const gasUrl = process.env.WR26_GAS_URL || process.env.GOOGLE_SCRIPT_URL || '';
const gasSecret = process.env.WR26_GAS_SECRET || process.env.GAS_SECRET || '';
const isProduction = process.env.NODE_ENV === 'production';
// In production an unset SESSION_SECRET would mean every restart silently logs
// all staff out (and breaks multi-instance). Fail fast instead of limping along.
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production. Refusing to start.');
  process.exit(1);
}
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessionCookieName = 'imsda_registration_session';
const sessionTtlSeconds = parseInt(process.env.SESSION_TTL_SECONDS || '43200', 10);
const syncIntervalMs = parseInt(process.env.PWA_SYNC_INTERVAL_MS || '60000', 10);
const minSyncRegistrations = parseInt(process.env.SYNC_MIN_REGISTRATIONS || '1', 10);
// Square webhook: lets a paid pay-later payment-link auto-mark the registration as
// paid. The signature key is the one Square shows for the webhook subscription;
// the notification URL must exactly match what's registered in Square (it's part
// of the signed payload). Both unset → the webhook is disabled and returns 503.
const squareWebhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
const squareWebhookUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || '';

if (!gasUrl) console.warn('WR26_GAS_URL is not set. API calls will fail.');
if (!gasSecret) console.warn('WR26_GAS_SECRET is not set. GAS calls requiring secret will fail.');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set. Using an ephemeral secret (development only).');

app.disable('x-powered-by');
// Behind a reverse proxy / Cloudflare in production, trust the first hop so req.ip
// (used for rate limiting and optional magic-link IP binding) is the real client,
// not the proxy. Override with TRUST_PROXY (integer hop count) if needed.
app.set('trust proxy', process.env.TRUST_PROXY != null ? Number(process.env.TRUST_PROXY) : (isProduction ? 1 : 0));

// Square's HMAC signature is computed over (notificationUrl + raw request body),
// so this route must see the EXACT bytes Square sent — register it with a raw body
// parser BEFORE express.json(), which would otherwise consume and re-serialize the
// body and break verification.
function verifySquareSignature(rawBody, signature, notificationUrl) {
  if (!squareWebhookSignatureKey || !signature || !notificationUrl) return false;
  const expected = crypto.createHmac('sha256', squareWebhookSignatureKey).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// createSquarePaymentLink_ (GAS) tags each link with payment_note "Ref: <regId>",
// which surfaces as the payment's `note`. Pull the registration id back out.
function registrationIdFromNote(note) {
  const match = String(note || '').match(/Ref:\s*([A-Za-z0-9._-]+)/);
  return match ? match[1] : '';
}

app.post('/api/square/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    if (!squareWebhookSignatureKey) {
      console.error('[square-webhook] SQUARE_WEBHOOK_SIGNATURE_KEY not set; rejecting delivery.');
      return res.status(503).json({ success: false, error: 'Webhook not configured' });
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const signature = req.get('x-square-hmacsha256-signature') || '';
    const notificationUrl = squareWebhookUrl || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    if (!verifySquareSignature(rawBody, signature, notificationUrl)) {
      console.warn('[square-webhook] signature verification failed; rejecting.');
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    let event;
    try { event = JSON.parse(rawBody || '{}'); } catch (_error) { return res.status(400).json({ success: false, error: 'Invalid JSON' }); }
    // Act only on completed payments. Square sends payment.created then
    // payment.updated for the same payment; GAS dedupes by payment id so either
    // (or a retry) safely settles the balance exactly once.
    const type = String(event.type || '');
    const payment = event && event.data && event.data.object && event.data.object.payment;
    if ((type === 'payment.created' || type === 'payment.updated') && payment) {
      const status = String(payment.status || '').toUpperCase();
      if (status === 'COMPLETED' || status === 'APPROVED') {
        const registrationId = registrationIdFromNote(payment.note);
        const cents = payment.amount_money && Number(payment.amount_money.amount);
        const amountPaid = Number.isFinite(cents) ? cents / 100 : 0;
        if (registrationId && amountPaid > 0) {
          try {
            const result = await gasRequest('recordSquareLinkPayment', {
              registrationId,
              amountPaid,
              squarePaymentId: String(payment.id || ''),
              squareOrderId: String(payment.order_id || ''),
              source: 'square-webhook',
            });
            if (result && result.success && !result.alreadyRecorded) await refreshCache(true).catch(() => {});
          } catch (error) {
            // Let Square retry (its idempotency-safe on our side) rather than
            // silently dropping a real payment on a transient GAS outage.
            console.error('[square-webhook] recordSquareLinkPayment failed:', error.message);
            return res.status(502).json({ success: false, error: 'Upstream error' });
          }
        } else {
          console.warn('[square-webhook] completed payment missing registration ref or amount; nothing to reconcile.');
        }
      }
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[square-webhook] handler error:', error.message);
    res.status(500).json({ success: false });
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  // No inline scripts or styles; all assets are self-hosted.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; worker-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

function loadAuthUsers() {
  const raw = process.env.WR26_AUTH_USERS || process.env.CM26_AUTH_USERS || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((user) => user && user.username && user.password)
      .map((user) => ({
        username: String(user.username),
        password: String(user.password),
        roles: Array.isArray(user.roles) && user.roles.length ? user.roles.map(String) : ['registrar'],
      }));
  } catch (error) {
    console.error('Failed to parse WR26_AUTH_USERS:', error.message);
    return [];
  }
}

// Bootstrap admins from env — these always work even if the Staff sheet is empty,
// so an operator can never be locked out. They cannot be edited/deleted via the API.
const bootstrapUsers = loadAuthUsers();
const bootstrapUsernames = new Set(bootstrapUsers.map((u) => u.username.toLowerCase()));

// Staff loaded from the GAS Staff sheet (bcrypt hashes stored there). Refreshed
// from GAS periodically and after any change. Merged with bootstrap admins at
// lookup time, with bootstrap taking precedence.
let sheetUsers = [];
let sheetUsersLoadedAt = null;

async function refreshStaffUsers() {
  if (!gasUrl) return;
  try {
    const payload = await gasRequest('getStaffUsers');
    if (payload && payload.success && Array.isArray(payload.users)) {
      sheetUsers = payload.users
        .filter((u) => u && u.username && u.passwordHash && u.active !== false)
        .filter((u) => !bootstrapUsernames.has(String(u.username).toLowerCase()))
        .map((u) => ({ username: String(u.username), password: String(u.passwordHash), roles: Array.isArray(u.roles) && u.roles.length ? u.roles.map(String) : ['readonly'], email: String(u.email || '').trim().toLowerCase() }));
      sheetUsersLoadedAt = new Date().toISOString();
    }
  } catch (error) {
    console.error('Failed to load staff users from GAS:', error.message);
  }
}

function findAuthUser(username) {
  const key = String(username || '').toLowerCase();
  return bootstrapUsers.find((u) => u.username.toLowerCase() === key)
    || sheetUsers.find((u) => u.username.toLowerCase() === key)
    || null;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const trimmed = part.trim();
    if (!trimmed) return cookies;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return cookies;
    cookies[trimmed.slice(0, eqIndex)] = decodeURIComponent(trimmed.slice(eqIndex + 1));
    return cookies;
  }, {});
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const missing = padded.length % 4;
  return Buffer.from(missing ? padded + '='.repeat(4 - missing) : padded, 'base64').toString('utf8');
}

function signSession(payload) {
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${encoded}.${signature}`;
}

// Server-side revocation list for logged-out tokens. Sessions are stateless
// signed tokens, so logout records the token's jti here until its natural expiry.
// In-memory is sufficient (tokens also expire on their own); cleared on restart.
const revokedSessions = new Map();
function revokeSession(payload) {
  if (payload && payload.jti && payload.exp) revokedSessions.set(payload.jti, payload.exp);
}
function cleanupRevoked() {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of revokedSessions) if (exp < now) revokedSessions.delete(jti);
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.jti && revokedSessions.has(payload.jti)) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function getSession(req) {
  return verifySession(parseCookies(req)[sessionCookieName]);
}

function createSession(user) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signSession({ sub: user.username, roles: user.roles, iat: issuedAt, exp: issuedAt + sessionTtlSeconds, jti: crypto.randomBytes(8).toString('hex') });
}

function setSessionCookie(res, token) {
  const parts = [`${sessionCookieName}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${sessionTtlSeconds}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${sessionCookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuthenticated(req, res, next) {
  req.session = getSession(req);
  if (!req.session) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    req.session = getSession(req);
    if (!req.session) return res.status(401).json({ success: false, error: 'Authentication required' });
    const userRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    if (!userRoles.includes('admin') && !roles.some((role) => userRoles.includes(role))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    next();
  };
}

function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});

// Per-IP throttles for the rest of the API: generous for legitimate staff use
// during check-in, but enough to blunt enumeration/brute-force or a runaway client.
const apiReadLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests. Please slow down.' } });
const apiWriteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests. Please slow down.' } });
// Magic-link token resolution returns full registration PII keyed only by a bearer
// token, so it gets a much tighter per-IP budget than the general read limiter to
// curb token-guessing.
const magicTokenLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests. Please slow down.' } });
const staffMagicLinkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many login link requests. Try again later.' } });

const ONSITE_PAYMENT_METHODS = ['cash', 'check', 'square_onsite', 'other'];
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isFiniteNonNegative = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;
const validationError = (res, msg) => res.status(400).json({ success: false, error: msg });
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

async function gasRequest(action, payload = {}, includeSecret = true) {
  if (!gasUrl) throw new Error('WR26_GAS_URL is not configured');
  const body = { action, ...payload };
  if (includeSecret) body.secret = gasSecret;
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(parsed.message || parsed.error || 'GAS request failed');
  return parsed;
}

const cache = {
  registrations: [],
  attendees: [],
  seminarPreferences: [],
  waitlist: [],
  stats: {},
  paymentStats: {},
  byRegistrationId: new Map(),
  byQrToken: new Map(),
  attendeesByRegistrationId: new Map(),
  seminarPrefsByRegistrationId: new Map(),
  lastSyncAt: null,
  lastSyncError: null,
  syncPromise: null,
};

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function buildIndexes(snapshot) {
  const registrations = Array.isArray(snapshot.registrations) ? snapshot.registrations : [];
  if (cache.registrations.length >= minSyncRegistrations && registrations.length < minSyncRegistrations) {
    console.warn(`[sync] Skipping suspicious snapshot with ${registrations.length} registration(s). Keeping ${cache.registrations.length}.`);
    return;
  }

  cache.registrations = registrations;
  cache.attendees = Array.isArray(snapshot.attendees) ? snapshot.attendees : [];
  cache.seminarPreferences = Array.isArray(snapshot.seminarPreferences) ? snapshot.seminarPreferences : [];
  cache.waitlist = Array.isArray(snapshot.waitlist) ? snapshot.waitlist : [];
  cache.stats = snapshot.stats || {};
  cache.paymentStats = snapshot.paymentStats || {};
  cache.byRegistrationId = new Map();
  cache.byQrToken = new Map();
  cache.attendeesByRegistrationId = new Map();
  cache.seminarPrefsByRegistrationId = new Map();

  cache.registrations.forEach((registration) => {
    cache.byRegistrationId.set(String(registration.registrationId), registration);
    if (registration.qrToken) cache.byQrToken.set(String(registration.qrToken), registration);
  });
  cache.attendees.forEach((attendee) => {
    const id = String(attendee.registrationId || attendee.registration_id || '');
    if (!id) return;
    const list = cache.attendeesByRegistrationId.get(id) || [];
    list.push(attendee);
    cache.attendeesByRegistrationId.set(id, list);
  });
  cache.seminarPreferences.forEach((pref) => {
    const id = String(pref.registrationId || pref.registration_id || '');
    if (!id) return;
    const list = cache.seminarPrefsByRegistrationId.get(id) || [];
    list.push(pref);
    cache.seminarPrefsByRegistrationId.set(id, list);
  });
  cache.lastSyncAt = snapshot.syncedAt || new Date().toISOString();
}

function getSyncMeta() {
  return {
    lastSyncAt: cache.lastSyncAt,
    lastSyncError: cache.lastSyncError,
    registrationsCached: cache.registrations.length,
    attendeesCached: cache.attendees.length,
    seminarPrefsCached: cache.seminarPreferences.length,
    waitlistCached: cache.waitlist.length,
  };
}

async function refreshCache(force = false) {
  if (cache.syncPromise && !force) return cache.syncPromise;
  cache.syncPromise = (async () => {
    const snapshot = await gasRequest('portalGetCacheSnapshot');
    if (!snapshot.success) throw new Error(snapshot.message || snapshot.error || 'Sync failed');
    buildIndexes(snapshot);
    cache.lastSyncError = null;
    return getSyncMeta();
  })()
    .catch((error) => {
      cache.lastSyncError = error.message;
      throw error;
    })
    .finally(() => {
      cache.syncPromise = null;
    });
  return cache.syncPromise;
}

async function ensureCacheReady() {
  if (cache.registrations.length || cache.lastSyncAt) return;
  await refreshCache(false);
}

function attachDetails(registration) {
  const id = String(registration.registrationId || '');
  return {
    ...registration,
    attendees: cache.attendeesByRegistrationId.get(id) || [],
    seminarPreferences: cache.seminarPrefsByRegistrationId.get(id) || [],
  };
}

function searchRegistrations(query, filters = {}) {
  const q = normalizeText(query);
  const status = normalizeText(filters.status);
  const payment = normalizeText(filters.paymentStatus);
  const checkedIn = normalizeText(filters.checkedIn);
  return cache.registrations
    .filter((registration) => {
      if (status && normalizeText(registration.status) !== status) return false;
      if (payment && normalizeText(registration.paymentStatus) !== payment) return false;
      if (checkedIn && normalizeText(registration.checkedIn) !== checkedIn) return false;
      if (!q) return true;
      const id = String(registration.registrationId || '');
      const attendees = cache.attendeesByRegistrationId.get(id) || [];
      const haystack = [
        registration.registrationId,
        registration.qrToken,
        registration.firstName,
        registration.lastName,
        registration.email,
        registration.phone,
        registration.church,
        registration.paymentStatus,
        ...attendees.flatMap((a) => [a.first_name, a.last_name, a.email, a.phone, a.church, a.meal_preference, a.dietary_needs]),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 200)
    .map((registration) => ({
      ...registration,
      attendeeCount: (cache.attendeesByRegistrationId.get(String(registration.registrationId)) || []).length,
      seminarPreferenceCount: (cache.seminarPrefsByRegistrationId.get(String(registration.registrationId)) || []).length,
    }));
}

function resolveScannedRegistration(scanValue) {
  const raw = String(scanValue || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  try {
    const parsedUrl = new URL(raw);
    ['registrationId', 'regId', 'id', 'token', 'qrToken'].forEach((key) => {
      const val = parsedUrl.searchParams.get(key);
      if (val) candidates.push(val);
    });
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    pathParts.forEach((part) => candidates.push(part));
  } catch (_error) {}
  for (const candidate of candidates) {
    if (cache.byRegistrationId.has(String(candidate))) return cache.byRegistrationId.get(String(candidate));
    if (cache.byQrToken.has(String(candidate))) return cache.byQrToken.get(String(candidate));
  }
  const lowered = raw.toLowerCase();
  return cache.registrations.find((r) => String(r.registrationId || '').toLowerCase() === lowered || String(r.qrToken || '').toLowerCase() === lowered) || null;
}

app.post('/api/auth/login', noStore, loginRateLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!bootstrapUsers.length && !sheetUsers.length) return res.status(503).json({ success: false, error: 'No IMSDA Registration users are configured on the server' });
  const user = findAuthUser(username);
  const passwordMatch = user ? await bcrypt.compare(password, user.password) : false;
  if (!user || !passwordMatch) return res.status(401).json({ success: false, error: 'Invalid username or password' });
  const token = createSession(user);
  setSessionCookie(res, token);
  res.json({ success: true, user: { username: user.username, roles: user.roles } });
});

app.get('/api/auth/me', noStore, (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ success: false, error: 'Not signed in' });
  res.json({ success: true, user: { username: session.sub, roles: session.roles } });
});

app.post('/api/auth/logout', noStore, (req, res) => {
  const session = getSession(req);
  if (session) revokeSession(session);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/magic-link/request', noStore, staffMagicLinkLimiter, async (req, res) => {
  try {
    if (!isValidEmail(req.body.email)) return validationError(res, 'A valid email address is required');
    const appUrl = `${req.protocol}://${req.get('host')}/app/`;
    await gasRequest('staffRequestMagicLink', { email: req.body.email, appUrl, requestIp: req.ip });
    res.json({ success: true, message: 'If a staff account exists for that email, a login link has been sent.' });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/magic-link/verify', noStore, magicTokenLimiter, async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.token)) return validationError(res, 'token is required');
    const gasPayload = await gasRequest('staffValidateMagicToken', { token: req.body.token, requestIp: req.ip });
    if (!gasPayload.success) return res.status(400).json({ success: false, error: gasPayload.message || 'Invalid or expired login link.' });
    await refreshStaffUsers();
    const user = findAuthUser(gasPayload.username);
    if (!user) return res.status(400).json({ success: false, error: 'Staff account not found.' });
    const token = createSession(user);
    setSessionCookie(res, token);
    res.json({ success: true, user: { username: user.username, roles: user.roles } });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.get('/api/sync/status', noStore, requireAuthenticated, async (_req, res) => {
  try {
    await ensureCacheReady();
    res.json({ success: true, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/sync/refresh', noStore, apiWriteLimiter, requireAuthenticated, async (_req, res) => {
  try {
    const sync = await refreshCache(true);
    res.json({ success: true, sync });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.get('/api/bootstrap', noStore, requireAuthenticated, async (_req, res) => {
  try {
    await ensureCacheReady();
    res.json({ success: true, sync: getSyncMeta(), stats: cache.stats, paymentStats: cache.paymentStats });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.get('/api/registrations', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'payments', 'readonly'), async (req, res) => {
  try {
    await ensureCacheReady();
    res.json({ success: true, registrations: searchRegistrations(req.query.q, req.query), sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.get('/api/registration/:id', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'payments', 'readonly'), async (req, res) => {
  try {
    await ensureCacheReady();
    const registration = cache.byRegistrationId.get(String(req.params.id));
    if (!registration) return res.status(404).json({ success: false, error: 'Registration not found' });
    res.json({ success: true, registration: attachDetails(registration), sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.get('/api/scan/:value', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'readonly'), async (req, res) => {
  try {
    await ensureCacheReady();
    const registration = resolveScannedRegistration(req.params.value);
    if (!registration) return res.status(404).json({ success: false, error: 'No registration found for this QR code' });
    res.json({ success: true, registration: attachDetails(registration), sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/registration/:id', noStore, apiWriteLimiter, requireRole('registrar'), async (req, res) => {
  try {
    const fields = req.body.fields;
    if (fields !== undefined && (typeof fields !== 'object' || Array.isArray(fields) || fields === null)) return validationError(res, 'fields must be an object');
    if (req.body.attendees !== undefined && !Array.isArray(req.body.attendees)) return validationError(res, 'attendees must be an array');
    if (Array.isArray(req.body.attendees) && req.body.attendees.length > 5) return validationError(res, 'A registration can have at most 5 attendees');
    const payload = await gasRequest('portalAdminSaveRegistration', {
      registrationId: req.params.id,
      fields: fields || {},
      attendees: Array.isArray(req.body.attendees) ? req.body.attendees : [],
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/payment', noStore, apiWriteLimiter, requireRole('payments', 'registrar', 'checkin'), async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.registrationId)) return validationError(res, 'registrationId is required');
    if (!isFiniteNonNegative(req.body.amountPaid)) return validationError(res, 'amountPaid must be a non-negative number');
    if (req.body.paymentMethod && !ONSITE_PAYMENT_METHODS.includes(String(req.body.paymentMethod).toLowerCase())) {
      return validationError(res, `paymentMethod must be one of: ${ONSITE_PAYMENT_METHODS.join(', ')}`);
    }
    const payload = await gasRequest('recordPayment', {
      registrationId: req.body.registrationId,
      paymentMethod: req.body.paymentMethod,
      amountPaid: Number(req.body.amountPaid || 0),
      checkNumber: req.body.checkNumber || '',
      paymentNotes: req.body.paymentNotes || '',
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/refund', noStore, apiWriteLimiter, requireRole('payments', 'registrar'), async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.registrationId)) return validationError(res, 'registrationId is required');
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return validationError(res, 'amount must be a positive number');
    const payload = await gasRequest('recordRefund', {
      registrationId: req.body.registrationId,
      amount,
      method: req.body.method || 'other',
      reason: req.body.reason || '',
      refundNotes: req.body.refundNotes || '',
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/transfer', noStore, apiWriteLimiter, requireRole('registrar'), async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.registrationId)) return validationError(res, 'registrationId is required');
    if (!isNonEmptyString(req.body.newFirstName) || !isNonEmptyString(req.body.newLastName)) return validationError(res, 'newFirstName and newLastName are required');
    if (!isValidEmail(req.body.newEmail)) return validationError(res, 'A valid newEmail is required');
    const payload = await gasRequest('transferRegistration', {
      registrationId: req.body.registrationId,
      newFirstName: req.body.newFirstName,
      newLastName: req.body.newLastName,
      newEmail: req.body.newEmail,
      newPhone: req.body.newPhone || '',
      newChurch: req.body.newChurch || '',
      reason: req.body.reason || '',
      refundNotes: req.body.refundNotes || '',
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

// Public, unauthenticated list of active seminars (titles only) so the registrant
// portal and worker page can build seminar dropdowns that match what's assignable.
// Read-only and rate-limited; exposes no PII.
app.get('/api/seminars/public', noStore, apiReadLimiter, async (_req, res) => {
  try {
    const payload = await gasRequest('getSeminars');
    const seminars = (payload && Array.isArray(payload.seminars) ? payload.seminars : [])
      .filter((s) => s && s.active !== false && String(s.title || '').trim())
      .map((s) => ({ slot: s.slot, title: s.title }));
    res.json({ success: true, seminars });
  } catch (error) {
    // Degrade gracefully — the client falls back to built-in option values.
    res.json({ success: true, seminars: [] });
  }
});

app.get('/api/seminars', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'payments', 'readonly'), async (_req, res) => {
  try {
    const payload = await gasRequest('getSeminars');
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/seminars', noStore, apiWriteLimiter, requireRole('registrar'), async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.slot) || !isNonEmptyString(req.body.title)) return validationError(res, 'slot and title are required');
    if (req.body.capacity !== undefined && !isFiniteNonNegative(req.body.capacity)) return validationError(res, 'capacity must be a non-negative number');
    const payload = await gasRequest('saveSeminar', {
      slot: req.body.slot,
      title: req.body.title,
      slotLabel: req.body.slotLabel || '',
      capacity: Number(req.body.capacity || 0),
      active: req.body.active === undefined ? true : req.body.active,
      notes: req.body.notes || '',
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/seminars/assign', noStore, apiWriteLimiter, requireRole('registrar'), async (req, res) => {
  try {
    const payload = await gasRequest('assignSeminars', { dryRun: !!req.body.dryRun, adminUser: req.session.sub });
    if (payload.success && !req.body.dryRun) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.get('/api/seminars/roster', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'readonly'), async (req, res) => {
  try {
    const payload = await gasRequest('getSeminarRoster', { slot: req.query.slot || '', title: req.query.title || '' });
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

// Per-church roster, grouped from the live cache (no extra GAS round-trip).
app.get('/api/church-rosters', noStore, apiReadLimiter, requireRole('registrar', 'checkin', 'readonly'), async (_req, res) => {
  try {
    await ensureCacheReady();
    const groups = new Map();
    cache.registrations.forEach((r) => {
      if (String(r.status || '').toLowerCase() !== 'active') return;
      const church = (r.church && String(r.church).trim()) || 'Unspecified';
      const id = String(r.registrationId);
      const attendees = cache.attendeesByRegistrationId.get(id) || [];
      const list = groups.get(church) || [];
      list.push({
        registrationId: r.registrationId,
        primaryName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        email: r.email,
        phone: r.phone,
        paymentStatus: r.paymentStatus,
        checkedIn: r.checkedIn,
        attendees: attendees.map((a) => ({ name: `${a.first_name || ''} ${a.last_name || ''}`.trim(), mealPreference: a.meal_preference, phone: a.phone })),
      });
      groups.set(church, list);
    });
    const rosters = [...groups.keys()].sort().map((church) => ({
      church,
      registrationCount: groups.get(church).length,
      attendeeCount: groups.get(church).reduce((sum, m) => sum + (m.attendees.length || 1), 0),
      members: groups.get(church),
    }));
    res.json({ success: true, rosters, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/reminders/pending-charges', noStore, apiWriteLimiter, requireRole('payments', 'registrar'), async (req, res) => {
  try {
    const payload = await gasRequest('sendPendingChargeReminders', {
      dryRun: !!req.body.dryRun,
      registrationId: req.body.registrationId || '',
      adminUser: req.session.sub,
    });
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

// Staff user management (admin only). Passwords are bcrypt-hashed here so the GAS
// Staff sheet never receives plaintext. Bootstrap (env) admins are read-only.
const STAFF_ROLES = ['admin', 'registrar', 'payments', 'checkin', 'readonly'];

app.get('/api/staff', noStore, apiReadLimiter, requireRole('admin'), async (_req, res) => {
  try {
    await refreshStaffUsers();
    const sheetList = sheetUsers.map((u) => ({ username: u.username, roles: u.roles, email: u.email || '', source: 'sheet', editable: true }));
    const bootstrapList = bootstrapUsers.map((u) => ({ username: u.username, roles: u.roles, email: '', source: 'bootstrap', editable: false }));
    res.json({ success: true, users: [...bootstrapList, ...sheetList], loadedAt: sheetUsersLoadedAt });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/staff', noStore, apiWriteLimiter, requireRole('admin'), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) return validationError(res, 'username must be 2–40 chars: letters, numbers, . _ -');
    if (bootstrapUsernames.has(username)) return validationError(res, 'That username is a server-configured admin and cannot be edited here');
    const roles = Array.isArray(req.body.roles) ? req.body.roles.map((r) => String(r).toLowerCase()) : [];
    const invalid = roles.filter((r) => !STAFF_ROLES.includes(r));
    if (invalid.length) return validationError(res, `Unknown role(s): ${invalid.join(', ')}. Valid: ${STAFF_ROLES.join(', ')}`);
    const password = req.body.password === undefined ? '' : String(req.body.password);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (email && !isValidEmail(email)) return validationError(res, 'Invalid email address');
    // Password required on create; optional on update (omit to keep existing).
    let passwordHash;
    if (password) {
      if (password.length < 8) return validationError(res, 'Password must be at least 8 characters');
      passwordHash = await bcrypt.hash(password, 10);
    }
    const payload = await gasRequest('saveStaffUser', {
      username,
      passwordHash,
      roles: roles.length ? roles : ['readonly'],
      active: req.body.active === undefined ? true : !!req.body.active,
      notes: req.body.notes || '',
      email: email || undefined,
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshStaffUsers();
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/staff/deactivate', noStore, apiWriteLimiter, requireRole('admin'), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    if (!username) return validationError(res, 'username is required');
    if (bootstrapUsernames.has(username)) return validationError(res, 'Server-configured admins cannot be deactivated here');
    if (username === String(req.session.sub).toLowerCase()) return validationError(res, 'You cannot deactivate your own account');
    const payload = await gasRequest('deactivateStaffUser', { username, adminUser: req.session.sub });
    if (payload.success) await refreshStaffUsers();
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

// Normalize and bound a worker registration body from either the public page or
// the staff panel. Returns { error } or { payload } ready for GAS.
function buildWorkerPayload(body) {
  const first = String(body.first_name || body.firstName || '').trim();
  const last = String(body.last_name || body.lastName || '').trim();
  const email = String(body.email || '').trim();
  if (!first || !last) return { error: 'First and last name are required' };
  if (!isValidEmail(email)) return { error: 'A valid email is required' };
  let attendees = Array.isArray(body.attendees) ? body.attendees : [];
  if (attendees.length > 5) return { error: 'A worker registration can have at most 5 attendees' };
  attendees = attendees.slice(0, 5);
  return {
    payload: {
      first_name: first,
      last_name: last,
      email,
      phone: String(body.phone || '').trim(),
      church: String(body.church || '').trim(),
      worker_role: String(body.worker_role || body.role || '').trim(),
      meal_preference: String(body.meal_preference || '').trim(),
      dietary_needs: String(body.dietary_needs || '').trim(),
      special_needs: String(body.special_needs || '').trim(),
      emergency_contact_name: String(body.emergency_contact_name || '').trim(),
      emergency_contact_phone: String(body.emergency_contact_phone || '').trim(),
      seminar_preferences: body.seminar_preferences && typeof body.seminar_preferences === 'object' && !Array.isArray(body.seminar_preferences) ? body.seminar_preferences : {},
      attendees,
    },
  };
}

// Public self-serve worker (non-paying) registration. No login — replaces the
// external Google Form. Tightly rate-limited; the server holds the GAS secret so
// the browser never talks to GAS directly.
app.post('/api/worker/register', noStore, rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many worker registrations from this network. Please try again later.' } }), async (req, res) => {
  try {
    const built = buildWorkerPayload(req.body || {});
    if (built.error) return validationError(res, built.error);
    const payload = await gasRequest('workerRegister', built.payload);
    if (payload.success) await refreshCache(true).catch(() => {});
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

// Staff-added worker registration (signed in).
app.post('/api/worker/add', noStore, apiWriteLimiter, requireRole('registrar'), async (req, res) => {
  try {
    const built = buildWorkerPayload(req.body || {});
    if (built.error) return validationError(res, built.error);
    const payload = await gasRequest('workerRegister', { ...built.payload, adminUser: req.session.sub });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/check-in', noStore, apiWriteLimiter, requireRole('checkin', 'registrar'), async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.registrationId)) return validationError(res, 'registrationId is required');
    const payload = await gasRequest('checkinById', { registrationId: req.body.registrationId, adminUser: req.session.sub });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/offline-actions', noStore, apiWriteLimiter, requireRole('checkin', 'registrar', 'payments'), async (req, res) => {
  if (!Array.isArray(req.body.actions)) return validationError(res, 'actions must be an array');
  if (req.body.actions.length > 200) return validationError(res, 'Too many queued actions in one batch (max 200)');
  const actions = req.body.actions;
  const results = [];
  for (const action of actions) {
    try {
      if (action.type === 'check-in') {
        if (!isNonEmptyString(action.registrationId)) { results.push({ clientId: action.clientId, success: false, error: 'registrationId is required' }); continue; }
        const payload = await gasRequest('checkinById', { registrationId: action.registrationId, adminUser: req.session.sub });
        results.push({ clientId: action.clientId, success: !!payload.success, response: payload });
      } else if (action.type === 'payment') {
        // Mirror the same validation the online /api/payment route applies so a
        // malformed queued action can't be forwarded to GAS unchecked.
        if (!isNonEmptyString(action.registrationId)) { results.push({ clientId: action.clientId, success: false, error: 'registrationId is required' }); continue; }
        if (!isFiniteNonNegative(action.amountPaid)) { results.push({ clientId: action.clientId, success: false, error: 'amountPaid must be a non-negative number' }); continue; }
        if (action.paymentMethod && !ONSITE_PAYMENT_METHODS.includes(String(action.paymentMethod).toLowerCase())) { results.push({ clientId: action.clientId, success: false, error: `paymentMethod must be one of: ${ONSITE_PAYMENT_METHODS.join(', ')}` }); continue; }
        const payload = await gasRequest('recordPayment', { registrationId: action.registrationId, paymentMethod: action.paymentMethod, amountPaid: Number(action.amountPaid || 0), checkNumber: action.checkNumber || '', paymentNotes: action.paymentNotes || '', adminUser: req.session.sub });
        results.push({ clientId: action.clientId, success: !!payload.success, response: payload });
      } else {
        results.push({ clientId: action.clientId, success: false, error: 'Unsupported offline action type' });
      }
    } catch (error) {
      results.push({ clientId: action.clientId, success: false, error: error.message });
    }
  }
  if (results.some((result) => result.success)) await refreshCache(true).catch(() => {});
  res.json({ success: true, results, sync: getSyncMeta() });
});

app.post('/api/magic-link/request', noStore, rateLimit({ windowMs: 60 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many link requests. Please try again later.' } }), async (req, res) => {
  try {
    if (!isValidEmail(req.body.email)) return validationError(res, 'A valid email address is required');
    if (!isNonEmptyString(req.body.portalUrl)) return validationError(res, 'portalUrl is required');
    const payload = await gasRequest('portalRequestMagicLink', {
      email: req.body.email,
      portalUrl: req.body.portalUrl,
      purpose: 'registrant_edit',
      requestIp: req.ip,
    }, false);
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/magic-link/registration', noStore, magicTokenLimiter, async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.token)) return validationError(res, 'token is required');
    const payload = await gasRequest('portalGetRegistrationByMagicToken', { token: req.body.token, requestIp: req.ip }, false);
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/magic-link/save', noStore, apiWriteLimiter, async (req, res) => {
  try {
    if (!isNonEmptyString(req.body.token)) return validationError(res, 'token is required');
    if (req.body.fields !== undefined && (typeof req.body.fields !== 'object' || Array.isArray(req.body.fields) || req.body.fields === null)) return validationError(res, 'fields must be an object');
    if (req.body.attendees !== undefined && !Array.isArray(req.body.attendees)) return validationError(res, 'attendees must be an array');
    if (Array.isArray(req.body.attendees) && req.body.attendees.length > 5) return validationError(res, 'A registration can have at most 5 attendees');
    const payload = await gasRequest('portalSaveRegistrationByMagicToken', {
      token: req.body.token,
      requestIp: req.ip,
      fields: req.body.fields || {},
      attendees: Array.isArray(req.body.attendees) ? req.body.attendees : [],
    }, false);
    // Refresh the staff cache in the background so the registrant gets their
    // confirmation immediately instead of waiting on a full re-sync of all data.
    if (payload.success) refreshCache(true).catch(() => {});
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

function htmlHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function sendPortalPage(_req, res) {
  htmlHeaders(res);
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
}

app.get(/^\/portal\/$/, sendPortalPage);
app.get(/^\/portal$/, (_req, res) => res.redirect(302, '/portal/'));
app.get(/^\/manage\/?$/, (_req, res) => res.redirect(302, '/portal/'));

function sendWorkerPage(_req, res) {
  htmlHeaders(res);
  res.sendFile(path.join(__dirname, 'public', 'worker.html'));
}
app.get(/^\/worker\/$/, sendWorkerPage);
app.get(/^\/worker$/, (_req, res) => res.redirect(302, '/worker/'));

app.use('/app', express.static(path.join(__dirname, 'public'), { setHeaders: htmlHeaders }));
app.use('/', express.static(path.join(__dirname, 'public'), { setHeaders: htmlHeaders }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), sync: getSyncMeta() });
});

setInterval(cleanupRevoked, 10 * 60 * 1000);

app.listen(port, async () => {
  console.log(`IMSDA Registration PWA server running on port ${port}`);
  console.log(`  App: http://localhost:${port}/app`);
  if (gasUrl) {
    try {
      await refreshCache(true);
      console.log(`Initial IMSDA Registration sync complete at ${cache.lastSyncAt}`);
    } catch (error) {
      console.error('Initial IMSDA Registration sync failed:', error.message);
    }
    await refreshStaffUsers();
    console.log(`Staff users loaded: ${bootstrapUsers.length} bootstrap + ${sheetUsers.length} from sheet`);
    setInterval(() => refreshCache(false).catch((error) => console.error('Background IMSDA Registration sync failed:', error.message)), syncIntervalMs);
    setInterval(() => refreshStaffUsers().catch(() => {}), Math.max(syncIntervalMs, 60000));
  }
});
