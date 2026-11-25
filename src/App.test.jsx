import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { safeNext } from './pages/AuthPage.jsx';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { AuthProvider, LAST_USER_KEY } from './store/AuthContext.jsx';
import { BooksProvider, IMPORTED_PREFIX, useBooks } from './store/BooksContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { STORAGE_KEY, serializeLibrary } from './store/storage.js';
import { cacheKey, hashBook, parseCache, serializeCache } from './store/sync.js';
import { makeBook, startServer } from './test/server.js';

let srv;
beforeEach(async () => {
  srv = await startServer();
});
afterEach(async () => {
  await srv.close();
});

function renderApp(path, client, extra = null) {
  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider api={client.api}>
          <BooksProvider>
            <ToastProvider>
              {extra}
              <App />
            </ToastProvider>
          </BooksProvider>
        </AuthProvider>
      </MemoryRouter>
    </ErrorBoundary>,
  );
}

/** A browser signed in as `username`, optionally with books already on the server. */
async function signedInClient(username = 'writer', books = []) {
  const c = srv.client();
  const user = await c.api.register(username, 'long enough');
  for (const b of books) await c.api.saveBook(b, null);
  return { ...c, user };
}

const saveState = () => screen.getByTestId('save-state');
const chapterText = () => screen.getByLabelText('Chapter text');
const serverText = async (client, bookId) =>
  (await client.api.myBooks()).find((b) => b.id === bookId)?.chapters[0].text;
const savedToAccount = () => waitFor(() => expect(saveState()).toHaveTextContent('Saved to your account'));

