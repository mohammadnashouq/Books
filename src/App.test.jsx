import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { BooksProvider, useBooks } from './store/BooksContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { LEGACY_KEY, RECOVERY_PREFIX, STORAGE_KEY, serializeLibrary } from './store/storage.js';

const T0 = '2026-01-01T00:00:00.000Z';

function makeBook(id, title, extra = {}) {
  return {
    id,
    title,
    genre: 'Fantasy',
    status: 'draft',
    goal: 1000,
    color: 'violet',
    createdAt: T0,
    updatedAt: T0,
    chapters: [{ id: `${id}-c1`, title: 'Opening', text: 'Once upon a time' }],
    comments: [
      { id: `${id}-m1`, chapterId: `${id}-c1`, author: 'You', text: 'Tighten this', quote: '', resolved: false, createdAt: T0 },
    ],
    ...extra,
  };
}

function renderApp(path = '/') {
  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <BooksProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BooksProvider>
      </MemoryRouter>
    </ErrorBoundary>,
  );
}

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY));
const saveState = () => screen.getByTestId('save-state');
const chapterText = () => screen.getByLabelText('Chapter text');

describe('saving', () => {
  it('shows the real save state and writes after a short delay', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1');
    expect(saveState()).toHaveTextContent('Saved in this browser');

    fireEvent.change(chapterText(), { target: { value: 'Once upon a midnight' } });
    expect(saveState()).toHaveTextContent('Saving…');
    await waitFor(() => expect(saveState()).toHaveTextContent('Saved in this browser'));
    expect(stored().books[0].chapters[0].text).toBe('Once upon a midnight');
  });

  it('says "Not saved" and shows an alert when storage rejects the write, then recovers', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    fireEvent.change(chapterText(), { target: { value: 'Lost?' } });
    await waitFor(() => expect(saveState()).toHaveTextContent('Not saved'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your latest changes aren’t saved');
    expect(stored().books[0].chapters[0].text).toBe('Once upon a time');

    // Further edits keep saying "Not saved" rather than flipping back to "Saving…".
    fireEvent.change(chapterText(), { target: { value: 'Lost? Still' } });
    expect(saveState()).toHaveTextContent('Not saved');

    setItem.mockRestore();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(saveState()).toHaveTextContent('Saved in this browser'));
    expect(stored().books[0].chapters[0].text).toBe('Lost? Still');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('writes pending edits immediately when the page is hidden', () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1');
    fireEvent.change(chapterText(), { target: { value: 'Closing the tab' } });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(stored().books[0].chapters[0].text).toBe('Closing the tab');
  });

  it('migrates a v1 library to the v2 key', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([makeBook('b1', 'Old format')]));
    renderApp('/');
    expect(screen.getByRole('heading', { name: 'Old format' })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(LEGACY_KEY)).toBeNull());
    expect(stored().books[0].title).toBe('Old format');
  });
});

describe('damaged data', () => {
  it('opens a book that lost its chapters instead of crashing', () => {
    const { chapters: _omit, ...broken } = makeBook('b1', 'Damaged');
    localStorage.setItem(STORAGE_KEY, serializeLibrary([broken]));
    renderApp('/books/b1');
    expect(screen.getByRole('heading', { name: 'Damaged' })).toBeInTheDocument();
    expect(chapterText()).toHaveValue('');
  });

  it('keeps unreadable data, starts empty, and warns', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    renderApp('/');
    expect(screen.getByRole('alert')).toHaveTextContent('Your saved library couldn’t be read');
    expect(screen.getByText('Start your first book')).toBeInTheDocument();
    const backupKey = Object.keys(localStorage).find((k) => k.startsWith(RECOVERY_PREFIX));
    expect(localStorage.getItem(backupKey)).toBe('{not json');
  });

  it('pauses saving when unreadable data could not be copied aside', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    renderApp('/');
    setItem.mockRestore();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Saving is paused');
    // Wait past the save delay: the original must still be there.
    await new Promise((r) => setTimeout(r, 600));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{not json');

    fireEvent.click(within(alert).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(stored()).toEqual({ version: 2, books: [] }));
  });

  it('saves edits still waiting for the timer when a crash unmounts the app', () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Throws while rendering once a chapter contains BOOM.
    function Bomb() {
      const { books } = useBooks();
      if (books.some((b) => b.chapters.some((c) => c.text.includes('BOOM')))) throw new Error('render bug');
      return null;
    }
    render(
      <ErrorBoundary>
        <MemoryRouter initialEntries={['/books/b1']}>
          <BooksProvider>
            <ToastProvider>
              <Bomb />
              <App />
            </ToastProvider>
          </BooksProvider>
        </MemoryRouter>
      </ErrorBoundary>,
    );
    fireEvent.change(chapterText(), { target: { value: 'Typed just before the crash' } });
    // Well inside the save delay, the next edit crashes rendering.
    fireEvent.change(chapterText(), { target: { value: 'BOOM' } });

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(stored().books[0].chapters[0].text).toBe('Typed just before the crash');
  });

  it('shows a recovery screen if rendering crashes', () => {
    const Boom = () => {
      throw new Error('boom');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
  });
});

