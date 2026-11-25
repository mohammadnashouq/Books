// All SQL lives here. Functions take the database as their first argument.

import { hashToken } from './auth.js';
import { transaction } from './db.js';

const nowIso = () => new Date().toISOString();

export const SESSION_DAYS = 30;

// ---------- Users ----------

export function createUser(db, { username, usernameKey, passwordHash }) {
  try {
    const result = db
      .prepare('INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username, usernameKey, passwordHash, nowIso());
    return { id: Number(result.lastInsertRowid), username };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return null;
    throw error;
  }
}

export function findUserByKey(db, usernameKey) {
  return db.prepare('SELECT id, username, password_hash FROM users WHERE username_key = ?').get(usernameKey) ?? null;
}

// ---------- Sessions ----------

export function createSession(db, userId, token, days = SESSION_DAYS) {
  const created = new Date();
  const expires = new Date(created.getTime() + days * 24 * 3600 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    created.toISOString(),
    expires.toISOString(),
  );
  return expires;
}

/** The signed-in user for a session token, or null if missing or expired. */
export function userForSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    deleteSession(db, token);
    return null;
  }
  return { id: row.id, username: row.username };
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

// ---------- Books ----------

function rowToBook(row) {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    status: row.status,
    goal: row.goal,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chaptersOf(db, bookId) {
  return db
    .prepare('SELECT id, title, text FROM chapters WHERE book_id = ? ORDER BY position')
    .all(bookId)
    .map((c) => ({ id: c.id, title: c.title, text: c.text }));
}

function commentsOf(db, bookId) {
  return db
    .prepare(
      `SELECT id, chapter_id, author, text, quote, resolved, created_at FROM comments
       WHERE book_id = ? ORDER BY position`,
    )
    .all(bookId)
    .map((c) => ({
      id: c.id,
      chapterId: c.chapter_id,
      author: c.author,
      text: c.text,
      quote: c.quote,
      resolved: c.resolved === 1,
      createdAt: c.created_at,
    }));
}

const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

/** Every book, without text: for the public catalogue. */
export function listPublicBooks(db) {
  const rows = db
    .prepare(
      `SELECT b.*, u.username AS owner,
              (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b JOIN users u ON u.id = b.owner_id
       ORDER BY b.updated_at DESC`,
    )
    .all();
  const texts = db.prepare('SELECT text FROM chapters WHERE book_id = ?');
  return rows.map((row) => ({
    ...rowToBook(row),
    owner: row.owner,
    chapterCount: row.chapter_count,
    words: texts.all(row.id).reduce((n, c) => n + countWords(c.text), 0),
  }));
}

/**
 * One book. Readers get the chapters; only the owner also gets comments
 * (they are private notes) and the revision used for saving.
 */
export function getBook(db, bookId, viewerId = null) {
  const row = db
    .prepare('SELECT b.*, u.username AS owner FROM books b JOIN users u ON u.id = b.owner_id WHERE b.id = ?')
    .get(bookId);
  if (!row) return null;
  const isOwner = viewerId != null && row.owner_id === viewerId;
  const book = { ...rowToBook(row), owner: row.owner, isOwner, chapters: chaptersOf(db, bookId) };
  if (isOwner) {
    book.comments = commentsOf(db, bookId);
    book.revision = row.revision;
  }
  return book;
}

/** The owner's books in full, each with its revision. */
export function listOwnBooks(db, userId) {
  return db
    .prepare('SELECT id FROM books WHERE owner_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map((r) => {
      const { owner: _o, isOwner: _i, ...book } = getBook(db, r.id, userId);
      return book;
    });
}

function writeChildren(db, book) {
  db.prepare('DELETE FROM comments WHERE book_id = ?').run(book.id);
  db.prepare('DELETE FROM chapters WHERE book_id = ?').run(book.id);
  const insertChapter = db.prepare('INSERT INTO chapters (book_id, id, position, title, text) VALUES (?, ?, ?, ?, ?)');
  book.chapters.forEach((c, i) => insertChapter.run(book.id, c.id, i, c.title, c.text));
  const insertComment = db.prepare(
    `INSERT INTO comments (book_id, id, chapter_id, position, author, text, quote, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  book.comments.forEach((c, i) =>
    insertComment.run(book.id, c.id, c.chapterId, i, c.author, c.text, c.quote, c.resolved ? 1 : 0, c.createdAt),
  );
}

/**
 * Create or replace a book owned by `userId`.
 *
 * `baseRevision` is the revision the client last saw (null for a book it
 * thinks is new). Returns one of:
 *   { ok: true, revision }
 *   { forbidden: true }                 - the id belongs to someone else's book
 *   { conflict: true, current }         - the book changed since baseRevision
 */
export function saveBook(db, userId, book, baseRevision) {
  return transaction(db, () => {
    const existing = db.prepare('SELECT owner_id, revision FROM books WHERE id = ?').get(book.id);
    if (existing && existing.owner_id !== userId) return { forbidden: true };

    if (!existing) {
      // New here, or deleted on another device. Either way, writing it keeps
      // the writer's work: an edit beats a delete.
      db.prepare(
        `INSERT INTO books (id, owner_id, title, genre, status, goal, color, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(book.id, userId, book.title, book.genre, book.status, book.goal, book.color, book.createdAt, book.updatedAt);
      writeChildren(db, book);
      return { ok: true, revision: 1 };
    }

    if (baseRevision !== existing.revision) {
      return { conflict: true, current: getBook(db, book.id, userId) };
    }

    const revision = existing.revision + 1;
    db.prepare(
      `UPDATE books SET title = ?, genre = ?, status = ?, goal = ?, color = ?, created_at = ?, updated_at = ?,
       revision = ? WHERE id = ?`,
    ).run(book.title, book.genre, book.status, book.goal, book.color, book.createdAt, book.updatedAt, revision, book.id);
    writeChildren(db, book);
    return { ok: true, revision };
  });
}

/**
 * Delete a book. Returns { ok }, { forbidden }, or { conflict, current } when
 * it was edited elsewhere after `baseRevision` (an edit beats a delete).
 */
export function deleteBook(db, userId, bookId, baseRevision) {
  return transaction(db, () => {
    const existing = db.prepare('SELECT owner_id, revision FROM books WHERE id = ?').get(bookId);
    if (!existing) return { ok: true };
    if (existing.owner_id !== userId) return { forbidden: true };
    if (baseRevision != null && baseRevision !== existing.revision) {
      return { conflict: true, current: getBook(db, bookId, userId) };
    }
    db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    return { ok: true };
  });
}
