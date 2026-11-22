import { Link } from 'react-router-dom';
import { coverColor } from '../data/constants.js';
import { bookProgress, bookWords, formatNumber, openComments, timeAgo } from '../lib/utils.js';
import Icon from './Icon.jsx';
import StatusChip from './StatusChip.jsx';
import ProgressBar from './ProgressBar.jsx';

export default function BookCard({ book }) {
  const color = coverColor(book.color);
  const words = bookWords(book);
  const pct = bookProgress(book);
  const open = openComments(book);
  const href = `/books/${book.id}`;

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
          <span className="muted small">Edited {timeAgo(book.updatedAt)}</span>
        </div>
        <ProgressBar
          value={pct}
          color={color.bg}
          label={book.goal ? `${formatNumber(words)} / ${formatNumber(book.goal)} words` : `${formatNumber(words)} words`}
        />
        <div className="book-card__actions">
          <Link to={href} className="btn btn--soft">
            <Icon name="edit" size={17} />
            Edit
          </Link>
          <Link
            to={`${href}?comments=1`}
            className="btn btn--outline"
            aria-label={`${open} open comment${open === 1 ? '' : 's'} on ${book.title}`}
          >
            <Icon name="comment" size={17} />
            {open}
          </Link>
        </div>
      </div>
    </article>
  );
}
