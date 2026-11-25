// Pure helpers for syncing a signed-in user's library with the server.
//
// The browser keeps a per-user copy of the library ("the cache") alongside two
// maps per book id:
//   synced[id]    - hash of the book as the server last confirmed it
//   revisions[id] - the server revision that hash belongs to
// A book is "dirty" when its hash differs from synced[id]; an id in `synced`
// with no book is a delete that hasn't reached the server yet.

import { normalizeLibrary } from './storage.js';

export const CACHE_VERSION = 3;
export const cacheKey = (userId) => `books-app:user:${userId}:v${CACHE_VERSION}`;

/** Strip server-only fields so a server book compares equal to the local one. */
export function fromServer(book) {
  const { revision: _r, owner: _o, isOwner: _i, ...rest } = book;
  return rest;
}

/** cyrb53: a fast 53-bit string hash; collisions are vanishingly unlikely here. */
export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Hash of the fields the server stores, in a fixed order. */
export function hashBook(book) {
  return hashString(
    JSON.stringify([
      book.id,
      book.title,
      book.genre,
      book.status,
      book.goal,
      book.color,
      book.createdAt,
      book.updatedAt,
      book.chapters.map((c) => [c.id, c.title, c.text]),
      book.comments.map((c) => [c.id, c.chapterId, c.author, c.text, c.quote, c.resolved, c.createdAt]),
    ]),
  );
}

/** What has to be sent to the server. */
export function pendingChanges(books, synced) {
  const ids = new Set(books.map((b) => b.id));
  return {
    dirty: books.filter((b) => synced[b.id] !== hashBook(b)),
    deleted: Object.keys(synced).filter((id) => !ids.has(id)),
  };
}

export function serializeCache({ books, synced, revisions, losers = [], dismissed = [] }) {
  return JSON.stringify({ version: CACHE_VERSION, books, synced, revisions, losers, dismissed });
}

/** Parse a cache entry. Returns null when there is none; throws when it's unreadable. */
export function parseCache(raw) {
  if (raw == null) return null;
  const data = JSON.parse(raw);
  if (!data || data.version !== CACHE_VERSION || !Array.isArray(data.books)) throw new Error('Unknown cache format');
  const { books } = normalizeLibrary(data.books);
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // Conflict versions keep their extra fields (conflictId, conflictFrom) through normalizing.
  const losers = Array.isArray(data.losers) ? normalizeLibrary(data.losers).books : [];
  const dismissed = Array.isArray(data.dismissed) ? data.dismissed.filter((d) => typeof d === 'string') : [];
  return { books, synced: map(data.synced), revisions: map(data.revisions), losers, dismissed };
}

/**
 * Combine the browser's copy with the server's books after signing in or
 * reloading. Unsent local edits are kept; anything changed on the server
 * meanwhile is taken. When both changed a book, the most recent edit wins and
 * the other version is returned in `losers` so it can be offered for download.
 */
export function reconcile(cache, serverBooks) {
  const local = new Map((cache?.books ?? []).map((b) => [b.id, b]));
  const synced = { ...(cache?.synced ?? {}) };
  const revisions = { ...(cache?.revisions ?? {}) };
  const books = [];
  const losers = [];
  const seen = new Set();

  for (const sb of serverBooks) {
    seen.add(sb.id);
    const server = fromServer(sb);
    const takeServer = () => {
      books.push(server);
      synced[sb.id] = hashBook(server);
      revisions[sb.id] = sb.revision;
    };
    const mine = local.get(sb.id);
    const serverChanged = revisions[sb.id] !== sb.revision;

    if (!mine) {
      // Deleted here but not yet on the server: keep it deleted unless it was
      // edited elsewhere since (an edit beats a delete).
      if (sb.id in synced && !serverChanged) continue;
      takeServer();
      continue;
    }
    const dirty = synced[sb.id] !== hashBook(mine);
    if (!dirty) {
      takeServer();
    } else if (!serverChanged) {
      books.push(mine); // unsent edit on top of the current server version
    } else if (mine.updatedAt > server.updatedAt) {
      books.push(mine);
      losers.push({ ...server, conflictFrom: 'elsewhere' });
      synced[sb.id] = hashBook(server);
      revisions[sb.id] = sb.revision;
    } else {
      takeServer();
      losers.push({ ...mine, conflictFrom: 'this-browser' });
    }
  }

  for (const [id, mine] of local) {
    if (seen.has(id)) continue;
    const dirty = synced[id] !== hashBook(mine);
    if (dirty) {
      // Never reached the server, or edited after being deleted elsewhere: keep it.
      delete synced[id];
      delete revisions[id];
      books.push(mine);
    } else {
      // Unchanged here and deleted on another device.
      delete synced[id];
      delete revisions[id];
    }
  }
  // Synced ids with neither a local nor a server book: nothing left to delete.
  for (const id of Object.keys(synced)) {
    if (!seen.has(id) && !local.has(id)) {
      delete synced[id];
      delete revisions[id];
    }
  }

  books.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { books, synced, revisions, losers };
}