describe('visitors (signed out)', () => {
  it('can browse and read every book, but not edit', async () => {
    await signedInClient('owner', [makeBook('b1', 'Lantern')]);
    renderApp('/browse', srv.client());
    const link = await screen.findByRole('link', { name: 'Lantern' });
    expect(screen.getByText('by owner')).toBeInTheDocument();

    fireEvent.click(link);
    expect(await screen.findByText('Once upon a time')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('are sent to sign in when opening the editor', async () => {
    renderApp('/books/b1', srv.client());
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('see a welcome page instead of a library', async () => {
    renderApp('/', srv.client());
    expect(await screen.findByRole('heading', { name: 'Write your books here' })).toBeInTheDocument();
  });
});

describe('accounts', () => {
  it('registers with only a username and password and lands in an empty library', async () => {
    renderApp('/register', srv.client());
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'maya' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long enough' } });
    fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'long enough' } });
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Your library' })).toBeInTheDocument();
    expect(screen.getByTitle('Signed in as maya')).toBeInTheDocument();
    expect(srv.db.prepare('SELECT username FROM users').all()).toEqual([{ username: 'maya' }]);
  });

  it('shows the server’s error for a wrong password', async () => {
    await signedInClient('maya');
    renderApp('/login', srv.client());
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'maya' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not my password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password');
  });

  it('won’t let one user edit another user’s book', async () => {
    await signedInClient('owner', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', await signedInClient('other'));
    expect(await screen.findByRole('heading', { name: 'You can’t edit this book' })).toBeInTheDocument();
  });
});

describe('saving to the account', () => {
  it('saves edits to the server and says so', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', c);
    fireEvent.change(await screen.findByLabelText('Chapter text'), { target: { value: 'Once upon a midnight' } });
    expect(saveState()).toHaveTextContent('Saving…');
    await savedToAccount();
    expect(await serverText(c, 'b1')).toBe('Once upon a midnight');
  });

  it('keeps edits in this browser while offline, and sends them when back', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();

    c.net.offline = true;
    fireEvent.change(chapterText(), { target: { value: 'Written on a train' } });
    await waitFor(() => expect(saveState()).toHaveTextContent('kept in this browser'));
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t reach the server');
    const cache = parseCache(localStorage.getItem(cacheKey(c.user.id)));
    expect(cache.books[0].chapters[0].text).toBe('Written on a train');

    c.net.offline = false;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await savedToAccount();
    expect(await serverText(c, 'b1')).toBe('Written on a train');
  });

  it('keeps typing in this browser while a slow save is still in flight', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();

    let release;
    c.net.gate = new Promise((r) => {
      release = r;
    });
    fireEvent.change(chapterText(), { target: { value: 'First' } });
    // The first save is now stuck on the network; keep typing.
    await waitFor(() => expect(c.net.calls.at(-1)).toBe('PUT /api/me/books/b1'));
    fireEvent.change(chapterText(), { target: { value: 'First and second' } });
    await waitFor(() =>
      expect(parseCache(localStorage.getItem(cacheKey(c.user.id))).books[0].chapters[0].text).toBe('First and second'),
    );

    c.net.gate = null;
    release();
    await waitFor(async () => expect(await serverText(c, 'b1')).toBe('First and second'));
  });

  it('keeps typing done while the first load is still in flight after starting offline', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    // A previous visit left the library in this browser.
    const seed = renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();
    seed.unmount();

    // Start offline: the copy in this browser opens, and the first load fails.
    c.net.offline = true;
    renderApp('/books/b1', c);
    await waitFor(() => expect(saveState()).toHaveTextContent('kept in this browser'));
    fireEvent.change(chapterText(), { target: { value: 'Typed offline' } });

    // Back online, but the first load is slow; keep typing while it's in flight.
    let release;
    c.net.gate = new Promise((r) => {
      release = r;
    });
    c.net.offline = false;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(c.net.calls.at(-1)).toBe('GET /api/me/books'));
    fireEvent.change(chapterText(), { target: { value: 'Typed offline, and while loading' } });
    c.net.gate = null;
    release();

    await waitFor(async () => expect(await serverText(c, 'b1')).toBe('Typed offline, and while loading'));
    expect(chapterText()).toHaveValue('Typed offline, and while loading');
  });

  it('sends edits left unsent last time when the app opens again', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    const first = renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    c.net.offline = true;
    fireEvent.change(chapterText(), { target: { value: 'Unsent' } });
    await waitFor(() => expect(saveState()).toHaveTextContent('kept in this browser'));
    first.unmount();

    c.net.offline = false;
    renderApp('/books/b1', c);
    await waitFor(async () => expect(await serverText(c, 'b1')).toBe('Unsent'));
  });

  it('when another device saved a newer version, shows it and offers this one for download', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    const otherDevice = srv.client();
    await otherDevice.api.login('writer', 'long enough');
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();

    // The other device saves an edit dated in the future (newer than ours will be).
    const newer = makeBook('b1', 'Lantern', {
      updatedAt: '2099-01-01T00:00:00.000Z',
      chapters: [{ id: 'b1-c1', title: 'Opening', text: 'From the other device' }],
    });
    await otherDevice.api.saveBook(newer, 1);

    fireEvent.change(chapterText(), { target: { value: 'From this tab' } });
    await waitFor(() => expect(chapterText()).toHaveValue('From the other device'));
    await savedToAccount();
    expect(await serverText(c, 'b1')).toBe('From the other device');
  });

  it('keeps typing done during a save that turns out to conflict, and keeps it across reloads', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    const otherDevice = srv.client();
    await otherDevice.api.login('writer', 'long enough');
    const first = renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();

    // A save is in flight (stuck on the network) ...
    let release;
    c.net.gate = new Promise((r) => {
      release = r;
    });
    fireEvent.change(chapterText(), { target: { value: 'Sent' } });
    await waitFor(() => expect(c.net.calls.at(-1)).toBe('PUT /api/me/books/b1'));
    // ... the writer keeps typing, and meanwhile another device saves a newer version.
    fireEvent.change(chapterText(), { target: { value: 'Sent, and typed while sending' } });
    await otherDevice.api.saveBook(
      makeBook('b1', 'Lantern', {
        updatedAt: '2099-01-01T00:00:00.000Z',
        chapters: [{ id: 'b1-c1', title: 'Opening', text: 'From the other device' }],
      }),
      1,
    );
    c.net.gate = null;
    release();

    await waitFor(() => expect(chapterText()).toHaveValue('From the other device'));
    // The notice is shown right here in the editor ...
    expect(await screen.findByRole('button', { name: 'Download this browser’s version' })).toBeInTheDocument();
    // ... and the full local version, including what was typed during the save, is kept.
    await waitFor(() =>
      expect(parseCache(localStorage.getItem(cacheKey(c.user.id))).losers[0].chapters[0].text).toBe(
        'Sent, and typed while sending',
      ),
    );

    first.unmount();
    renderApp('/books/b1', c);
    expect(await screen.findByRole('button', { name: 'Download this browser’s version' })).toBeInTheDocument();
  });

  it('when this edit is newer than another device’s, saves it on top', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    const otherDevice = srv.client();
    await otherDevice.api.login('writer', 'long enough');
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();
    await otherDevice.api.saveBook(
      makeBook('b1', 'Lantern', {
        updatedAt: '2026-01-02T00:00:00.000Z',
        chapters: [{ id: 'b1-c1', title: 'Opening', text: 'Older edit elsewhere' }],
      }),
      1,
    );

    fireEvent.change(chapterText(), { target: { value: 'Newest words' } });
    await waitFor(async () => expect(await serverText(c, 'b1')).toBe('Newest words'));
    expect(chapterText()).toHaveValue('Newest words');
    // The other device's version was replaced on the server, so it's kept here for download.
    expect(await screen.findByRole('button', { name: 'Download the other version' })).toBeInTheDocument();
    const cache = parseCache(localStorage.getItem(cacheKey(c.user.id)));
    expect(cache.losers.map((l) => [l.conflictFrom, l.chapters[0].text])).toEqual([
      ['elsewhere', 'Older edit elsewhere'],
    ]);
  });

  it('asks to sign in again when the session ends, keeping the work', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    srv.db.prepare('DELETE FROM sessions').run();

    fireEvent.change(chapterText(), { target: { value: 'After expiry' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('You’ve been signed out');
    expect(parseCache(localStorage.getItem(cacheKey(c.user.id))).books[0].chapters[0].text).toBe('After expiry');
  });

  it('saves edits waiting for the timer to this browser when a crash unmounts the app', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bomb() {
      const { books } = useBooks();
      if (books.some((b) => b.chapters.some((ch) => ch.text.includes('BOOM')))) throw new Error('render bug');
      return null;
    }
    renderApp('/books/b1', c, <Bomb />);
    await screen.findByLabelText('Chapter text');
    fireEvent.change(chapterText(), { target: { value: 'Typed just before the crash' } });
    fireEvent.change(chapterText(), { target: { value: 'BOOM' } });
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    const cache = parseCache(localStorage.getItem(cacheKey(c.user.id)));
    expect(cache.books[0].chapters[0].text).toBe('Typed just before the crash');
  });

  it('clears this browser’s copy on sign-out when everything reached the server', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/', c);
    await screen.findByRole('heading', { name: 'Your library' });
    await waitFor(() => expect(localStorage.getItem(cacheKey(c.user.id))).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Browse' });
    expect(localStorage.getItem(cacheKey(c.user.id))).toBeNull();
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('stays signed in when signing out fails, so the next person isn’t signed in as you', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/', c);
    await screen.findByRole('heading', { name: 'Your library' });
    await waitFor(() => expect(localStorage.getItem(cacheKey(c.user.id))).not.toBeNull());

    c.net.offline = true;
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/Couldn’t sign out/)).toBeInTheDocument();
    expect(screen.getByTitle('Signed in as writer')).toBeInTheDocument();
    expect(localStorage.getItem(LAST_USER_KEY)).not.toBeNull();
    expect(localStorage.getItem(cacheKey(c.user.id))).not.toBeNull();

    c.net.offline = false;
    expect((await c.api.me()).username).toBe('writer'); // the session is still alive on the server
  });

  it('keeps conflict versions waiting for download through a sign-out', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    const otherDevice = srv.client();
    await otherDevice.api.login('writer', 'long enough');
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();
    await otherDevice.api.saveBook(
      makeBook('b1', 'Lantern', {
        updatedAt: '2099-01-01T00:00:00.000Z',
        chapters: [{ id: 'b1-c1', title: 'Opening', text: 'From the other device' }],
      }),
      1,
    );
    fireEvent.change(chapterText(), { target: { value: 'Mine' } });
    await screen.findByRole('button', { name: 'Download this browser’s version' });
    await savedToAccount();

    fireEvent.click(screen.getByRole('link', { name: 'Back to library' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Browse' });
    expect(confirm.mock.calls[0][0]).toMatch(/1 conflicting version is waiting/);
    const cache = parseCache(localStorage.getItem(cacheKey(c.user.id)));
    expect(cache.losers[0].chapters[0].text).toBe('Mine');
  });

  it('asks before signing out with unsent work, and keeps it', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    c.net.offline = true;
    fireEvent.change(chapterText(), { target: { value: 'Unsent' } });
    await waitFor(() => expect(saveState()).toHaveTextContent('kept in this browser'));
    c.net.offline = false;
    // The editor has no sign-out button; go via the library.
    fireEvent.click(screen.getByRole('link', { name: 'Back to library' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByTitle('Signed in as writer')).toBeInTheDocument();
  });
});

describe('development mode (StrictMode)', () => {
  it('still records what the server confirmed after StrictMode’s extra mount', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/books/b1']}>
          <AuthProvider api={c.api}>
            <BooksProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    fireEvent.change(await screen.findByLabelText('Chapter text'), { target: { value: 'Dev mode words' } });
    await savedToAccount();
    const serverRevision = (await c.api.myBooks())[0].revision;
    expect(serverRevision).toBe(2);
    await waitFor(() =>
      expect(parseCache(localStorage.getItem(cacheKey(c.user.id))).revisions.b1).toBe(serverRevision),
    );
  });
});

