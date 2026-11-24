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
import { uid } from '../lib/utils.js';
import { useAuth } from './AuthContext.jsx';
import { reducer } from './reducer.js';
import { LEGACY_KEY, STORAGE_KEY, peekLegacy, preserveRaw } from './storage.js';
import {
  cacheKey,
  fromServer,
  hashBook,
  parseCache,
  pendingChanges,
  reconcile,
  serializeCache,
} from './sync.js';

/* eslint-disable react-refresh/only-export-components -- constants shared with tests */
/** How long to wait after the last edit before saving. */
export const SAVE_DELAY_MS = 400;
/** Waits between retries while the server can't be reached. */
export const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];
/** Prefix for the copy of a pre-accounts library kept after importing it. */
export const IMPORTED_PREFIX = 'books-app:imported:';
/** Set once the pre-accounts library has been imported, so it's never offered twice. */
export const IMPORT_MARKER_KEY = 'books-app:imported-at';
/** At most this many conflict versions are kept for download. */
export const MAX_LOSERS = 20;

/* eslint-enable react-refresh/only-export-components */

const BooksContext = createContext(null);
const now = () => new Date().toISOString();

const SIGNED_OUT = {
  signedIn: false,
  ready: true,
  books: [],
  saveStatus: 'saved',
  saveError: null,
  problem: null,
  legacy: null,
  losers: [],
};

/**
 * The signed-in user's own books, kept in sync with the server.
 * Signed out, there are no own books: pages show the public catalogue.
 */
export function BooksProvider({ children }) {
  const { user } = useAuth();
  if (!user) return <BooksContext.Provider value={SIGNED_OUT}>{children}</BooksContext.Provider>;
  return (
    <UserBooksProvider key={user.id} user={user}>
      {children}
    </UserBooksProvider>
  );
}

/** The pre-accounts library, read without side effects (see peekLegacy). */
function readLegacy(storage) {
  if (!storage) return null;
  try {
    if (storage.getItem(IMPORT_MARKER_KEY)) return null;
  } catch {
    return null;
  }
  return peekLegacy(storage);
}

/**
 * saveStatus:
 *  'saved'   - the server has everything on screen
 *  'pending' - edits are waiting to be sent
 *  'error'   - sending failed; saveError says why:
 *      { kind: 'offline' }     server unreachable (retrying); work is kept in this browser
 *      { kind: 'signed-out' }  the session ended; sign in again to send the work
 *      { kind: 'rejected', message }  the server refused a book (e.g. too large)
 *  cachedLocally: whether this browser's copy is up to date (false = at risk)
 */
