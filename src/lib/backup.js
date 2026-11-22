import { LAST_BACKUP_KEY } from '../store/storage.js';

/** Offer `text` to the user as a downloaded file. */
export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function backupFileName(date = new Date(), prefix = 'books-backup') {
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function readLastBackup(storage) {
  try {
    const value = storage?.getItem(LAST_BACKUP_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastBackup(storage, iso = new Date().toISOString()) {
  try {
    storage?.setItem(LAST_BACKUP_KEY, iso);
  } catch {
    // Only a reminder; not worth surfacing.
  }
}

export const BACKUP_REMINDER_DAYS = 7;

export function backupIsDue(lastIso, now = Date.now()) {
  if (!lastIso) return true;
  return now - Date.parse(lastIso) > BACKUP_REMINDER_DAYS * 24 * 3600 * 1000;
}

/** Read a File chosen by the user as text. */
export function readFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
