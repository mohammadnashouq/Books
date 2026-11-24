import { describe, expect, it } from 'vitest';
import {
  LEGACY_KEY,
  LibraryFormatError,
  RECOVERY_PREFIX,
  SCHEMA_VERSION,
  STORAGE_KEY,
  dumpRawStorage,
  exportLibrary,
  loadLibrary,
  normalizeBook,
  parseLibraryJson,
  saveLibrary,
  serializeLibrary,
} from './storage.js';

const NOW = '2026-01-01T00:00:00.000Z';
const samples = () => [{ id: 'sample', title: 'Sample', chapters: [], comments: [] }];

function memoryStorage(initial = {}, { failWrites = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

const goodBook = {
  id: 'b1',
  title: 'Book',
  genre: 'Fantasy',
  status: 'progress',
  goal: 1000,
  color: 'teal',
  createdAt: NOW,
  updatedAt: NOW,
  chapters: [{ id: 'c1', title: 'One', text: 'Hello world' }],
  comments: [{ id: 'm1', chapterId: 'c1', author: 'You', text: 'Nice', quote: '', resolved: false, createdAt: NOW }],
};

describe('normalizeBook', () => {
  it('keeps a valid book as it is', () => {
    expect(normalizeBook(goodBook, NOW)).toEqual(goodBook);
  });

  it('returns null for values that are not books', () => {
    expect(normalizeBook(null)).toBeNull();
    expect(normalizeBook('book')).toBeNull();
    expect(normalizeBook([1, 2])).toBeNull();
  });

  it('repairs a book with missing or wrong fields', () => {
    const book = normalizeBook({ id: 'x', title: '  ', status: 'weird', goal: -5, color: 'plaid', genre: 3 }, NOW);
    expect(book).toMatchObject({
      id: 'x',
      title: 'Untitled book',
      genre: '',
      status: 'draft',
      goal: 0,
      color: 'violet',
      createdAt: NOW,
      updatedAt: NOW,
      comments: [],
    });
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]).toMatchObject({ title: 'Chapter 1', text: '' });
  });

  it('drops comments whose chapter no longer exists and invalid chapters', () => {
    const book = normalizeBook(
      {
        ...goodBook,
        chapters: [...goodBook.chapters, 'junk', null],
        comments: [...goodBook.comments, { id: 'm2', chapterId: 'gone', text: 'orphan' }, { id: 'm3' }],
      },
      NOW,
    );
    expect(book.chapters.map((c) => c.id)).toEqual(['c1']);
    expect(book.comments.map((c) => c.id)).toEqual(['m1']);
  });

  it('gives duplicate chapter ids fresh ids', () => {
    const book = normalizeBook({ ...goodBook, chapters: [goodBook.chapters[0], { ...goodBook.chapters[0] }] }, NOW);
    expect(new Set(book.chapters.map((c) => c.id)).size).toBe(2);
  });

  it('turns parseable dates into canonical ISO timestamps', () => {
    const book = normalizeBook({ ...goodBook, updatedAt: '2026-03-04' }, NOW);
    expect(book.updatedAt).toBe('2026-03-04T00:00:00.000Z');
  });

  it('keeps unknown fields written by a newer version', () => {
    expect(normalizeBook({ ...goodBook, series: 'Saga' }, NOW).series).toBe('Saga');
  });
});

describe('parseLibraryJson', () => {
  it('reads the v1 format (a bare array)', () => {
    expect(parseLibraryJson(JSON.stringify([goodBook]), NOW).books).toEqual([goodBook]);
  });

  it('reads the v2 format and export files', () => {
    expect(parseLibraryJson(serializeLibrary([goodBook]), NOW).books).toEqual([goodBook]);
    expect(parseLibraryJson(exportLibrary([goodBook], NOW), NOW).books).toEqual([goodBook]);
  });

  it('counts entries it had to drop', () => {
    expect(parseLibraryJson(JSON.stringify([goodBook, 42, null]), NOW)).toMatchObject({ dropped: 2 });
  });

  it('counts dropped chapters and comments too', () => {
    const damaged = {
      ...goodBook,
      chapters: [...goodBook.chapters, 'junk'],
      comments: [...goodBook.comments, { id: 'm2', chapterId: 'gone', text: 'orphan' }],
    };
    expect(parseLibraryJson(JSON.stringify([damaged]), NOW)).toMatchObject({ dropped: 2 });
  });

  it('does not treat arbitrary objects as books', () => {
    expect(parseLibraryJson('[{}, {"foo": 1}]', NOW)).toMatchObject({ books: [], dropped: 2 });
  });

  it('gives books with the same id distinct ids', () => {
    const { books } = parseLibraryJson(JSON.stringify([goodBook, goodBook]), NOW);
    expect(books[0].id).not.toBe(books[1].id);
  });

  it('rejects text that is not a library', () => {
    expect(() => parseLibraryJson('not json')).toThrow(LibraryFormatError);
    expect(() => parseLibraryJson('{"hello":1}')).toThrow(LibraryFormatError);
    expect(() => parseLibraryJson('null')).toThrow(LibraryFormatError);
  });
});