describe('safe redirects after sign-in', () => {
  it('only allows paths on this site', () => {
    expect(safeNext('/books/1?chapter=2')).toBe('/books/1?chapter=2');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example/')).toBe('/');
    expect(safeNext('/\tevil')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('importing the pre-accounts library', () => {
  it('reads the old data without writing anything on each load', async () => {
    // Partly damaged old data: one readable book and one junk entry.
    const raw = JSON.stringify([makeBook('old1', 'Readable'), 'junk']);
    localStorage.setItem('books-app:v1', raw);
    const c = await signedInClient('writer');
    const keysBefore = Object.keys(localStorage).filter((k) => k.startsWith('books-app:recovery:'));
    for (let i = 0; i < 3; i += 1) {
      const view = renderApp('/', c);
      await screen.findByRole('region', { name: 'Import the books saved in this browser?' });
      view.unmount();
    }
    expect(Object.keys(localStorage).filter((k) => k.startsWith('books-app:recovery:'))).toEqual(keysBefore);
    expect(localStorage.getItem('books-app:v1')).toBe(raw);
  });

  it('tells the writer about old data that can’t be read at all, instead of hiding it', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const c = await signedInClient('writer');
    renderApp('/', c);
    const notice = await screen.findByRole('region', { name: 'Books saved in this browser couldn’t be read' });
    expect(within(notice).getByRole('button', { name: 'Download original data' })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json');
  });

  it('never offers the import again, even when there was no room to keep a copy', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('old1', 'From before accounts')]));
    const c = await signedInClient('writer');
    const view = renderApp('/', c);
    const notice = await screen.findByRole('region', { name: 'Import the books saved in this browser?' });
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (k.startsWith(IMPORTED_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      return realSetItem.call(this, k, v);
    });
    fireEvent.click(within(notice).getByRole('button', { name: 'Import 1 book' }));
    spy.mockRestore();
    await waitFor(async () => expect((await c.api.myBooks()).map((b) => b.title)).toEqual(['From before accounts']));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull(); // the old data wasn't removed without a copy
    view.unmount();

    renderApp('/', c);
    await screen.findByRole('heading', { name: 'Your library' });
    expect(screen.queryByRole('region', { name: /Import the books/ })).toBeNull();
  });

  it('does not import twice when another tab already did', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('old1', 'From before accounts')]));
    const c = await signedInClient('writer');
    renderApp('/', c);
    const notice = await screen.findByRole('region', { name: 'Import the books saved in this browser?' });
    localStorage.removeItem(STORAGE_KEY); // another tab imported it meanwhile
    fireEvent.click(within(notice).getByRole('button', { name: 'Import 1 book' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Import the books/ })).toBeNull());
    await new Promise((r) => setTimeout(r, 600));
    expect(await c.api.myBooks()).toEqual([]);
  });

  it('offers to import it after signing in, then saves it to the account', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('old1', 'From before accounts')]));
    const c = await signedInClient('writer');
    renderApp('/', c);

    const notice = await screen.findByRole('region', { name: 'Import the books saved in this browser?' });
    fireEvent.click(within(notice).getByRole('button', { name: 'Import 1 book' }));

    expect(await screen.findByRole('heading', { name: 'From before accounts' })).toBeInTheDocument();
    await waitFor(async () => expect((await c.api.myBooks()).map((b) => b.title)).toEqual(['From before accounts']));
    // Not offered again, and the original is kept.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(Object.keys(localStorage).some((k) => k.startsWith(IMPORTED_PREFIX))).toBe(true);
  });
});