function UserBooksProvider({ user, children }) {
  const { api, storage, sessionExpired } = useAuth();
  const key = cacheKey(user.id);

  const [initial] = useState(() => {
    let raw = null;
    try {
      raw = storage?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    try {
      return { cache: parseCache(raw), raw, problem: null };
    } catch {
      const backupKey = preserveRaw(storage, raw);
      return { cache: null, problem: { kind: 'corrupt', raw, backupKey, dropped: 0 } };
    }
  });

  const [books, dispatch] = useReducer(reducer, initial.cache?.books ?? []);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('pending');
  const [saveError, setSaveError] = useState(null);
  const [cachedLocally, setCachedLocally] = useState(true);
  const [problem, setProblem] = useState(initial.problem);
  const [losers, setLosers] = useState(initial.cache?.losers ?? []);
  const [legacy, setLegacy] = useState(() => readLegacy(storage));

  const synced = useRef(initial.cache?.synced ?? {});
  const revisions = useRef(initial.cache?.revisions ?? {});
  const latest = useRef(books);
  const loaded = useRef(false);
  const cachedBooks = useRef(initial.cache?.books ?? null); // books array last written to (or read from) the cache
  const confirmedBooks = useRef(null); // books array the server last fully confirmed
  const timer = useRef(null);
  const retryTimer = useRef(null);
  const retryIndex = useRef(0);
  const running = useRef(false);
  const again = useRef(false);
  const unmounted = useRef(false);
  const losersRef = useRef(initial.cache?.losers ?? []);
  const dismissedRef = useRef(initial.cache?.dismissed ?? []);
  const lastCacheJson = useRef(initial.raw ?? null); // what the cache holds, so identical writes are skipped

  useLayoutEffect(() => {
    latest.current = books;
  }, [books]);

  const writeCache = useCallback(() => {
    const current = latest.current;
    try {
      const json = serializeCache({
        books: current,
        synced: synced.current,
        revisions: revisions.current,
        losers: losersRef.current,
        dismissed: dismissedRef.current,
      });
      // Skip identical writes: they would wake other tabs for nothing.
      if (json !== lastCacheJson.current) {
        storage.setItem(key, json);
        lastCacheJson.current = json;
      }
      cachedBooks.current = current;
      setCachedLocally(true);
      return true;
    } catch {
      setCachedLocally(false);
      return false;
    }
  }, [key, storage]);

  /** Versions that lost to a newer edit elsewhere: kept (in the cache too) until dismissed. */
  const addLosers = useCallback((list) => {
    if (!list.length) return;
    const tagged = list.map((b) => ({ ...b, conflictId: b.conflictId ?? uid() }));
    losersRef.current = [...losersRef.current, ...tagged].slice(-MAX_LOSERS);
    setLosers(losersRef.current);
  }, []);

  const scheduleRetry = useCallback((fn) => {
    clearTimeout(retryTimer.current);
    const delay = RETRY_DELAYS_MS[Math.min(retryIndex.current, RETRY_DELAYS_MS.length - 1)];
    retryIndex.current += 1;
    retryTimer.current = setTimeout(fn, delay);
  }, []);

  const syncRef = useRef(null);

  /** Load from the server (first time), then send every pending change. */
  const sync = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    clearTimeout(retryTimer.current);
    try {
      let current = latest.current;

      if (!loaded.current) {
        const serverBooks = await api.myBooks();
        // Reconcile what's on screen now, not before the request: the writer
        // may have typed or imported while it was in flight (e.g. after
        // starting offline), and replacing the library must not undo that.
        const result = reconcile(
          { books: latest.current, synced: synced.current, revisions: revisions.current },
          serverBooks,
        );
        synced.current = result.synced;
        revisions.current = result.revisions;
        loaded.current = true;
        current = result.books;
        latest.current = current;
        dispatch({ type: 'library/replace', books: current });
        addLosers(result.losers);
        setReady(true);
      }

      const { dirty, deleted } = pendingChanges(current, synced.current);
      let rejected = null;

      for (const book of dirty) {
        try {
          const { revision } = await api.saveBook(book, revisions.current[book.id]);
          synced.current = { ...synced.current, [book.id]: hashBook(book) };
          revisions.current = { ...revisions.current, [book.id]: revision };
        } catch (error) {
          if (error.status === 409 && error.body?.current) {
            const server = fromServer(error.body.current);
            synced.current = { ...synced.current, [book.id]: hashBook(server) };
            revisions.current = { ...revisions.current, [book.id]: error.body.current.revision };
            // Compare with what's on screen now, not the copy that was sent:
            // the writer may have kept typing while the request was in flight.
            const mine = latest.current.find((b) => b.id === book.id) ?? book;
            if (server.updatedAt > mine.updatedAt) {
              // Edited more recently elsewhere: show that, keep ours (all of it) downloadable.
              dispatch({ type: 'book/replace', book: server });
              addLosers([{ ...mine, conflictFrom: 'this-browser' }]);
            } else {
              // Ours is newer: send it again on top of theirs, but keep theirs
              // downloadable, since saving ours replaces it on the server.
              addLosers([{ ...server, conflictFrom: 'elsewhere' }]);
              again.current = true;
            }
          } else if (error.status === 400 || error.status === 403 || error.status === 413) {
            rejected = { kind: 'rejected', message: `“${book.title}” couldn’t be saved: ${error.message}` };
          } else {
            throw error;
          }
        }
      }

      for (const id of deleted) {
        try {
          await api.deleteBook(id, revisions.current[id]);
          const { [id]: _s, ...s } = synced.current;
          const { [id]: _r, ...r } = revisions.current;
          synced.current = s;
          revisions.current = r;
        } catch (error) {
          if (error.status === 409 && error.body?.current) {
            // Edited elsewhere after we deleted it: an edit beats a delete.
            const server = fromServer(error.body.current);
            synced.current = { ...synced.current, [id]: hashBook(server) };
            revisions.current = { ...revisions.current, [id]: error.body.current.revision };
            dispatch({ type: 'book/replace', book: server });
          } else if (error.status === 403) {
            rejected = { kind: 'rejected', message: error.message };
          } else {
            throw error;
          }
        }
      }

      retryIndex.current = 0;
      if (rejected) {
        setSaveError(rejected);
        setSaveStatus('error');
      } else if (latest.current === current && !again.current) {
        confirmedBooks.current = current;
        setSaveError(null);
        setSaveStatus('saved');
      }
    } catch (error) {
      if (error.status === 401) {
        setSaveError({ kind: 'signed-out' });
        sessionExpired();
      } else {
        setSaveError({ kind: 'offline' });
        if (!unmounted.current) scheduleRetry(() => syncRef.current());
      }
      setSaveStatus('error');
      setReady(true);
    } finally {
      running.current = false;
      if (!unmounted.current) writeCache();
      if (again.current && !unmounted.current) {
        again.current = false;
        syncRef.current();
      }
    }
  }, [addLosers, api, scheduleRetry, sessionExpired, writeCache]);

  useLayoutEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // First load (started from a promise callback, not synchronously in the effect).
  useEffect(() => {
    Promise.resolve().then(() => syncRef.current());
  }, []);

  // After each edit: save to this browser and send to the server shortly.
  // (Also before the first load succeeds, e.g. offline: edits still go to this browser's copy.)
  useEffect(() => {
    if (books === confirmedBooks.current || books === cachedBooks.current) return undefined;
    setSaveStatus((s) => (s === 'error' ? 'error' : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      writeCache();
      sync();
    }, SAVE_DELAY_MS);
    return undefined;
  }, [books, sync, writeCache]);

  // Signed in again after the session expired (same account, so this provider
  // stayed mounted): send what's waiting.
  const firstUser = useRef(user);
  const saveErrorRef = useRef(saveError);
  useEffect(() => {
    saveErrorRef.current = saveError;
  }, [saveError]);
  useEffect(() => {
    if (user === firstUser.current) return;
    firstUser.current = user;
    if (saveErrorRef.current?.kind === 'signed-out') {
      retryIndex.current = 0;
      sync();
    }
  }, [user, sync]);

  // Retry as soon as the connection comes back.
  useEffect(() => {
    const onOnline = () => {
      retryIndex.current = 0;
      sync();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [sync]);

  // Keep this browser's copy current when the page is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (latest.current !== cachedBooks.current) writeCache();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    const onBeforeUnload = (e) => {
      onHide();
      if (latest.current !== cachedBooks.current) {
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
  }, [writeCache]);

  // Another tab of the same user saved: merge its copy.
  useEffect(() => {
    if (!storage) return undefined;
    function onStorage(e) {
      if (e.key !== key || e.newValue == null || e.storageArea !== storage) return;
      let remote;
      try {
        remote = parseCache(e.newValue);
      } catch {
        return;
      }
      if (!remote) return;
      // Adopt what the other tab already sent to the server.
      const s = { ...synced.current };
      const r = { ...revisions.current };
      for (const [id, rev] of Object.entries(remote.revisions)) {
        if (!(rev <= (r[id] ?? 0))) {
          r[id] = rev;
          if (remote.synced[id]) s[id] = remote.synced[id];
        }
      }
      synced.current = s;
      revisions.current = r;
      // Conflict versions: keep both tabs' (by conflictId), minus any dismissed in either.
      const dismissed = [...new Set([...dismissedRef.current, ...remote.dismissed])].slice(-100);
      const gone = new Set(dismissed);
      const byId = new Map();
      for (const l of [...losersRef.current, ...remote.losers]) {
        if (l.conflictId && !gone.has(l.conflictId)) byId.set(l.conflictId, l);
      }
      dismissedRef.current = dismissed;
      losersRef.current = [...byId.values()].slice(-MAX_LOSERS);
      setLosers(losersRef.current);
      lastCacheJson.current = e.newValue;
      dispatch({ type: 'library/merge', base: cachedBooks.current ?? [], remote: remote.books });
      cachedBooks.current = remote.books;
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, storage]);

  // On unmount (sign-out, crash), keep unsaved edits in this browser.
  useEffect(() => {
    // Reset on (re)mount: StrictMode in development unmounts and remounts once.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      clearTimeout(timer.current);
      clearTimeout(retryTimer.current);
      if (latest.current !== cachedBooks.current) writeCache();
    };
  }, [writeCache]);

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
        const comment = {
          id: uid(),
          chapterId,
          author: user.username,
          text,
          quote,
          resolved: false,
          createdAt: now(),
        };
        dispatch({ type: 'comment/add', bookId, comment });
      },
      toggleComment: (bookId, commentId) => dispatch({ type: 'comment/toggle', bookId, commentId }),
      deleteComment: (bookId, commentId) => dispatch({ type: 'comment/delete', bookId, commentId }),
      restoreComment: (bookId, comment, index) => dispatch({ type: 'comment/restore', bookId, comment, index }),
      importBooks: (importedBooks) => dispatch({ type: 'library/import', books: importedBooks }),
    }),
    [user.username],
  );

  /** Add the pre-accounts library from this browser to the account. */
  const importLegacy = useCallback(() => {
    // Re-read: another tab may have imported it already (that would add duplicates).
    const current = readLegacy(storage);
    if (!current || current.books.length === 0) {
      setLegacy(current);
      return 0;
    }
    dispatch({ type: 'library/import', books: current.books.map(prepareImport) });
    // First a tiny marker so it's never offered again (importing twice would
    // add duplicates), then a copy of the old data, and only then remove it.
    try {
      storage.setItem(IMPORT_MARKER_KEY, new Date().toISOString());
    } catch {
      // Storage completely full; the copy below will most likely fail too.
    }
    try {
      storage.setItem(`${IMPORTED_PREFIX}${Date.now()}`, current.raw);
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(LEGACY_KEY);
    } catch {
      // No room for a copy: leave the old data where it is (the marker stops the offer).
    }
    setLegacy(null);
    return current.books.length;
  }, [storage]);

  const dismissLegacy = useCallback(() => setLegacy(null), []);
  const dismissProblem = useCallback(() => setProblem(null), []);
  const dismissLoser = useCallback(
    (book) => {
      losersRef.current = losersRef.current.filter((b) => b !== book);
      if (book.conflictId) dismissedRef.current = [...dismissedRef.current, book.conflictId].slice(-100);
      setLosers(losersRef.current);
      writeCache();
    },
    [writeCache],
  );

  const retrySave = useCallback(() => {
    retryIndex.current = 0;
    writeCache();
    sync();
  }, [sync, writeCache]);

  /** True when everything has reached the server. */
  const isFullySynced = useCallback(() => {
    if (!loaded.current) return false;
    const { dirty, deleted } = pendingChanges(latest.current, synced.current);
    return dirty.length === 0 && deleted.length === 0;
  }, []);

  /**
   * After signing out: drop this browser's copy if the server has it all and
   * no conflict versions are waiting to be downloaded or dismissed.
   */
  const forgetLocalCopy = useCallback(() => {
    if (!isFullySynced() || losersRef.current.length > 0) return false;
    try {
      storage?.removeItem(key);
      cachedBooks.current = latest.current; // nothing left to protect on unmount
      return true;
    } catch {
      return false;
    }
  }, [isFullySynced, key, storage]);

  const value = useMemo(
    () => ({
      signedIn: true,
      ready,
      books,
      ...actions,
      saveStatus,
      saveError,
      cachedLocally,
      retrySave,
      problem,
      dismissProblem,
      legacy,
      importLegacy,
      dismissLegacy,
      losers,
      dismissLoser,
      isFullySynced,
      forgetLocalCopy,
      storage,
    }),
    [
      ready,
      books,
      actions,
      saveStatus,
      saveError,
      cachedLocally,
      retrySave,
      problem,
      dismissProblem,
      legacy,
      importLegacy,
      dismissLegacy,
      losers,
      dismissLoser,
      isFullySynced,
      forgetLocalCopy,
      storage,
    ],
  );

  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

/**
 * A pre-accounts book, ready to send to the server: fresh ids (the old ones
 * could exist on the server already, e.g. imported by someone else from the
 * same browser) and fields trimmed to the server's limits.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function prepareImport(book) {
  const chapterIds = new Map(book.chapters.map((c) => [c.id, uid()]));
  return {
    ...book,
    id: uid(),
    title: clip(book.title, 120).trim() || 'Untitled book',
    genre: clip(book.genre, 40),
    goal: Math.min(book.goal, 10_000_000),
    chapters: book.chapters.map((c) => ({ id: chapterIds.get(c.id), title: clip(c.title, 200), text: clip(c.text, 2_000_000) })),
    comments: book.comments.map((c) => ({
      id: uid(),
      chapterId: chapterIds.get(c.chapterId),
      author: clip(c.author, 100).trim() || 'Unknown',
      text: clip(c.text, 5000),
      quote: clip(c.quote, 500),
      resolved: c.resolved,
      createdAt: c.createdAt,
    })),
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBooks() {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooks must be used inside <BooksProvider>');
  return ctx;
}
