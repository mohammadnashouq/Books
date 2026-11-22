import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { createSampleBooks } from '../data/sampleBooks.js';
import { ME } from '../data/constants.js';
import { uid } from '../lib/utils.js';

const STORAGE_KEY = 'books-app:v1';
const BooksContext = createContext(null);

function loadBooks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Storage unavailable or corrupt: fall back to sample data.
  }
  return createSampleBooks();
}

const now = () => new Date().toISOString();

function updateBook(books, bookId, fn) {
  return books.map((b) => (b.id === bookId ? { ...fn(b), updatedAt: now() } : b));
}

function reducer(books, action) {
  switch (action.type) {
    case 'book/add':
      return [action.book, ...books];
    case 'book/update':
      return updateBook(books, action.bookId, (b) => ({ ...b, ...action.patch }));
    case 'book/delete':
      return books.filter((b) => b.id !== action.bookId);
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
    default:
      return books;
  }
}

export function BooksProvider({ children }) {
  const [books, dispatch] = useReducer(reducer, undefined, loadBooks);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    } catch {
      // Ignore quota / private-mode errors.
    }
  }, [books]);

  const actions = useMemo(
    () => ({
      addBook(data) {
        const book = {
          id: uid(),
          title: data.title,
          genre: data.genre || '',
          status: data.status || 'draft',
          goal: data.goal || 0,
          color: data.color || 'violet',
          createdAt: now(),
          updatedAt: now(),
          chapters: [{ id: uid(), title: 'Chapter 1', text: '' }],
          comments: [],
        };
        dispatch({ type: 'book/add', book });
        return book.id;
      },
      updateBook: (bookId, patch) => dispatch({ type: 'book/update', bookId, patch }),
      deleteBook: (bookId) => dispatch({ type: 'book/delete', bookId }),
      addChapter(bookId, title) {
        const chapter = { id: uid(), title, text: '' };
        dispatch({ type: 'chapter/add', bookId, chapter });
        return chapter.id;
      },
      updateChapter: (bookId, chapterId, patch) => dispatch({ type: 'chapter/update', bookId, chapterId, patch }),
      deleteChapter: (bookId, chapterId) => dispatch({ type: 'chapter/delete', bookId, chapterId }),
      addComment(bookId, { chapterId, text, quote = '' }) {
        const comment = { id: uid(), chapterId, author: ME, text, quote, resolved: false, createdAt: now() };
        dispatch({ type: 'comment/add', bookId, comment });
      },
      toggleComment: (bookId, commentId) => dispatch({ type: 'comment/toggle', bookId, commentId }),
      deleteComment: (bookId, commentId) => dispatch({ type: 'comment/delete', bookId, commentId }),
    }),
    [],
  );

  const value = useMemo(() => ({ books, ...actions }), [books, actions]);
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

export function useBooks() {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks must be used inside <BooksProvider>');
  return ctx;
}
