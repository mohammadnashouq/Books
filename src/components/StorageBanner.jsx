import { Link, useLocation } from 'react-router-dom';
import { useBooks } from '../store/BooksContext.jsx';
import { exportLibrary } from '../store/storage.js';
import { backupFileName, downloadText, writeLastBackup } from '../lib/backup.js';

/**
 * Shown above every page when the user's work isn't safely on the server:
 * offline, signed out, a book the server refused, or this browser's copy
 * couldn't be read.
 */
export default function StorageBanner() {
  const { signedIn, books, saveStatus, saveError, cachedLocally, retrySave, problem, dismissProblem, storage } =
    useBooks();
  const location = useLocation();
  if (!signedIn) return null;

  function downloadBackup() {
    downloadText(backupFileName(), exportLibrary(books));
    writeLastBackup(storage);
  }

  if (problem?.kind === 'corrupt') {
    return (
      <div className="banner banner--warning" role="alert">
        <div className="banner__text">
          <strong>This browser’s copy of your books couldn’t be read.</strong> Your books were loaded from the
          server. {problem.backupKey ? 'The unreadable copy was kept in this browser; ' : ''}download it if you had
          changes that never reached the server.
        </div>
        <div className="banner__actions">
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={() => downloadText(backupFileName(new Date(), 'books-unreadable-data'), problem.raw ?? '')}
          >
            Download original data
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={dismissProblem}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (saveStatus !== 'error' || !saveError) return null;

  if (saveError.kind === 'signed-out') {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <div className="banner banner--danger" role="alert">
        <div className="banner__text">
          <strong>You’ve been signed out.</strong> Sign in again to save your changes to your account.{' '}
          {cachedLocally
            ? 'Until then they’re kept in this browser.'
            : 'They couldn’t be kept in this browser either: download a backup now.'}
        </div>
        <div className="banner__actions">
          <button type="button" className="btn btn--sm btn--outline" onClick={downloadBackup}>
            Download backup
          </button>
          <Link to={`/login?next=${next}`} className="btn btn--sm btn--primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const offline = saveError.kind === 'offline';
  return (
    <div className="banner banner--danger" role="alert">
      <div className="banner__text">
        {offline ? (
          <>
            <strong>Can’t reach the server.</strong>{' '}
            {cachedLocally
              ? 'Your changes are kept in this browser and will be saved to your account when the connection is back.'
              : 'Your latest changes couldn’t be kept in this browser either. Download a backup so nothing is lost.'}
          </>
        ) : (
          <>
            <strong>Not saved.</strong> {saveError.message}
          </>
        )}
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
