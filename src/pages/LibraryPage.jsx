import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBooks } from '../store/BooksContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { backupFileName, downloadText } from '../lib/backup.js';
import '../styles/auth.css';
import { SORTS, STATUS_FILTERS } from '../data/constants.js';
import { bookProgress } from '../lib/utils.js';
import BackupPanel from '../components/BackupPanel.jsx';
import BookCard from '../components/BookCard.jsx';
import BookFormDialog from '../components/BookFormDialog.jsx';
import Icon from '../components/Icon.jsx';
import '../styles/library.css';

const SORTERS = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  title: (a, b) => a.title.localeCompare(b.title),
  progress: (a, b) => bookProgress(b) - bookProgress(a),
};

export default function LibraryPage() {
  const { signedIn, ready } = useBooks();
  if (!signedIn) return <Welcome />;
  if (!ready) {
    return (
      <div className="container page">
        <p className="muted">Loading your books…</p>
      </div>
    );
  }
  return <MyLibrary />;
}

function Welcome() {
  return (
    <div className="container page library">
      <div className="empty">
        <span className="empty__icon">
          <Icon name="book" size={32} />
        </span>
        <h1>Write your books here</h1>
        <p className="muted">
          Create a free account with just a username and password to start writing. Anyone can read the books
          writers share here.
        </p>
        <div className="notice__actions">
          <Link to="/register" className="btn btn--primary btn--lg">
            Create account
          </Link>
          <Link to="/login" className="btn btn--outline btn--lg">
            Sign in
          </Link>
          <Link to="/browse" className="btn btn--ghost btn--lg">
            Browse books
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Offer to add the library this browser held before accounts existed. */
function ImportNotice() {
  const { legacy, importLegacy, dismissLegacy } = useBooks();
  const { showToast } = useToast();
  if (!legacy) return null;
  const n = legacy.books.length;
  const problems = legacy.unreadable || legacy.dropped > 0;
  const downloadOriginal = (
    <button
      type="button"
      className="btn btn--outline btn--sm"
      onClick={() => downloadText(backupFileName(new Date(), 'books-before-accounts'), legacy.raw)}
    >
      Download original data
    </button>
  );

  if (n === 0) {
    // Old data exists but none of it could be read: don't hide it, let the writer keep it.
    return (
      <section className="notice notice--warning" aria-labelledby="import-title">
        <div className="notice__text">
          <h2 id="import-title" className="panel-title">
            Books saved in this browser couldn’t be read
          </h2>
          <p className="small muted">
            This browser has data from before accounts that couldn’t be read, so it can’t be imported. Download it to
            keep it; it stays in this browser either way.
          </p>
        </div>
        <div className="notice__actions">
          {downloadOriginal}
          <button type="button" className="btn btn--ghost btn--sm" onClick={dismissLegacy}>
            Dismiss
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="notice" aria-labelledby="import-title">
      <div className="notice__text">
        <h2 id="import-title" className="panel-title">
          Import the books saved in this browser?
        </h2>
        <p className="small muted">
          This browser has {n} {n === 1 ? 'book' : 'books'} from before accounts. Import them to save them to your
          account. A copy stays in this browser.
          {problems && ' Some of the old data couldn’t be read; download the original to keep all of it.'}
        </p>
      </div>
      <div className="notice__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => {
            const count = importLegacy();
            showToast({ message: `Imported ${count} ${count === 1 ? 'book' : 'books'} into your account.` });
          }}
        >
          Import {n} {n === 1 ? 'book' : 'books'}
        </button>
        {problems && downloadOriginal}
        <button type="button" className="btn btn--ghost btn--sm" onClick={dismissLegacy}>
          Not now
        </button>
      </div>
    </section>
  );
}

function MyLibrary() {
  const { books, addBook } = useBooks();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const c = { all: books.length, draft: 0, progress: 0, published: 0 };
    books.forEach((b) => {
      c[b.status] = (c[b.status] || 0) + 1;
    });
    return c;
  }, [books]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books
      .filter((b) => filter === 'all' || b.status === filter)
      .filter((b) => !q || b.title.toLowerCase().includes(q) || b.genre.toLowerCase().includes(q))
      .sort(SORTERS[sort]);
  }, [books, query, filter, sort]);

  const filtering = filter !== 'all' || query.trim() !== '';
  const summary = [
    `${books.length} ${books.length === 1 ? 'book' : 'books'}`,
    counts.progress && `${counts.progress} in progress`,
    counts.published && `${counts.published} published`,
  ]
    .filter(Boolean)
    .join(' · ');

  function handleCreate(data) {
    const id = addBook(data);
    navigate(`/books/${id}`);
  }

  return (
    <div className="container page library">
      <section className="page-head">
        <div>
          <h1 className="page-title">Your library</h1>
          <p className="muted">{summary}</p>
        </div>
        <button type="button" className="btn btn--primary btn--lg page-head__cta" onClick={() => setCreating(true)}>
          <Icon name="plus" />
          New book
        </button>
      </section>

      <ImportNotice />

      {books.length > 0 && (
        <section className="library__toolbar" aria-label="Search and filters">
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">Search books</span>
            <input
              type="search"
              placeholder="Search by title or genre"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="chips" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                <span className="chip__count">{counts[f.id] || 0}</span>
              </button>
            ))}
          </div>
          <label className="sort">
            <span>Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {books.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="book" size={32} />
          </span>
          <h2>Start your first book</h2>
          <p className="muted">Give it a title, pick a cover color and start writing.</p>
          <button type="button" className="btn btn--primary btn--lg" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            New book
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>No books match</h2>
          <p className="muted">Try a different search or status filter.</p>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="book-grid">
          {visible.map((book) => (
            <li key={book.id}>
              <BookCard book={book} />
            </li>
          ))}
          {!filtering && (
            <li className="book-grid__new">
              <button type="button" className="new-card" onClick={() => setCreating(true)}>
                <span className="new-card__icon">
                  <Icon name="plus" size={26} strokeWidth={2.4} />
                </span>
                Start a new book
              </button>
            </li>
          )}
        </ul>
      )}

      <BackupPanel />

      <button type="button" className="fab" aria-label="New book" onClick={() => setCreating(true)}>
        <Icon name="plus" size={26} strokeWidth={2.4} />
      </button>

      <BookFormDialog open={creating} onClose={() => setCreating(false)} onSubmit={handleCreate} />
    </div>
  );
}
