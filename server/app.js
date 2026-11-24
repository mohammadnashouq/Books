// The HTTP API (and, in production, the built frontend).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import {
  dummyVerify,
  hashPassword,
  newSessionToken,
  usernameKey,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth.js';
import * as repo from './repo.js';
import { validateBook } from './validate.js';

export const SESSION_COOKIE = 'books_session';
/** Every state-changing request must carry this header. Browsers can't add a
 * custom header cross-site without a CORS preflight, which this server never
 * approves, so it blocks cross-site request forgery. */
export const CLIENT_HEADER = 'x-books-client';

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    const raw = part.slice(i + 1).trim();
    // A malformed cookie from another app on the same host must not break every request.
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/** Fixed-window limiter kept in memory (fine for a single server process). */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now();
      const entry = hits.get(key);
      if (!entry || t - entry.start >= windowMs) {
        hits.set(key, { start: t, count: 1 });
        if (hits.size > 10_000) {
          for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        }
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/**
 * Build the Express app.
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {boolean} [options.secureCookies] set the Secure flag (production, behind HTTPS)
 * @param {string}  [options.staticDir] serve the built frontend from here
 * @param {boolean|number|string} [options.trustProxy] Express "trust proxy" setting
 */
export function createApp({ db, secureCookies = false, staticDir, trustProxy = false, passwordParams } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
  const ipLimiter = createRateLimiter({ limit: 100, windowMs: 15 * 60 * 1000 });

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Frame-Options': 'DENY',
    });
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '25mb' }));

  // Look up the session on every API request.
  api.use((req, res, next) => {
    req.sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    req.user = repo.userForSession(db, req.sessionToken);
    res.set('Cache-Control', 'no-store');
    next();
  });

  // CSRF guard for anything that changes state.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get(CLIENT_HEADER) !== '1') return res.status(403).json({ error: 'Missing client header.' });
    return next();
  });

  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    return next();
  };

  function startSession(res, userId) {
    const token = newSessionToken();
    const expires = repo.createSession(db, userId, token);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      expires,
    });
  }

  function limited(req, res, username) {
    const ipOk = ipLimiter.hit(req.ip);
    const nameOk = loginLimiter.hit(`${req.ip}|${usernameKey(String(username ?? ''))}`);
    if (ipOk && nameOk) return false;
    res.set('Retry-After', '900');
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return true;
  }

  // ---------- Accounts ----------

  api.post('/auth/register', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (limited(req, res, username)) return;
    const error = validateUsername(username) || validatePassword(password);
    if (error) return res.status(400).json({ error });
    const passwordHash = await hashPassword(password, passwordParams);
    const user = repo.createUser(db, { username: username.trim(), usernameKey: usernameKey(username), passwordHash });
    if (!user) return res.status(409).json({ error: 'That username is taken.' });
    startSession(res, user.id);
    return res.status(201).json({ user });
  });

  api.post('/auth/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (limited(req, res, username)) return;
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 1000) {
      return res.status(400).json({ error: 'Enter your username and password.' });
    }
    const row = repo.findUserByKey(db, usernameKey(username));
    const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify(password);
    if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
    loginLimiter.reset(`${req.ip}|${usernameKey(username)}`);
    startSession(res, row.id);
    return res.json({ user: { id: row.id, username: row.username } });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) repo.deleteSession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies });
    res.status(204).end();
  });

  api.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  // ---------- Reading (everyone) ----------

  api.get('/books', (req, res) => {
    res.json({ books: repo.listPublicBooks(db) });
  });

  api.get('/books/:id', (req, res) => {
    const book = repo.getBook(db, req.params.id, req.user?.id);
    if (!book) return res.status(404).json({ error: 'Book not found.' });
    return res.json({ book });
  });

  // ---------- Writing (owner only) ----------

  api.get('/me/books', requireUser, (req, res) => {
    res.json({ books: repo.listOwnBooks(db, req.user.id) });
  });

  api.put('/me/books/:id', requireUser, (req, res) => {
    const { book: raw, baseRevision = null } = req.body ?? {};
    if (baseRevision !== null && !Number.isInteger(baseRevision)) {
      return res.status(400).json({ error: 'baseRevision must be a whole number or null.' });
    }
    const { book, error } = validateBook(raw, req.params.id);
    if (error) return res.status(400).json({ error });
    const result = repo.saveBook(db, req.user.id, book, baseRevision);
    if (result.forbidden) return res.status(403).json({ error: 'That book belongs to someone else.' });
    if (result.conflict) {
      return res.status(409).json({ error: 'This book was changed somewhere else.', current: result.current });
    }
    return res.json({ revision: result.revision });
  });

  api.delete('/me/books/:id', requireUser, (req, res) => {
    const raw = req.query.baseRevision;
    const baseRevision = raw === undefined ? null : Number(raw);
    if (baseRevision !== null && !Number.isInteger(baseRevision)) {
      return res.status(400).json({ error: 'baseRevision must be a whole number.' });
    }
    const result = repo.deleteBook(db, req.user.id, req.params.id, baseRevision);
    if (result.forbidden) return res.status(403).json({ error: 'That book belongs to someone else.' });
    if (result.conflict) {
      return res.status(409).json({ error: 'This book was changed somewhere else.', current: result.current });
    }
    return res.status(204).end();
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Malformed JSON, oversized bodies and unexpected errors.
  api.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That book is too large to save.' });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  app.use('/api', api);

  // ---------- Frontend ----------

  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(
      '/assets',
      express.static(join(staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(staticDir, { index: false, maxAge: 0 }));
    // Any other GET is a client-side route: serve the app.
    app.get(/.*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  return app;
}
