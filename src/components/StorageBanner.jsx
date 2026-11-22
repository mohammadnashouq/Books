import { useBooks } from '../store/BooksContext.jsx';
import { exportLibrary } from '../store/storage.js';
import { backupFileName, downloadText, writeLastBackup } from '../lib/backup.js';

/**
 * Shown above every page when the library isn't safely stored:
 * a failed write, or saved data that couldn't be read.
 */
export default function StorageBanner() {
  const { books, saveStatus, retrySave, problem, dismissProblem, storage } = useBooks();
  const unreadable = problem && (problem.kind === 'corrupt' || problem.kind === 'partial');

  if (!unreadable && saveStatus !== 'error') return null;

  function downloadBackup() {
    downloadText(backupFileName(), exportLibrary(books));
    writeLastBackup(storage);
  }

  if (unreadable) {
    const blocked = !problem.backupKey;
    return (
      <div className="banner banner--warning" role="alert">
        <div className="banner__text">
          <strong>
            {problem.kind === 'corrupt'
              ? 'Your saved library couldn’t be read.'
              : `${problem.dropped} saved ${problem.dropped === 1 ? 'item' : 'items'} couldn’t be read.`}
          </strong>{' '}
          {blocked
            ? 'Saving is paused so the original data isn’t overwritten. Download it before you continue.'
            : 'A copy of the original data was kept in this browser. Download it to keep it safe.'}
        </div>
        <div className="banner__actions">
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={() => downloadText(backupFileName(new Date(), 'books-unreadable-data'), problem.raw)}
          >
            Download original data
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={dismissProblem}>
            {blocked ? 'Continue' : 'Dismiss'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="banner banner--danger" role="alert">
      <div className="banner__text">
        <strong>Your latest changes aren’t saved.</strong> This browser’s storage is full or blocked. Download a
        backup so nothing is lost, then free up space or allow site data.
      </div>
      <div className="banner__actions">
        <button type="button" className="btn btn--sm btn--outline" onClick={downloadBackup}>
          Download backup
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={retrySave}>
          Try again
        </button>
      </div>
    </div>
  );
}
