import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { createSampleBooks } from '../data/sampleBooks.js';
import { ME } from '../data/constants.js';
import { uid } from '../lib/utils.js';
import { reducer } from './reducer.js';
import {
  LEGACY_KEY,
  STORAGE_KEY,
  getBrowserStorage,
  loadLibrary,
  parseLibraryJson,
  removeLegacy,
  saveLibrary,
  serializeLibrary,
} from './storage.js';

/** How long to wait after the last edit before writing to storage. */
export const SAVE_DELAY_MS = 400;

const BooksContext = createContext(null);

const now = () => new Date().toISOString();

/**
 * Holds the library, writes it to localStorage and keeps tabs in sync.
 *
 * saveStatus is the truth about the last write:
 *  'saved'   - storage holds exactly what's on screen
 *  'pending' - there are edits waiting for the next write
 *  'error'   - the last write failed (storage full, blocked, or unavailable)
 *
 * `storage` can be passed for tests; by default it's the browser's localStorage
 * (or null when the browser blocks it).
 */
export function BooksProvider({ children, storage: storageProp }) {
  const [initial] = useState(() => {
    const storage = storageProp === undefined ? getBrowserStorage() : storageProp;
    return { ...loadLibrary(storage, createSampleBooks), storage };
  });
  const { storage } = initial;
  const [books, dispatch] = useReducer(reducer, initial.books);
  const [saveStatus, setSaveStatus] = useState(initial.savedJson ? 'saved' : 'pending');
  const [problem, setProblem] = useState(initial.problem);
  // If unreadable data couldn't be copied aside, don't overwrite it until the user has dealt with it.
  const [writeBlocked, setWriteBlocked] = useState(Boolean(initial.problem?.raw && !initial.problem.backupKey));

  // What storage holds (as far as this tab knows), and the books array it was made from.
  // `base` is null until something has been saved. Unedited books keep their
  // object identity, so `books === base.current` means "nothing to save".
  const savedJson = useRef(initial.savedJson);
  const base = useRef(initial.savedJson ? initial.books : null);
  const latest = useRef(initial.books);
  const timer = useRef(null);
  // The v1 key holds data merged into this library; remove it after the next save.
  const legacyPending = useRef(Boolean(initial.legacyPending));

  useLayoutEffect(() => {
    latest.current = books;
  }, [books]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    const current = latest.current;
    const json = serializeLibrary(current);
    if (json === savedJson.current && !legacyPending.current) {
      base.current = current;
      setSaveStatus('saved');
      return true;
    }
    if (writeBlocked) {
      setSaveStatus('error');
      return false;
    }
    const result = saveLibrary(storage, json);
    if (!result.ok) {
      setSaveStatus('error');
      return false;
    }
    savedJson.current = json;
    base.current = current;
    setSaveStatus('saved');
    if (legacyPending.current) {
      removeLegacy(storage);
      legacyPending.current = false;
    }
    return true;
  }, [storage, writeBlocked]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Schedule a write after each change. The library is serialized once per
  // write, not once per keystroke, so typing stays fast in big libraries.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (books === base.current && !legacyPending.current) {
      setSaveStatus('saved');
      return;
    }
    setSaveStatus((s) => (s === 'error' ? 'error' : 'pending'));
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [books, flush]);

  // Write immediately when the page is hidden or closed, and warn before
  // closing if the write failed.
  useEffect(() => {
    const onHide = () => {
      if (timer.current) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    const onBeforeUnload = (e) => {
      onHide();
      if (serializeLibrary(latest.current) !== savedJson.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush]);

  // On unmount (including when the error boundary replaces the app after a
  // crash), write any edits still waiting for the timer instead of dropping them.
  useEffect(
    () => () => {
      if (timer.current) flushRef.current();
    },
    [],
  );

  // Another tab saved: merge its library into ours rather than overwrite it on our next save.
  useEffect(() => {
    if (!storage) return undefined;
    function onStorage(e) {
      if (e.storageArea !== storage || e.newValue == null) return;
      if (e.key !== STORAGE_KEY && e.key !== LEGACY_KEY) return;
      let remote;
      try {
        remote = parseLibraryJson(e.newValue).books;
      } catch {
        return; // Unreadable; our next save replaces it.
      }
      if (e.key === LEGACY_KEY) {
        // A tab still running version 0.1 saved. It never sees our changes, so
        // there's no common base: keep every book, newest edit wins.
        dispatch({ type: 'library/merge', base: [], remote });
        legacyPending.current = true;
        return;
      }
      dispatch({ type: 'library/merge', base: base.current ?? [], remote });
      base.current = remote;
      savedJson.current = serializeLibrary(remote);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storage]);

  // Ask the browser not to evict our data when the disk is low.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

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
      restoreBook: (book, index) => dispatch({ type: 'book/restore', book, index }),
      addChapter(bookId, title) {
        const chapter = { id: uid(), title, text: '' };
        dispatch({ type: 'chapter/add', bookId, chapter });
        return chapter.id;
      },
      updateChapter: (bookId, chapterId, patch) => dispatch({ type: 'chapter/update', bookId, chapterId, patch }),
      deleteChapter: (bookId, chapterId) => dispatch({ type: 'chapter/delete', bookId, chapterId }),
      restoreChapter: (bookId, chapter, index, comments) =>
        dispatch({ type: 'chapter/restore', bookId, chapter, index, comments }),
      addComment(bookId, { chapterId, text, quote = '' }) {
        const comment = { id: uid(), chapterId, author: ME, text, quote, resolved: false, createdAt: now() };
        dispatch({ type: 'comment/add', bookId, comment });
      },
      toggleComment: (bookId, commentId) => dispatch({ type: 'comment/toggle', bookId, commentId }),
      deleteComment: (bookId, commentId) => dispatch({ type: 'comment/delete', bookId, commentId }),
      restoreComment: (bookId, comment, index) => dispatch({ type: 'comment/restore', bookId, comment, index }),
      importBooks: (importedBooks) => dispatch({ type: 'library/import', books: importedBooks }),
    }),
    [],
  );

  const dismissProblem = useCallback(() => {
    setProblem(null);
    setWriteBlocked(false);
  }, []);

  const value = useMemo(
    () => ({ books, ...actions, saveStatus, retrySave: flush, problem, dismissProblem, storage }),
    [books, actions, saveStatus, flush, problem, dismissProblem, storage],
  );
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBooks() {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks must be used inside <BooksProvider>');
  return ctx;
}
