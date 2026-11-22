// Reading, validating, migrating and writing the library.
//
// Everything here is pure or takes the Storage object as an argument, so it
// can be unit-tested without a browser.

import { COVER_COLORS, STATUSES } from '../data/constants.js';
import { uid } from '../lib/utils.js';
import { mergeLibraries } from './merge.js';

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'books-app:v2';
/** Version 1 stored a bare array of books under this key. */
export const LEGACY_KEY = 'books-app:v1';
/** Unreadable data is copied to `${RECOVERY_PREFIX}<timestamp>` before anything overwrites it. */
export const RECOVERY_PREFIX = 'books-app:recovery:';
export const LAST_BACKUP_KEY = 'books-app:last-backup';

export class LibraryFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryFormatError';
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);

function isoOr(value, fallback) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return fallback;
}

function idOr(value, seen) {
  const id = typeof value === 'string' && value.trim() ? value : uid();
  if (seen.has(id)) return uid();
  seen.add(id);
  return id;
}

/**
 * Turn anything that looks like a book into a valid book, filling in defaults.
 * Unknown fields are kept so data written by a newer version isn't thrown away.
 * Returns null when the value can't be a book at all.
 */
export function normalizeBook(raw, now = new Date().toISOString()) {
  // Must at least look like a book: `{}` or `{"foo":1}` is not one.
  if (!isObject(raw) || (typeof raw.title !== 'string' && !Array.isArray(raw.chapters))) return null;

  const chapterIds = new Set();
  const chapters = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .filter(isObject)
    .map((c) => ({ ...c, id: idOr(c.id, chapterIds), title: str(c.title), text: str(c.text) }));
  if (chapters.length === 0) chapters.push({ id: uid(), title: 'Chapter 1', text: '' });

  const valid = new Set(chapters.map((c) => c.id));
  const commentIds = new Set();
  const comments = (Array.isArray(raw.comments) ? raw.comments : [])
    .filter((c) => isObject(c) && valid.has(c.chapterId) && typeof c.text === 'string')
    .map((c) => ({
      ...c,
      id: idOr(c.id, commentIds),
      author: str(c.author, 'Unknown'),
      text: c.text,
      quote: str(c.quote),
      resolved: c.resolved === true,
      createdAt: isoOr(c.createdAt, now),
    }));

  const goal = Number(raw.goal);
  const createdAt = isoOr(raw.createdAt, now);

  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : uid(),
    title: str(raw.title).trim() || 'Untitled book',
    genre: str(raw.genre),
    status: Object.hasOwn(STATUSES, raw.status) ? raw.status : 'draft',
    goal: Number.isFinite(goal) && goal > 0 ? Math.floor(goal) : 0,
    color: COVER_COLORS.some((c) => c.id === raw.color) ? raw.color : COVER_COLORS[0].id,
    createdAt,
    updatedAt: isoOr(raw.updatedAt, createdAt),
    chapters,
    comments,
  };
}

const len = (v) => (Array.isArray(v) ? v.length : 0);

/**
 * Normalize a list of books. `dropped` counts books, chapters and comments
 * that couldn't be read and were left out.
 */
export function normalizeLibrary(list, now) {
  const books = [];
  const ids = new Set();
  let dropped = 0;
  for (const raw of list) {
    const book = normalizeBook(raw, now);
    if (!book) {
      dropped += 1;
      continue;
    }
    dropped += Math.max(0, len(raw.chapters) - book.chapters.length);
    dropped += len(raw.comments) - book.comments.length;
    if (ids.has(book.id)) book.id = uid();
    ids.add(book.id);
    books.push(book);
  }
  return { books, dropped };
}

/**
 * Parse stored or exported JSON in any known format:
 *  - v1: a bare array of books
 *  - v2: { version, books }
 *  - export file: { app: 'books', version, exportedAt, books }
 * Throws LibraryFormatError when the text isn't a library.
 */
export function parseLibraryJson(text, now) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LibraryFormatError('The data is not valid JSON.');
  }
  let list;
  if (Array.isArray(data)) list = data;
  else if (isObject(data) && Array.isArray(data.books)) list = data.books;
  else throw new LibraryFormatError('The data does not contain a list of books.');
  return normalizeLibrary(list, now);
}

/** The exact string written to storage. Deterministic so equal libraries compare equal. */
export function serializeLibrary(books) {
  return JSON.stringify({ version: SCHEMA_VERSION, books });
}