describe('two tabs', () => {
  it('merges another tab’s save instead of overwriting it', async () => {
    const lantern = makeBook('b1', 'Lantern');
    const salt = makeBook('b2', 'Salt');
    localStorage.setItem(STORAGE_KEY, serializeLibrary([lantern, salt]));
    renderApp('/books/b1');

    // This tab edits book 1 ...
    fireEvent.change(chapterText(), { target: { value: 'Edited here' } });

    // ... while the other tab saves an edit to book 2.
    const otherTab = serializeLibrary([
      lantern,
      { ...salt, updatedAt: '2026-02-01T00:00:00.000Z', chapters: [{ ...salt.chapters[0], text: 'Edited there' }] },
    ]);
    act(() => {
      localStorage.setItem(STORAGE_KEY, otherTab);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: otherTab, storageArea: localStorage }));
    });

    await waitFor(() => expect(saveState()).toHaveTextContent('Saved in this browser'));
    const books = stored().books;
    expect(books.find((b) => b.id === 'b1').chapters[0].text).toBe('Edited here');
    expect(books.find((b) => b.id === 'b2').chapters[0].text).toBe('Edited there');
  });

  it('merges saves from a tab still running the old version, then removes the old key', async () => {
    const lantern = makeBook('b1', 'Lantern');
    const salt = makeBook('b2', 'Salt');
    localStorage.setItem(STORAGE_KEY, serializeLibrary([lantern, salt]));
    renderApp('/books/b1');

    // The old tab only knows Lantern, and edits it.
    const oldTab = JSON.stringify([
      { ...lantern, updatedAt: '2026-02-01T00:00:00.000Z', chapters: [{ ...lantern.chapters[0], text: 'Old tab text' }] },
    ]);
    act(() => {
      localStorage.setItem(LEGACY_KEY, oldTab);
      window.dispatchEvent(new StorageEvent('storage', { key: LEGACY_KEY, newValue: oldTab, storageArea: localStorage }));
    });
    expect(chapterText()).toHaveValue('Old tab text');
    await waitFor(() => expect(localStorage.getItem(LEGACY_KEY)).toBeNull());
    const books = stored().books;
    expect(books.find((b) => b.id === 'b1').chapters[0].text).toBe('Old tab text');
    expect(books.find((b) => b.id === 'b2')).toBeDefined();
  });

  it('shows another tab’s edit to the open chapter', () => {
    const lantern = makeBook('b1', 'Lantern');
    localStorage.setItem(STORAGE_KEY, serializeLibrary([lantern]));
    renderApp('/books/b1');
    const otherTab = serializeLibrary([
      { ...lantern, updatedAt: '2026-02-01T00:00:00.000Z', chapters: [{ ...lantern.chapters[0], text: 'From tab two' }] },
    ]);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: otherTab, storageArea: localStorage }));
    });
    expect(chapterText()).toHaveValue('From tab two');
  });
});

describe('undo and keyboard', () => {
  it('deletes a comment without a prompt and can undo it', () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1?comments=1');
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete' }));
    expect(within(panel).queryByText('Tighten this')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(panel).getByText('Tighten this')).toBeInTheDocument();
  });

  it('closes the slide-over comments panel with Escape from anywhere', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(max-width: 1199px)', media: q }));
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1?comments=1');
    const toggle = screen.getByRole('button', { name: /^Comments, / });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Focus moved into the panel when it opened.
    expect(document.activeElement).toHaveAccessibleName('Close comments');

    chapterText().focus();
    fireEvent.keyDown(chapterText(), { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(toggle);
    vi.unstubAllGlobals();
  });
});

describe('comments panel on wide screens', () => {
  it('closes with Escape only when focus is inside the panel', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: false, media: q }));
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/books/b1?comments=1');
    const toggle = screen.getByRole('button', { name: /^Comments, / });

    fireEvent.keyDown(chapterText(), { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const box = screen.getByLabelText('Add a comment');
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('backup', () => {
  it('imports a backup file after confirming', async () => {
    localStorage.setItem(STORAGE_KEY, serializeLibrary([makeBook('b1', 'Lantern')]));
    renderApp('/');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const file = new File(
      [JSON.stringify({ app: 'books', version: 2, books: [makeBook('b9', 'From backup'), makeBook('b1', 'Lantern v2')] })],
      'backup.json',
      { type: 'application/json' },
    );
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'From backup' })).toBeInTheDocument());
    expect(confirm.mock.calls[0][0]).toMatch(/add 1 book and replace 1 existing book/);
    expect(screen.getByRole('heading', { name: 'Lantern v2' })).toBeInTheDocument();
  });

  it('rejects JSON that holds no books', async () => {
    renderApp('/');
    const confirm = vi.spyOn(window, 'confirm');
    const file = new File(['[{}, {}]'], 'objects.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no books'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('rejects a file that is not a backup', async () => {
    renderApp('/');
    const confirm = vi.spyOn(window, 'confirm');
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('import-input'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('isn’t a Books backup'));
    expect(confirm).not.toHaveBeenCalled();
  });
});
