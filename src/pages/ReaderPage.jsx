import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { coverColor } from '../data/constants.js';
import { countWords, formatNumber } from '../lib/utils.js';
import StatusChip from '../components/StatusChip.jsx';
import Icon from '../components/Icon.jsx';
import '../styles/editor.css';
import '../styles/reader.css';

/** Read-only view of any book. The owner also gets a link to edit it. */
export default function ReaderPage() {
  const { bookId } = useParams();
  const [params, setParams] = useSearchParams();
  const { api } = useAuth();
  const [state, setState] = useState({ status: 'loading', book: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    api
      .getBook(bookId)
      .then((book) => !cancelled && setState({ status: 'ready', book, error: '' }))
      .catch(
        (err) =>
          !cancelled && setState({ status: err.status === 404 ? 'missing' : 'error', book: null, error: err.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [api, bookId]);

  const book = state.book;
  useEffect(() => {
    if (book) document.title = `${book.title} · Books`;
    return () => {
      document.title = 'Books';
    };
  }, [book]);

  if (state.status === 'loading') {
    return (
      <div className="container page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (state.status !== 'ready') {
    return (
      <div className="container page">
        <div className="empty" role={state.status === 'error' ? 'alert' : undefined}>
          <h1>{state.status === 'missing' ? 'Book not found' : 'Couldn’t load this book'}</h1>
          <p className="muted">{state.status === 'missing' ? 'It may have been deleted.' : state.error}</p>
          <Link to="/browse" className="btn btn--primary">
            Browse books
          </Link>
        </div>
      </div>
    );
  }

  const index = Math.max(
    0,
    book.chapters.findIndex((c) => c.id === params.get('chapter')),
  );
  const chapter = book.chapters[index];
  const color = coverColor(book.color);
  const go = (i) => {
    setParams({ chapter: book.chapters[i].id }, { replace: true });
    window.scrollTo?.(0, 0);
  };

  return (
    <div className="container page reader">
      <header className="reader__head">
        <span className="reader__swatch" style={{ background: color.bg }} aria-hidden="true" />
        <div>
          <h1 className="page-title">{book.title}</h1>
          <p className="muted">
            by {book.owner} · {book.genre || 'No genre'} · <StatusChip status={book.status} />
          </p>
        </div>
        {book.isOwner && (
          <Link to={`/books/${encodeURIComponent(book.id)}`} className="btn btn--soft reader__edit">
            <Icon name="edit" size={17} />
            Edit
          </Link>
        )}
      </header>

      <div className="reader__layout">
        <nav className="reader__toc panel" aria-label="Chapters">
          <ol>
            {book.chapters.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chapter-btn${i === index ? ' is-active' : ''}`}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                >
                  <span className="chapter-btn__num">{i + 1}</span>
                  <span className="chapter-btn__text">
                    <span className="chapter-btn__title">{c.title || 'Untitled chapter'}</span>
                    <span className="small muted">{formatNumber(countWords(c.text))} words</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="reader__page panel">
          <span className="eyebrow">Chapter {index + 1}</span>
          <h2 className="reader__chapter-title">{chapter.title || 'Untitled chapter'}</h2>
          {chapter.text.trim() ? (
            chapter.text
              .split(/\n{2,}/)
              .map((para, i) => <p key={i} className="reader__para">{para}</p>)
          ) : (
            <p className="muted">This chapter is empty so far.</p>
          )}
          <div className="reader__nav">
            <button type="button" className="btn btn--outline" disabled={index === 0} onClick={() => go(index - 1)}>
              <Icon name="chevronLeft" size={18} />
              Previous
            </button>
            <button
              type="button"
              className="btn btn--outline"
              disabled={index === book.chapters.length - 1}
              onClick={() => go(index + 1)}
            >
              Next
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
