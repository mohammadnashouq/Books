import { useRef, useState } from 'react';
import { useBooks } from '../store/BooksContext.jsx';
import { exportLibrary, parseLibraryJson } from '../store/storage.js';
import {
  backupFileName,
  backupIsDue,
  downloadText,
  readFileText,
  readLastBackup,
  writeLastBackup,
} from '../lib/backup.js';
import { timeAgo } from '../lib/utils.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';

/** Largest backup file we'll try to read (well above any real library). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export default function BackupPanel() {
  const { books, importBooks, storage } = useBooks();
  const { showToast } = useToast();
  const fileRef = useRef(null);
  const [lastBackup, setLastBackup] = useState(() => readLastBackup(storage));
  const [error, setError] = useState('');

  const due = books.length > 0 && backupIsDue(lastBackup);

  function handleExport() {
    downloadText(backupFileName(), exportLibrary(books));
    const iso = new Date().toISOString();
    writeLastBackup(storage, iso);
    setLastBackup(iso);
    setError('');
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > MAX_IMPORT_BYTES) {
      setError('That file is too large to be a Books backup.');
      return;
    }
    let imported;
    try {
      imported = parseLibraryJson(await readFileText(file)).books;
    } catch {
      setError('That file isn’t a Books backup. Choose a .json file made with “Download backup”.');
      return;
    }
    if (imported.length === 0) {
      setError('That backup has no books in it.');
      return;
    }
    const ids = new Set(books.map((b) => b.id));
    const replacing = imported.filter((b) => ids.has(b.id)).length;
    const adding = imported.length - replacing;
    const parts = [];
    if (adding) parts.push(`add ${adding} ${adding === 1 ? 'book' : 'books'}`);
    if (replacing) parts.push(`replace ${replacing} existing ${replacing === 1 ? 'book' : 'books'} with the backup’s copy`);
    if (!window.confirm(`Import “${file.name}”? This will ${parts.join(' and ')}.`)) return;
    importBooks(imported);
    showToast({ message: `Imported ${imported.length} ${imported.length === 1 ? 'book' : 'books'}.` });
  }

  return (
    <section className={`backup panel${due ? ' is-due' : ''}`} aria-labelledby="backup-title">
      <div className="backup__text">
        <h2 id="backup-title" className="panel-title">
          Backup
        </h2>
        <p className="small muted">
          Your books are saved in this browser only. Clearing site data or switching device loses them, so download a
          backup now and then.{' '}
          <strong className={due ? 'backup__due' : undefined}>
            {lastBackup ? `Last backup ${timeAgo(lastBackup)}.` : 'No backup yet.'}
          </strong>
        </p>
        {error && (
          <p className="small backup__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="backup__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={handleExport} disabled={!books.length}>
          <Icon name="download" size={16} />
          Download backup
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} />
          Import backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFile}
          data-testid="import-input"
        />
      </div>
    </section>
  );
}