describe('editor details kept from before', () => {
  it('limits fields to what the server accepts, so one long entry can’t block saving', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1?comments=1', c);
    expect(await screen.findByLabelText('Chapter title')).toHaveAttribute('maxLength', '200');
    expect(screen.getByLabelText('Chapter text')).toHaveAttribute('maxLength', '2000000');
    expect(screen.getByLabelText('Add a comment')).toHaveAttribute('maxLength', '5000');
  });

  it('deletes a comment without a prompt and can undo it', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1?comments=1', c);
    const panel = await screen.findByRole('complementary', { name: 'Comments' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
    expect(within(panel).queryByText('Tighten this')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(panel).getByText('Tighten this')).toBeInTheDocument();
  });

  it('closes the slide-over comments panel with Escape', async () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(max-width: 1199px)', media: q }));
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/books/b1?comments=1', c);
    await screen.findByLabelText('Chapter text');
    const toggle = screen.getByRole('button', { name: /^Comments, / });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The panel's effects (focus, Escape listener) have run once focus is inside it.
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Close comments'));
    fireEvent.keyDown(chapterText(), { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('imports a backup file into the account', async () => {
    const c = await signedInClient('writer');
    renderApp('/', c);
    await screen.findByRole('heading', { name: 'Your library' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const file = new File(
      [JSON.stringify({ app: 'books', version: 2, books: [makeBook('x1', 'From a backup')] })],
      'backup.json',
      { type: 'application/json' },
    );
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'From a backup' })).toBeInTheDocument();
    await waitFor(async () => expect((await c.api.myBooks()).map((b) => b.title)).toEqual(['From a backup']));
  });
});

describe('two tabs of the same account', () => {
  it('shares conflict versions between tabs without rewriting the copy back and forth', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern')]);
    renderApp('/', c);
    await screen.findByRole('heading', { name: 'Your library' });
    const key = cacheKey(c.user.id);
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull());

    // The other tab holds a conflict version and writes its copy.
    const cache = parseCache(localStorage.getItem(key));
    const loser = { ...cache.books[0], title: 'Lantern (other tab)', conflictId: 'k1', conflictFrom: 'this-browser' };
    const fromTab2 = serializeCache({ ...cache, losers: [loser], dismissed: [] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    act(() => {
      localStorage.setItem(key, fromTab2);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: fromTab2, storageArea: localStorage }));
    });
    expect(await screen.findByText(/“Lantern \(other tab\)” was also changed/)).toBeInTheDocument();
    setItem.mockClear();
    await new Promise((r) => setTimeout(r, 900));
    // Nothing new to say, so this tab doesn't write (which would wake the other tab, and so on).
    expect(setItem.mock.calls.filter(([k]) => k === key)).toEqual([]);

    // Dismissed in the other tab: gone here too, and not brought back.
    const dismissedThere = serializeCache({ ...cache, losers: [], dismissed: ['k1'] });
    act(() => {
      localStorage.setItem(key, dismissedThere);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: dismissedThere, storageArea: localStorage }));
    });
    await waitFor(() => expect(screen.queryByText(/was also changed/)).toBeNull());
  });

  it('takes the other tab’s saved copy without re-sending it', async () => {
    const c = await signedInClient('writer', [makeBook('b1', 'Lantern'), makeBook('b2', 'Salt')]);
    renderApp('/books/b1', c);
    await screen.findByLabelText('Chapter text');
    await savedToAccount();

    // The other tab edited b2, saved it to the server and wrote its copy.
    const key = cacheKey(c.user.id);
    const cache = parseCache(localStorage.getItem(key));
    const b2 = cache.books.find((b) => b.id === 'b2');
    const edited = { ...b2, updatedAt: '2026-05-01T00:00:00.000Z', chapters: [{ ...b2.chapters[0], text: 'Other tab' }] };
    const { revision } = await c.api.saveBook(edited, cache.revisions.b2);
    const next = serializeCache({
      books: cache.books.map((b) => (b.id === 'b2' ? edited : b)),
      synced: { ...cache.synced, b2: hashBook(edited) },
      revisions: { ...cache.revisions, b2: revision },
    });
    const before = c.net.calls.length;
    act(() => {
      localStorage.setItem(key, next);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: next, storageArea: localStorage }));
    });

    fireEvent.change(chapterText(), { target: { value: 'This tab' } });
    await waitFor(async () => expect(await serverText(c, 'b1')).toBe('This tab'));
    await savedToAccount();
    const puts = c.net.calls.slice(before).filter((call) => call.startsWith('PUT'));
    expect(puts).toEqual(['PUT /api/me/books/b1']);
    expect((await c.api.myBooks()).find((b) => b.id === 'b2').chapters[0].text).toBe('Other tab');
  });
});
