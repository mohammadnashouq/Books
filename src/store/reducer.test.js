import { describe, expect, it } from 'vitest';
import { reducer } from './reducer.js';

const T0 = '2026-01-01T00:00:00.000Z';

function library() {
  return [
    {
      id: 'b1',
      title: 'One',
      updatedAt: T0,
      chapters: [
        { id: 'c1', title: 'A', text: '' },
        { id: 'c2', title: 'B', text: '' },
        { id: 'c3', title: 'C', text: '' },
      ],
      comments: [
        { id: 'm1', chapterId: 'c2', text: 'x' },
        { id: 'm2', chapterId: 'c1', text: 'y' },
      ],
    },
    { id: 'b2', title: 'Two', updatedAt: T0, chapters: [{ id: 'd1', title: '', text: '' }], comments: [] },
  ];
}

describe('reducer', () => {
  it('marks a book as edited when its content changes', () => {
    const next = reducer(library(), { type: 'chapter/update', bookId: 'b1', chapterId: 'c1', patch: { text: 'hi' } });
    expect(next[0].chapters[0].text).toBe('hi');
    expect(next[0].updatedAt > T0).toBe(true);
    // Untouched books keep their identity (the cross-tab merge relies on this).
    const before = library();
    const after = reducer(before, { type: 'book/update', bookId: 'b1', patch: { title: 'New' } });
    expect(after[1]).toBe(before[1]);
  });

  it('deletes a chapter with its comments and restores both in place', () => {
    const start = library();
    const removed = start[0].chapters[1];
    const removedComments = start[0].comments.filter((c) => c.chapterId === 'c2');
    const deleted = reducer(start, { type: 'chapter/delete', bookId: 'b1', chapterId: 'c2' });
    expect(deleted[0].chapters.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(deleted[0].comments.map((c) => c.id)).toEqual(['m2']);

    const restored = reducer(deleted, {
      type: 'chapter/restore',
      bookId: 'b1',
      chapter: removed,
      index: 1,
      comments: removedComments,
    });
    expect(restored[0].chapters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(restored[0].comments.map((c) => c.id).sort()).toEqual(['m1', 'm2']);
    // Restoring twice does nothing.
    expect(
      reducer(restored, { type: 'chapter/restore', bookId: 'b1', chapter: removed, index: 1, comments: removedComments }),
    ).toBe(restored);
  });

  it('restores a deleted book at its old position, once', () => {
    const start = library();
    const deleted = reducer(start, { type: 'book/delete', bookId: 'b1' });
    const restored = reducer(deleted, { type: 'book/restore', book: start[0], index: 0 });
    expect(restored.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(reducer(restored, { type: 'book/restore', book: start[0], index: 0 })).toBe(restored);
  });

  it('restores a deleted comment, but not onto a chapter that is gone', () => {
    const start = library();
    const comment = start[0].comments[0];
    const deleted = reducer(start, { type: 'comment/delete', bookId: 'b1', commentId: 'm1' });
    const restored = reducer(deleted, { type: 'comment/restore', bookId: 'b1', comment, index: 0 });
    expect(restored[0].comments.map((c) => c.id)).toEqual(['m1', 'm2']);

    const noChapter = reducer(deleted, { type: 'chapter/delete', bookId: 'b1', chapterId: 'c2' });
    expect(reducer(noChapter, { type: 'comment/restore', bookId: 'b1', comment, index: 0 })).toBe(noChapter);
  });

  it('imports books, replacing ones with the same id', () => {
    const start = library();
    const next = reducer(start, {
      type: 'library/import',
      books: [{ ...start[1], title: 'Two (backup)' }, { id: 'b3', title: 'Three', chapters: [], comments: [] }],
    });
    expect(next.map((b) => `${b.id}:${b.title}`)).toEqual(['b3:Three', 'b1:One', 'b2:Two (backup)']);
  });

  it('toggles comments', () => {
    const next = reducer(library(), { type: 'comment/toggle', bookId: 'b1', commentId: 'm1' });
    expect(next[0].comments[0].resolved).toBe(true);
  });

  it('ignores unknown actions', () => {
    const start = library();
    expect(reducer(start, { type: 'nope' })).toBe(start);
  });
});