describe('loadLibrary', () => {
  it('uses sample books on first run', () => {
    const result = loadLibrary(memoryStorage(), samples, NOW);
    expect(result).toMatchObject({ source: 'sample', savedJson: null, problem: null });
    expect(result.books[0].id).toBe('sample');
  });

  it('loads the current format and reports it as already saved', () => {
    const json = serializeLibrary([goodBook]);
    const result = loadLibrary(memoryStorage({ [STORAGE_KEY]: json }), samples, NOW);
    expect(result).toMatchObject({ source: 'v2', savedJson: json, problem: null });
    expect(result.books).toEqual([goodBook]);
  });

  it('migrates the v1 key', () => {
    const result = loadLibrary(memoryStorage({ [LEGACY_KEY]: JSON.stringify([goodBook]) }), samples, NOW);
    expect(result).toMatchObject({ source: 'v1', legacyPending: true, savedJson: null, problem: null });
    expect(result.books).toEqual([goodBook]);
  });

  it('keeps the v2 copy when a leftover v1 copy is not newer', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: serializeLibrary([goodBook]),
      [LEGACY_KEY]: JSON.stringify([{ ...goodBook, title: 'Old' }]),
    });
    expect(loadLibrary(storage, samples, NOW).books[0].title).toBe('Book');
  });

  it('merges v1 writes from a tab still running the old version', () => {
    const later = '2026-03-01T00:00:00.000Z';
    const newTabOnly = { ...goodBook, id: 'b2', title: 'Made in the new version' };
    const v2 = serializeLibrary([goodBook, newTabOnly]);
    // The old tab kept editing b1 after the migration and rewrote the v1 key.
    const oldTabEdit = { ...goodBook, updatedAt: later, chapters: [{ ...goodBook.chapters[0], text: 'Written in the old tab' }] };
    const v1 = JSON.stringify([oldTabEdit]);
    const storage = memoryStorage({ [STORAGE_KEY]: v2, [LEGACY_KEY]: v1 });

    const result = loadLibrary(storage, samples, NOW);
    expect(result).toMatchObject({ source: 'v2', legacyPending: true, savedJson: null, problem: null });
    expect(result.books.find((b) => b.id === 'b1').chapters[0].text).toBe('Written in the old tab');
    expect(result.books.find((b) => b.id === 'b2')).toBeDefined();
    const copies = [...storage.data.keys()].filter((k) => k.startsWith(RECOVERY_PREFIX));
    expect(copies.map((k) => storage.getItem(k))).toEqual([v1]);
  });

  it('repairs a book missing its chapters instead of crashing', () => {
    const { chapters: _omit, ...broken } = { ...goodBook, comments: [] };
    const result = loadLibrary(memoryStorage({ [STORAGE_KEY]: serializeLibrary([broken]) }), samples, NOW);
    expect(result.problem).toBeNull();
    expect(result.books[0].chapters).toHaveLength(1);
    // Saved form differs from what's stored, so the caller writes the repaired version.
    expect(result.savedJson).toBeNull();
  });

  it('reports comments orphaned by missing chapters, keeping the original', () => {
    const { chapters: _omit, ...broken } = goodBook;
    const raw = serializeLibrary([broken]);
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const result = loadLibrary(storage, samples, NOW);
    expect(result.books[0].comments).toEqual([]);
    expect(result.problem).toMatchObject({ kind: 'partial', dropped: 1 });
    expect(storage.getItem(result.problem.backupKey)).toBe(raw);
  });

  it('keeps unreadable data aside and starts empty rather than with samples', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{oops' });
    const result = loadLibrary(storage, samples, NOW);
    expect(result.books).toEqual([]);
    expect(result.problem).toMatchObject({ kind: 'corrupt', raw: '{oops' });
    expect(result.problem.backupKey.startsWith(RECOVERY_PREFIX)).toBe(true);
    expect(storage.getItem(result.problem.backupKey)).toBe('{oops');
  });

  it('reports partly unreadable data and keeps the original', () => {
    const raw = JSON.stringify([goodBook, 'junk']);
    const storage = memoryStorage({ [LEGACY_KEY]: raw });
    const result = loadLibrary(storage, samples, NOW);
    expect(result.books).toEqual([goodBook]);
    expect(result.problem).toMatchObject({ kind: 'partial', dropped: 1, raw });
    expect(storage.getItem(result.problem.backupKey)).toBe(raw);
  });

  it('reports a null backupKey when the copy cannot be written', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{oops' }, { failWrites: true });
    expect(loadLibrary(storage, samples, NOW).problem).toMatchObject({ kind: 'corrupt', backupKey: null });
  });

  it('reports unavailable storage', () => {
    expect(loadLibrary(null, samples, NOW).problem).toEqual({ kind: 'unavailable' });
    const throwing = {
      getItem() {
        throw new Error('SecurityError');
      },
    };
    expect(loadLibrary(throwing, samples, NOW)).toMatchObject({ source: 'sample', problem: { kind: 'unavailable' } });
  });
});

describe('saveLibrary', () => {
  it('writes the serialized library', () => {
    const storage = memoryStorage();
    expect(saveLibrary(storage, 'x')).toEqual({ ok: true });
    expect(storage.getItem(STORAGE_KEY)).toBe('x');
  });

  it('reports failure instead of throwing', () => {
    const result = saveLibrary(memoryStorage({}, { failWrites: true }), 'x');
    expect(result.ok).toBe(false);
    expect(result.error.name).toBe('QuotaExceededError');
    expect(saveLibrary(null, 'x').ok).toBe(false);
  });
});

describe('serializeLibrary / exportLibrary', () => {
  it('stores the schema version', () => {
    expect(JSON.parse(serializeLibrary([]))).toEqual({ version: SCHEMA_VERSION, books: [] });
    expect(JSON.parse(exportLibrary([], NOW))).toEqual({ app: 'books', version: SCHEMA_VERSION, exportedAt: NOW, books: [] });
  });
});

describe('dumpRawStorage', () => {
  it('returns only our keys', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'a', [LEGACY_KEY]: 'b', other: 'c' });
    expect(dumpRawStorage(storage)).toEqual({ [STORAGE_KEY]: 'a', [LEGACY_KEY]: 'b' });
    expect(dumpRawStorage(null)).toEqual({});
  });
});
