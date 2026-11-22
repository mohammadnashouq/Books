export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function countWords(text = '') {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export function bookWords(book) {
  return book.chapters.reduce((sum, ch) => sum + countWords(ch.text), 0);
}

export function bookProgress(book) {
  if (!book.goal) return 0;
  return Math.min(100, Math.round((bookWords(book) / book.goal) * 100));
}

export function openComments(book) {
  return book.comments.filter((c) => !c.resolved).length;
}

export function formatNumber(n) {
  return new Intl.NumberFormat().format(n);
}

export function timeAgo(iso) {
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function initials(name = '') {
  return name.trim().charAt(0).toUpperCase() || '?';
}
