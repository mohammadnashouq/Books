// Run the real API server (in-memory SQLite) for client tests, and build API
// clients that talk to it over real HTTP with their own cookie jar, like
// separate browsers.

import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/db.js';
import { createApi } from '../lib/api.js';

const FAST_HASH = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** A fetch that keeps cookies, and can be switched "offline". */
export function browserFetch() {
  const jar = new Map();
  /** gate: a promise every request waits for (a slow network); null = no wait. */
  const state = { offline: false, calls: [], gate: null };
  async function fetchImpl(url, init = {}) {
    state.calls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
    if (state.gate) await state.gate;
    if (state.offline) throw new TypeError('Failed to fetch');
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(url, { ...init, headers });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = pair.split('=');
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === '') jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    return res;
  }
  return { fetchImpl, state, jar };
}

export async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ db, passwordParams: FAST_HASH });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  /** A new "browser": its own cookies and offline switch. */
  function client() {
    const f = browserFetch();
    return { api: createApi({ baseUrl, fetchImpl: f.fetchImpl }), net: f.state, jar: f.jar };
  }

  return {
    db,
    baseUrl,
    client,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

const T0 = '2026-01-01T00:00:00.000Z';

export function makeBook(id, title, extra = {}) {
  return {
    id,
    title,
    genre: 'Fantasy',
    status: 'draft',
    goal: 1000,
    color: 'violet',
    createdAt: T0,
    updatedAt: T0,
    chapters: [{ id: `${id}-c1`, title: 'Opening', text: 'Once upon a time' }],
    comments: [
      {
        id: `${id}-m1`,
        chapterId: `${id}-c1`,
        author: 'writer',
        text: 'Tighten this',
        quote: '',
        resolved: false,
        createdAt: T0,
      },
    ],
    ...extra,
  };
}
