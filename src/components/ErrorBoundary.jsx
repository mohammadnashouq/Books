import { Component } from 'react';
import {
  LEGACY_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  dumpRawStorage,
  getBrowserStorage,
  parseLibraryJson,
} from '../store/storage.js';
import { backupFileName, downloadText } from '../lib/backup.js';
import '../styles/feedback.css';

/**
 * Last line of defence: if rendering throws, show a way out instead of a blank
 * page. The "download" button reads storage directly, without React state, so
 * it works however broken the app is.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Books crashed:', error, info?.componentStack);
  }

  downloadData = () => {
    const raw = dumpRawStorage(getBrowserStorage());
    // Include the books in the backup format when they parse, so the file can
    // be imported with "Import backup"; keep the raw strings either way.
    let books = [];
    try {
      books = parseLibraryJson(raw[STORAGE_KEY] ?? raw[LEGACY_KEY] ?? '[]').books;
    } catch {
      // Raw data below is still downloaded.
    }
    downloadText(
      backupFileName(new Date(), 'books-recovery'),
      JSON.stringify(
        { app: 'books', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), books, raw },
        null,
        2,
      ),
    );
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>
          Books hit an unexpected error. Your last saved copy of the library is still in this browser. Download it to
          be safe, then try reloading.
        </p>
        <div className="crash__actions">
          <button type="button" className="btn btn--outline" onClick={this.downloadData}>
            Download my data
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
