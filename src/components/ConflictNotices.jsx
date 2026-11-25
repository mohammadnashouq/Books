import { useBooks } from '../store/BooksContext.jsx';
import { exportLibrary } from '../store/storage.js';
import { backupFileName, downloadText } from '../lib/backup.js';
import '../styles/auth.css';

/**
 * Versions of a book that lost to a newer edit made on another device or tab.
 * Shown on every page (the editor too) and kept until dismissed, even across
 * reloads, so the writer can always get the other version back.
 */
export default function ConflictNotices() {
  const { signedIn, losers, dismissLoser } = useBooks();
  if (!signedIn || !losers?.length) return null;
  return (
    <div className="conflicts" role="region" aria-label="Conflicting versions">
      {losers.map((book, i) => {
        const elsewhere = book.conflictFrom === 'elsewhere';
        return (
          <section
            key={book.conflictId ?? `${book.id}-${book.updatedAt}-${i}`}
            className="notice notice--warning"
            role="status"
          >
          <p className="notice__text small">
            <strong>“{book.title}” was also changed on another device or tab.</strong>{' '}
            {elsewhere
              ? 'Your newer version here was saved; download the other version if you need anything from it.'
              : 'That newer version is shown; download this browser’s version if you need anything from it.'}
          </p>
          <div className="notice__actions">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                const { conflictId: _c, conflictFrom: _f, ...plain } = book;
                downloadText(backupFileName(new Date(), 'books-conflict'), exportLibrary([plain]));
              }}
            >
              {elsewhere ? 'Download the other version' : 'Download this browser’s version'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismissLoser(book)}>
              Dismiss
            </button>
          </div>
          </section>
        );
      })}
    </div>
  );
}