export function exportLibrary(books, now = new Date().toISOString()) {
  return JSON.stringify({ app: 'books', version: SCHEMA_VERSION, exportedAt: now, books }, null, 2);
}

function tryGet(storage, key) {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Copy unreadable data aside so a later save can't destroy it. Returns the key, or null. */
export function preserveRaw(storage, raw, now = Date.now()) {
  // Random suffix: two copies made in the same millisecond must not overwrite each other.
  const key = `${RECOVERY_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    storage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

/**
 * Merge a v1 library written by an old tab into `books`. With no common base,
 * each book's most recent edit wins and books from either side are kept, so
 * nothing is lost; the raw v1 data is also copied aside first.
 */
export function mergeLegacy(storage, books, legacyRaw, now) {
  let legacyBooks;
  try {
    legacyBooks = parseLibraryJson(legacyRaw, now).books;
  } catch {
    preserveRaw(storage, legacyRaw);
    return books;
  }
  preserveRaw(storage, legacyRaw);
  return mergeLibraries([], books, legacyBooks);
}

/**
 * Load the library from storage.
 *
 * Returns { books, source, legacyPending, savedJson, problem }:
 *  - source: 'v2' | 'v1' | 'sample' | 'empty'
 *  - legacyPending: the v1 key holds data that is now merged into `books`;
 *    remove it once `books` has been saved
 *  - savedJson: what storage currently holds under STORAGE_KEY in our format
 *    (null if nothing usable is there yet, so the caller knows to write)
 *  - problem: null, or { kind: 'unavailable' | 'corrupt' | 'partial', raw, backupKey, dropped }
 */
export function loadLibrary(storage, createSamples, now) {
  if (!storage) {
    return { books: createSamples(), source: 'sample', savedJson: null, problem: { kind: 'unavailable' } };
  }

  const current = tryGet(storage, STORAGE_KEY);
  if (!current.ok) {
    return { books: createSamples(), source: 'sample', savedJson: null, problem: { kind: 'unavailable' } };
  }

  let raw = current.value;
  let source = 'v2';
  if (raw == null) {
    const legacy = tryGet(storage, LEGACY_KEY);
    raw = legacy.ok ? legacy.value : null;
    source = 'v1';
  }
  if (raw == null) return { books: createSamples(), source: 'sample', savedJson: null, problem: null };

  try {
    const parsed = parseLibraryJson(raw, now);
    const { dropped } = parsed;
    let { books } = parsed;
    let legacyPending = source === 'v1';

    // A tab still running version 0.1 keeps writing the v1 key after this
    // version migrated it. Merge those writes in rather than ignore them.
    if (source === 'v2') {
      const legacy = tryGet(storage, LEGACY_KEY);
      if (legacy.ok && legacy.value != null) {
        books = mergeLegacy(storage, books, legacy.value, now);
        legacyPending = true;
      }
    }

    if (dropped > 0) {
      const backupKey = preserveRaw(storage, raw);
      return { books, source, legacyPending, savedJson: null, problem: { kind: 'partial', raw, backupKey, dropped } };
    }
    const savedJson = !legacyPending && raw === serializeLibrary(books) ? raw : null;
    return { books, source, legacyPending, savedJson, problem: null };
  } catch {
    // Don't fall back to sample books: an empty library makes it obvious
    // something is wrong, and the raw data is kept for recovery.
    const backupKey = preserveRaw(storage, raw);
    return { books: [], source: 'empty', savedJson: null, problem: { kind: 'corrupt', raw, backupKey, dropped: 0 } };
  }
}

/** Write the serialized library. Never throws. */
export function saveLibrary(storage, json) {
  if (!storage) return { ok: false, error: new Error('Storage is unavailable') };
  try {
    storage.setItem(STORAGE_KEY, json);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function removeLegacy(storage) {
  try {
    storage?.removeItem(LEGACY_KEY);
  } catch {
    // Not important: the v2 key is what's read from now on.
  }
}

/** The browser's localStorage, or null when access is blocked. */
export function getBrowserStorage() {
  try {
    const s = window.localStorage;
    // Accessing the property can succeed while use still throws (e.g. Safari private mode).
    s.getItem(STORAGE_KEY);
    return s;
  } catch {
    return null;
  }
}

/** Everything under our keys, for the crash screen's "download my data". */
export function dumpRawStorage(storage) {
  const out = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith('books-app:')) out[key] = storage.getItem(key);
    }
  } catch {
    // Return what we got.
  }
  return out;
}
