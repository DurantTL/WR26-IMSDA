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
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessionCookieName = 'wr26_session';
const sessionTtlSeconds = parseInt(process.env.SESSION_TTL_SECONDS || '43200', 10);
const syncIntervalMs = parseInt(process.env.PWA_SYNC_INTERVAL_MS || '60000', 10);
const minSyncRegistrations = parseInt(process.env.SYNC_MIN_REGISTRATIONS || '1', 10);

if (!gasUrl) console.warn('WR26_GAS_URL is not set. API calls will fail.');
if (!gasSecret) console.warn('WR26_GAS_SECRET is not set. GAS calls requiring secret will fail.');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set. Using an ephemeral secret.');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
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

const authUsers = loadAuthUsers();

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
  return signSession({ sub: user.username, roles: user.roles, iat: issuedAt, exp: issuedAt + sessionTtlSeconds });
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
  cache.attendeesByRegistrationId = new Map();
  cache.seminarPrefsByRegistrationId = new Map();

  cache.registrations.forEach((registration) => cache.byRegistrationId.set(String(registration.registrationId), registration));
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

app.post('/api/auth/login', noStore, loginRateLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!authUsers.length) return res.status(503).json({ success: false, error: 'No WR26 users are configured on the server' });
  const user = authUsers.find((candidate) => candidate.username === username);
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

app.post('/api/auth/logout', noStore, (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/sync/status', noStore, requireAuthenticated, async (_req, res) => {
  try {
    await ensureCacheReady();
    res.json({ success: true, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/sync/refresh', noStore, requireAuthenticated, async (_req, res) => {
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

app.get('/api/registrations', noStore, requireRole('registrar', 'checkin', 'payments', 'readonly'), async (req, res) => {
  try {
    await ensureCacheReady();
    res.json({ success: true, registrations: searchRegistrations(req.query.q, req.query), sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.get('/api/registration/:id', noStore, requireRole('registrar', 'checkin', 'payments', 'readonly'), async (req, res) => {
  try {
    await ensureCacheReady();
    const registration = cache.byRegistrationId.get(String(req.params.id));
    if (!registration) return res.status(404).json({ success: false, error: 'Registration not found' });
    res.json({ success: true, registration: attachDetails(registration), sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/registration/:id', noStore, requireRole('registrar'), async (req, res) => {
  try {
    const payload = await gasRequest('portalAdminSaveRegistration', {
      registrationId: req.params.id,
      fields: req.body.fields || {},
      attendees: Array.isArray(req.body.attendees) ? req.body.attendees : [],
      adminUser: req.session.sub,
    });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/payment', noStore, requireRole('payments', 'registrar', 'checkin'), async (req, res) => {
  try {
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

app.post('/api/check-in', noStore, requireRole('checkin', 'registrar'), async (req, res) => {
  try {
    const payload = await gasRequest('checkinById', { registrationId: req.body.registrationId, adminUser: req.session.sub });
    if (payload.success) await refreshCache(true);
    res.status(payload.success ? 200 : 400).json({ ...payload, sync: getSyncMeta() });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message, sync: getSyncMeta() });
  }
});

app.post('/api/magic-link/request', noStore, rateLimit({ windowMs: 60 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  try {
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

app.post('/api/magic-link/registration', noStore, async (req, res) => {
  try {
    const payload = await gasRequest('portalGetRegistrationByMagicToken', { token: req.body.token }, false);
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

app.post('/api/magic-link/save', noStore, async (req, res) => {
  try {
    const payload = await gasRequest('portalSaveRegistrationByMagicToken', {
      token: req.body.token,
      fields: req.body.fields || {},
      attendees: Array.isArray(req.body.attendees) ? req.body.attendees : [],
    }, false);
    if (payload.success) await refreshCache(true).catch(() => {});
    res.status(payload.success ? 200 : 400).json(payload);
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

function htmlHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
}

app.use('/app', express.static(path.join(__dirname, 'public'), { setHeaders: htmlHeaders }));
app.use('/', express.static(path.join(__dirname, 'public'), { setHeaders: htmlHeaders }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), sync: getSyncMeta() });
});

app.listen(port, async () => {
  console.log(`WR26 PWA server running on port ${port}`);
  console.log(`  App: http://localhost:${port}/app`);
  if (gasUrl) {
    try {
      await refreshCache(true);
      console.log(`Initial WR26 sync complete at ${cache.lastSyncAt}`);
    } catch (error) {
      console.error('Initial WR26 sync failed:', error.message);
    }
    setInterval(() => refreshCache(false).catch((error) => console.error('Background WR26 sync failed:', error.message)), syncIntervalMs);
  }
});
