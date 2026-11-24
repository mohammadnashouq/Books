// Strict validation of a book sent by a client. Unlike the browser's
// normalizeBook (which repairs damaged local data), the server rejects
// anything malformed so the database only ever holds valid books.

import { COVER_COLORS, STATUSES } from '../src/data/constants.js';

export const LIMITS = {
  idLength: 100,
  title: 120,
  genre: 40,
  goal: 10_000_000,
  chapters: 1000,
  chapterTitle: 200,
  chapterText: 2_000_000,
  comments: 5000,
  commentText: 5000,
  quote: 500,
  author: 100,
};

const COLORS = new Set(COVER_COLORS.map((c) => c.id));

class ValidationError extends Error {}

function check(condition, message) {
  if (!condition) throw new ValidationError(message);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.idLength;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;
/** Only canonical ISO timestamps ("2026-01-01T00:00:00.000Z"): stored as text, they sort correctly. */
const isIso = (v) => {
  if (typeof v !== 'string' || v.length > 40) return false;
  const time = Date.parse(v);
  return !Number.isNaN(time) && new Date(time).toISOString() === v;
};

/**
 * Returns { book } with only known fields, or { error } describing the first problem.
 * `id` must match the id in the URL.
 */
export function validateBook(raw, id) {
  try {
    check(isObject(raw), 'Book must be an object.');
    check(isId(raw.id) && raw.id === id, 'Book id does not match the URL.');
    check(isStr(raw.title, LIMITS.title) && raw.title.trim() !== '', 'Title is required (at most 120 characters).');
    check(isStr(raw.genre ?? '', LIMITS.genre), 'Genre is at most 40 characters.');
    check(Object.hasOwn(STATUSES, raw.status), 'Unknown status.');
    check(Number.isInteger(raw.goal) && raw.goal >= 0 && raw.goal <= LIMITS.goal, 'Word goal must be a whole number.');
    check(COLORS.has(raw.color), 'Unknown cover color.');
    check(isIso(raw.createdAt) && isIso(raw.updatedAt), 'Dates must be ISO timestamps.');
    check(Array.isArray(raw.chapters) && raw.chapters.length >= 1, 'A book needs at least one chapter.');
    check(raw.chapters.length <= LIMITS.chapters, 'Too many chapters.');
    check(Array.isArray(raw.comments) && raw.comments.length <= LIMITS.comments, 'Comments must be a list.');

    const chapterIds = new Set();
    const chapters = raw.chapters.map((c) => {
      check(isObject(c) && isId(c.id) && !chapterIds.has(c.id), 'Chapters need unique ids.');
      chapterIds.add(c.id);
      check(isStr(c.title, LIMITS.chapterTitle), 'Chapter titles are at most 200 characters.');
      check(isStr(c.text, LIMITS.chapterText), 'A chapter is too long.');
      return { id: c.id, title: c.title, text: c.text };
    });

    const commentIds = new Set();
    const comments = raw.comments.map((c) => {
      check(isObject(c) && isId(c.id) && !commentIds.has(c.id), 'Comments need unique ids.');
      commentIds.add(c.id);
      check(chapterIds.has(c.chapterId), 'A comment refers to a chapter that does not exist.');
      check(isStr(c.text, LIMITS.commentText), 'A comment is too long.');
      check(isStr(c.quote ?? '', LIMITS.quote), 'A quote is too long.');
      check(isStr(c.author, LIMITS.author) && c.author.trim() !== '', 'Comment author is required.');
      check(typeof c.resolved === 'boolean', 'Comment resolved must be true or false.');
      check(isIso(c.createdAt), 'Dates must be ISO timestamps.');
      return {
        id: c.id,
        chapterId: c.chapterId,
        author: c.author,
        text: c.text,
        quote: c.quote ?? '',
        resolved: c.resolved,
        createdAt: c.createdAt,
      };
    });

    return {
      book: {
        id: raw.id,
        title: raw.title.trim(),
        genre: raw.genre ?? '',
        status: raw.status,
        goal: raw.goal,
        color: raw.color,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        chapters,
        comments,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
}
