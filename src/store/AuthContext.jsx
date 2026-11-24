import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api as defaultApi } from '../lib/api.js';
import { getBrowserStorage } from './storage.js';

export const LAST_USER_KEY = 'books-app:last-user';

const AuthContext = createContext(null);

function readLastUser(storage) {
  try {
    const value = JSON.parse(storage?.getItem(LAST_USER_KEY) ?? 'null');
    return value && Number.isInteger(value.id) && typeof value.username === 'string' ? value : null;
  } catch {
    return null;
  }
}

function writeLastUser(storage, user) {
  try {
    if (user) storage?.setItem(LAST_USER_KEY, JSON.stringify({ id: user.id, username: user.username }));
    else storage?.removeItem(LAST_USER_KEY);
  } catch {
    // Only used to work offline; not essential.
  }
}

/**
 * Who is signed in.
 *  status: 'loading' | 'ready'
 *  user: { id, username } | null
 *  offline: true when the server couldn't be reached at start-up. The last
 *    signed-in user is assumed so their unsent work stays reachable.
 */
export function AuthProvider({ children, api = defaultApi, storage: storageProp }) {
  const [storage] = useState(() => (storageProp === undefined ? getBrowserStorage() : storageProp));
  const [state, setState] = useState({ status: 'loading', user: null, offline: false });

  const check = useCallback(
    () =>
      api.me().then(
        (user) => {
          writeLastUser(storage, user);
          setState({ status: 'ready', user, offline: false });
        },
        (error) => {
          // Server unreachable: assume the last user, so their unsent work is still shown and kept.
          if (error.offline) setState({ status: 'ready', user: readLastUser(storage), offline: true });
          else setState({ status: 'ready', user: null, offline: false });
        },
      ),
    [api, storage],
  );

  useEffect(() => {
    check();
  }, [check]);

  const signIn = useCallback(
    async (mode, username, password) => {
      const user = mode === 'register' ? await api.register(username, password) : await api.login(username, password);
      writeLastUser(storage, user);
      setState({ status: 'ready', user, offline: false });
      return user;
    },
    [api, storage],
  );

  /**
   * Sign out. Only forgets the user once the server has ended the session:
   * the session cookie is HttpOnly, so if the request fails the browser would
   * still be signed in for the next person at this computer. Throws then.
   * `beforeClear` runs after the server confirmed, before the user is dropped.
   */
  const signOut = useCallback(
    async ({ beforeClear } = {}) => {
      try {
        await api.logout();
      } catch (error) {
        if (error.status !== 401) throw error; // 401: the session was already gone
      }
      beforeClear?.();
      writeLastUser(storage, null);
      setState({ status: 'ready', user: null, offline: false });
    },
    [api, storage],
  );

  /** Called when the server says the session is gone (401). */
  const sessionExpired = useCallback(() => {
    setState((s) => ({ ...s, expired: true }));
  }, []);

  const value = useMemo(
    () => ({ ...state, api, storage, signIn, signOut, recheck: check, sessionExpired }),
    [state, api, storage, signIn, signOut, check, sessionExpired],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
