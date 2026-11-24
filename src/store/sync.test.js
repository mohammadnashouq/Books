import { describe, expect, it } from 'vitest';
import { fromServer, hashBook, parseCache, pendingChanges, reconcile, serializeCache } from './sync.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';

const book = (id, extra = {}) => ({
  id,
  title: id,
  genre: '',
  status: 'draft',
  goal: 0,
  color: 'violet',
  createdAt: T0,
  updatedAt: T0,
  chapters: [{ id: 'c1', title: '', text: '' }],
  comments: [],
  ...extra,
});
const server = (b, revision) => ({ ...b, revision });

/** A cache in which every book is synced at the given revisions. */
function syncedCache(books, revs) {
  return {
    books,
    synced: Object.fromEntries(books.map((b) => [b.id, hashBook(b)])),
    revisions: Object.fromEntries(books.map((b) => [b.id, revs[b.id] ?? 1])),
  };
}

describe('hashBook / pendingChanges', () => {
  it('detects edits, new books and deletes', () => {
    const a = book('a');
    const b = book('b');
    const synced = { a: hashBook(a), b: hashBook(b) };
    expect(pendingChanges([a, b], synced)).toEqual({ dirty: [], deleted: [] });

    const edited = { ...a, chapters: [{ id: 'c1', title: '', text: 'new words' }] };
    const fresh = book('c');
    expect(pendingChanges([edited, fresh], synced)).toEqual({ dirty: [edited, fresh], deleted: ['b'] });
  });

  it('ignores fields the server does not store', () => {
    const a = book('a');
    expect(hashBook(fromServer({ ...a, revision: 4, owner: 'x', isOwner: true }))).toBe(hashBook(a));
  });
});

describe('cache format', () => {
  it('round-trips and rejects unknown formats', () => {
    const cache = syncedCache([book('a')], {});
    expect(parseCache(serializeCache(cache))).toEqual({ ...cache, losers: [], dismissed: [] });
    const withLoser = { ...cache, losers: [book('a', { title: 'older' })] };
    expect(parseCache(serializeCache(withLoser)).losers[0].title).toBe('older');
    expect(parseCache(null)).toBeNull();
    expect(() => parseCache('[]')).toThrow();
    expect(() => parseCache('{oops')).toThrow();
  });
});

describe('reconcile', () => {
  it('takes the server’s books on a fresh browser', () => {
    const r = reconcile(null, [server(book('a'), 3)]);
    expect(r.books).toEqual([book('a')]);
    expect(r.revisions).toEqual({ a: 3 });
    expect(pendingChanges(r.books, r.synced)).toEqual({ dirty: [], deleted: [] });
  });

  it('keeps unsent local edits made on top of the current server version', () => {
    const a = book('a');
    const cache = syncedCache([a], { a: 2 });
    const edited = { ...a, title: 'edited offline', updatedAt: T1 };
    cache.books = [edited];
    const r = reconcile(cache, [server(a, 2)]);
    expect(r.books).toEqual([edited]);
    expect(pendingChanges(r.books, r.synced).dirty).toEqual([edited]);
    expect(r.losers).toEqual([]);
  });

  it('takes server changes to books not edited here', () => {
    const a = book('a');
    const cache = syncedCache([a], { a: 1 });
    const newer = { ...a, title: 'from another device', updatedAt: T1 };
    const r = reconcile(cache, [server(newer, 2)]);
    expect(r.books).toEqual([newer]);
    expect(r.revisions.a).toBe(2);
  });

  it('when both changed, keeps the newest edit and returns the other as a loser', () => {
    const a = book('a');
    const local = { ...a, title: 'local', updatedAt: T2 };
    const remote = { ...a, title: 'remote', updatedAt: T1 };
    const cache = { ...syncedCache([a], { a: 1 }), books: [local] };

    const r1 = reconcile(cache, [server(remote, 2)]);
    expect(r1.books).toEqual([local]);
    expect(r1.losers).toEqual([{ ...remote, conflictFrom: 'elsewhere' }]);
    expect(r1.revisions.a).toBe(2); // the next save goes on top of the server's version
    expect(pendingChanges(r1.books, r1.synced).dirty).toEqual([local]);

    const r2 = reconcile({ ...cache, books: [{ ...local, updatedAt: T0 }] }, [server(remote, 2)]);
    expect(r2.books).toEqual([remote]);
    expect(r2.losers[0].title).toBe('local');
  });

  it('keeps books never sent to the server', () => {
    const r = reconcile({ books: [book('new')], synced: {}, revisions: {} }, []);
    expect(r.books.map((b) => b.id)).toEqual(['new']);
    expect(pendingChanges(r.books, r.synced).dirty).toHaveLength(1);
  });

  it('drops books deleted on another device that weren’t edited here', () => {
    const cache = syncedCache([book('a'), book('b')], {});
    const r = reconcile(cache, [server(book('a'), 1)]);
    expect(r.books.map((b) => b.id)).toEqual(['a']);
    expect(r.synced.b).toBeUndefined();
  });

  it('keeps a book edited here but deleted elsewhere (an edit beats a delete)', () => {
    const b = book('b');
    const cache = { ...syncedCache([b], {}), books: [{ ...b, title: 'edited', updatedAt: T1 }] };
    const r = reconcile(cache, []);
    expect(r.books[0].title).toBe('edited');
    expect(pendingChanges(r.books, r.synced).dirty).toHaveLength(1);
  });

  it('keeps an unsent delete, unless the server copy changed since', () => {
    const a = book('a');
    const cache = { ...syncedCache([a], { a: 1 }), books: [] };
    const kept = reconcile(cache, [server(a, 1)]);
    expect(kept.books).toEqual([]);
    expect(pendingChanges(kept.books, kept.synced).deleted).toEqual(['a']);

    const edited = { ...a, title: 'edited elsewhere', updatedAt: T1 };
    const restored = reconcile(cache, [server(edited, 2)]);
    expect(restored.books).toEqual([edited]);
  });
});
