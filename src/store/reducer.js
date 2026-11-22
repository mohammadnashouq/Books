import { mergeLibraries } from './merge.js';

const now = () => new Date().toISOString();

function updateBook(books, bookId, fn) {
  return books.map((b) => (b.id === bookId ? { ...fn(b), updatedAt: now() } : b));
}

function insertAt(list, index, item) {
  const i = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
}

export function reducer(books, action) {
  switch (action.type) {
    case 'book/add':
      return [action.book, ...books];
    case 'book/update':
      return updateBook(books, action.bookId, (b) => ({ ...b, ...action.patch }));
    case 'book/delete':
      return books.filter((b) => b.id !== action.bookId);
    case 'book/restore':
      if (books.some((b) => b.id === action.book.id)) return books;
      return insertAt(books, action.index, action.book);
    case 'chapter/add':
      return updateBook(books, action.bookId, (b) => ({ ...b, chapters: [...b.chapters, action.chapter] }));
    case 'chapter/update':
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        chapters: b.chapters.map((c) => (c.id === action.chapterId ? { ...c, ...action.patch } : c)),
      }));
    case 'chapter/delete':
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        chapters: b.chapters.filter((c) => c.id !== action.chapterId),
        comments: b.comments.filter((c) => c.chapterId !== action.chapterId),
      }));
    case 'chapter/restore': {
      const book = books.find((b) => b.id === action.bookId);
      if (!book || book.chapters.some((c) => c.id === action.chapter.id)) return books;
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        chapters: insertAt(b.chapters, action.index, action.chapter),
        comments: [...action.comments.filter((c) => !b.comments.some((x) => x.id === c.id)), ...b.comments],
      }));
    }
    case 'comment/add':
      return updateBook(books, action.bookId, (b) => ({ ...b, comments: [action.comment, ...b.comments] }));
    case 'comment/toggle':
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        comments: b.comments.map((c) => (c.id === action.commentId ? { ...c, resolved: !c.resolved } : c)),
      }));
    case 'comment/delete':
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        comments: b.comments.filter((c) => c.id !== action.commentId),
      }));
    case 'comment/restore': {
      const book = books.find((b) => b.id === action.bookId);
      if (
        !book ||
        book.comments.some((c) => c.id === action.comment.id) ||
        !book.chapters.some((c) => c.id === action.comment.chapterId)
      ) {
        return books;
      }
      return updateBook(books, action.bookId, (b) => ({
        ...b,
        comments: insertAt(b.comments, action.index, action.comment),
      }));
    }
    case 'library/import': {
      // Imported books replace books with the same id; the rest are added in front.
      const incoming = new Map(action.books.map((b) => [b.id, b]));
      const kept = books.map((b) => incoming.get(b.id) || b);
      const known = new Set(books.map((b) => b.id));
      return [...action.books.filter((b) => !known.has(b.id)), ...kept];
    }
    case 'library/merge':
      return mergeLibraries(action.base, books, action.remote);
    default:
      return books;
  }
}
