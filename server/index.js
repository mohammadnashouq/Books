// Start the server: `npm start` (production) or `npm run dev:server`.
//
// Environment:
//   PORT           port to listen on (default 3001)
//   HOST           address to bind (default 127.0.0.1; use 0.0.0.0 in a container)
//   DATABASE_PATH  SQLite file (default ./data/books.sqlite)
//   NODE_ENV       "production" sets Secure cookies and serves ./dist
//   TRUST_PROXY    Express "trust proxy" value when behind a reverse proxy (e.g. 1)
//
// --serve-dist     also serve ./dist without production cookies (npm run preview)

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { deleteExpiredSessions } from './repo.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const dbPath = resolve(process.env.DATABASE_PATH || join(root, 'data', 'books.sqlite'));

function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const db = openDatabase(dbPath);
deleteExpiredSessions(db);
setInterval(() => deleteExpiredSessions(db), 6 * 3600 * 1000).unref();

const app = createApp({
  db,
  secureCookies: production,
  staticDir: production || process.argv.includes('--serve-dist') ? join(root, 'dist') : undefined,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
});

const server = app.listen(port, host, () => {
  console.log(`Books server on http://${host}:${port} (database: ${dbPath})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
