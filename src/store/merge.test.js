import { describe, expect, it } from 'vitest';
import { mergeLibraries } from './merge.js';

const book = (id, updatedAt = '2026-01-01T00:00:00.000Z', extra = {}) => ({
  id,
  title: id,
  updatedAt,
  chapters: [],
  comments: [],
  ...extra,
});
// The other tab's copy arrives parsed from JSON, so it never shares object identity.
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('mergeLibraries', () => {
  it('takes the other tab’s edits to books this tab did not touch', () => {
    const a = book('a');
    const b = book('b');
    const base = [a, b];
    const remote = clone(base);
    remote[1] = book('b', '2026-01-02T00:00:00.000Z', { title: 'B2' });
    expect(mergeLibraries(base, base, remote).map((x) => x.title)).toEqual(['a', 'B2']);
  });

  it('keeps this tab’s unsaved edits to other books', () => {
    const a = book('a');
    const b = book('b');
    const base = [a, b];
    const local = [book('a', '2026-01-03T00:00:00.000Z', { title: 'A-local' }), b];
    const remote = clone(base);
    remote[1].title = 'B-remote';
    remote[1].updatedAt = '2026-01-02T00:00:00.000Z';
    expect(mergeLibraries(base, local, remote).map((x) => x.title)).toEqual(['A-local', 'B-remote']);
  });

  it('keeps the most recent edit when both tabs changed the same book', () => {
    const base = [book('a')];
    const local = [book('a', '2026-01-05T00:00:00.000Z', { title: 'newer' })];
    const remote = [book('a', '2026-01-04T00:00:00.000Z', { title: 'older' })];
    expect(mergeLibraries(base, local, remote)[0].title).toBe('newer');
    expect(mergeLibraries(base, [book('a', '2026-01-03T00:00:00.000Z')], remote)[0].title).toBe('older');
  });

  it('applies the other tab’s deletes and additions', () => {
    const a = book('a');
    const b = book('b');
    const base = [a, b];
    const remote = [book('new'), clone(a)];
    expect(mergeLibraries(base, base, remote).map((x) => x.id)).toEqual(['new', 'a']);
  });

  it('keeps books created in this tab', () => {
    const a = book('a');
    const base = [a];
    const local = [book('mine'), a];
    expect(mergeLibraries(base, local, clone(base)).map((x) => x.id)).toEqual(['mine', 'a']);
  });

  it('keeps this tab’s delete when the other tab did not change the book', () => {
    const a = book('a');
    const b = book('b');
    const base = [a, b];
    expect(mergeLibraries(base, [a], clone(base)).map((x) => x.id)).toEqual(['a']);
  });

  it('prefers an edit over a delete so no writing is lost', () => {
    const a = book('a');
    const base = [a];
    const editedRemote = [book('a', '2026-01-09T00:00:00.000Z', { title: 'edited' })];
    expect(mergeLibraries(base, [], editedRemote)[0].title).toBe('edited');
    const editedLocal = [book('a', '2026-01-09T00:00:00.000Z', { title: 'mine' })];
    expect(mergeLibraries(base, editedLocal, [])[0].title).toBe('mine');
  });
});
