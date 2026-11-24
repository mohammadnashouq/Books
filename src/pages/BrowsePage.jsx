import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { coverColor } from '../data/constants.js';
import { formatNumber, timeAgo } from '../lib/utils.js';
import StatusChip from '../components/StatusChip.jsx';
import Icon from '../components/Icon.jsx';
import '../styles/library.css';

/** Every writer's books, readable by anyone. */
export default function BrowsePage() {
  const { api } = useAuth();
  const [state, setState] = useState({ status: 'loading', books: [], error: '' });
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listBooks()
      .then((books) => !cancelled && setState({ status: 'ready', books, error: '' }))
      .catch((err) => !cancelled && setState({ status: 'error', books: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.books;
    return state.books.filter((b) =>
      [b.title, b.genre, b.owner].some((field) => field.toLowerCase().includes(q)),
    );
  }, [state.books, query]);

  return (
    <div className="container page library">
      <section className="page-head">
        <div>
          <h1 className="page-title">Browse</h1>
          <p className="muted">Books from every writer here. Anyone can read them.</p>
        </div>
      </section>

      {state.status === 'loading' && <p className="muted">Loading books…</p>}

      {state.status === 'error' && (
        <div className="empty" role="alert">
          <h2>Couldn’t load books</h2>
          <p className="muted">{state.error}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setState((s) => ({ ...s, status: 'loading' }));
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && state.books.length === 0 && (
        <div className="empty">
          <h2>No books yet</h2>
          <p className="muted">When writers start books, they’ll appear here.</p>
        </div>
      )}

      {state.status === 'ready' && state.books.length > 0 && (
        <>
          <section className="library__toolbar" aria-label="Search">
            <label className="search">
              <Icon name="search" size={18} />
              <span className="sr-only">Search books</span>
              <input
                type="search"
                placeholder="Search by title, genre or writer"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </section>
          {visible.length === 0 ? (
            <div className="empty">
              <h2>No books match</h2>
            </div>
          ) : (
            <ul className="book-grid">
              {visible.map((book) => (
                <li key={book.id}>
                  <PublicBookCard book={book} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PublicBookCard({ book }) {
  const color = coverColor(book.color);
  const href = `/read/${encodeURIComponent(book.id)}`;
  return (
    <article className="book-card">
      <div
        className="cover book-card__cover"
        style={{ '--cover-bg': color.bg, '--cover-ink': color.ink }}
        aria-hidden="true"
      >
        <span className="cover__genre">{book.genre || 'No genre'}</span>
        <span className="cover__title">{book.title}</span>
      </div>
      <div className="book-card__body">
        <h2 className="book-card__title">
          <Link to={href} className="stretched-link">
            {book.title}
          </Link>
        </h2>
        <div className="book-card__meta">
          <StatusChip status={book.status} />
          <span className="muted small">by {book.owner}</span>
        </div>
        <p className="muted small">
          {formatNumber(book.words)} words · {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} ·
          updated {timeAgo(book.updatedAt)}
        </p>
      </div>
    </article>
  );
}
