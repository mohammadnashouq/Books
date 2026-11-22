import { describe, expect, it, vi } from 'vitest';
import { bookProgress, bookWords, countWords, initials, openComments, timeAgo } from './utils.js';
import { backupFileName, backupIsDue } from './backup.js';

describe('word counts', () => {
  it('counts words across whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('  one\ttwo\n\nthree  ')).toBe(3);
  });

  it('sums chapters and caps progress at 100%', () => {
    const book = { goal: 4, chapters: [{ text: 'a b' }, { text: 'c d e f' }], comments: [] };
    expect(bookWords(book)).toBe(6);
    expect(bookProgress(book)).toBe(100);
    expect(bookProgress({ ...book, goal: 0 })).toBe(0);
    expect(bookProgress({ ...book, goal: 12 })).toBe(50);
  });
});

describe('openComments', () => {
  it('counts unresolved comments', () => {
    expect(openComments({ comments: [{ resolved: false }, { resolved: true }, {}] })).toBe(2);
  });
});

describe('timeAgo', () => {
  it('describes recent times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(timeAgo('2026-06-15T11:59:30Z')).toBe('just now');
    expect(timeAgo('2026-06-15T11:30:00Z')).toBe('30 min ago');
    expect(timeAgo('2026-06-15T09:00:00Z')).toBe('3 h ago');
    expect(timeAgo('2026-06-14T09:00:00Z')).toBe('yesterday');
    expect(timeAgo('2026-06-11T12:00:00Z')).toBe('4 days ago');
    vi.useRealTimers();
  });
});

describe('initials', () => {
  it('uses the first letter', () => {
    expect(initials('maya')).toBe('M');
    expect(initials('  ')).toBe('?');
  });
});

describe('backup helpers', () => {
  it('names files by date', () => {
    expect(backupFileName(new Date(2026, 0, 5))).toBe('books-backup-2026-01-05.json');
  });

  it('reminds after a week without a backup', () => {
    const now = Date.parse('2026-06-15T00:00:00Z');
    expect(backupIsDue(null, now)).toBe(true);
    expect(backupIsDue('2026-06-10T00:00:00Z', now)).toBe(false);
    expect(backupIsDue('2026-06-01T00:00:00Z', now)).toBe(true);
  });
});
