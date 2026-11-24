// Client for the Books server API.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status, or 0 when the server couldn't be reached
   * @param {string} message
   * @param {object} [body] the parsed response body
   */
  constructor(status, message, body = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get offline() {
    return this.status === 0 || this.status >= 500;
  }
}

export function createApi({ baseUrl = '', fetchImpl = (...args) => fetch(...args) } = {}) {
  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Books-Client': '1',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Can’t reach the server. Check your connection.');
    }
    if (res.status === 204) return {};
    let data = {};
    try {
      data = await res.json();
    } catch {
      // Not JSON (e.g. a proxy error page).
    }
    if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data);
    return data;
  }

  return {
    me: () => request('GET', '/auth/me').then((d) => d.user ?? null),
    register: (username, password) => request('POST', '/auth/register', { username, password }).then((d) => d.user),
    login: (username, password) => request('POST', '/auth/login', { username, password }).then((d) => d.user),
    logout: () => request('POST', '/auth/logout'),
    listBooks: () => request('GET', '/books').then((d) => d.books),
    getBook: (id) => request('GET', `/books/${encodeURIComponent(id)}`).then((d) => d.book),
    myBooks: () => request('GET', '/me/books').then((d) => d.books),
    /** Resolves { revision }. Rejects with ApiError 409 (body.current) when stale. */
    saveBook: (book, baseRevision) =>
      request('PUT', `/me/books/${encodeURIComponent(book.id)}`, { book, baseRevision: baseRevision ?? null }),
    deleteBook: (id, baseRevision) =>
      request(
        'DELETE',
        `/me/books/${encodeURIComponent(id)}${baseRevision != null ? `?baseRevision=${baseRevision}` : ''}`,
      ),
  };
}

export const api = createApi();
