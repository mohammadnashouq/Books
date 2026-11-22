import { ME } from '../data/constants.js';
import { initials, timeAgo } from '../lib/utils.js';
import Icon from './Icon.jsx';

const AVATAR_COLORS = ['#6D4AFF', '#0B8484', '#D63A7E', '#2F6FE4', '#E5482A'];

function avatarColor(name) {
  if (name === ME) return { bg: '#FFB020', ink: '#1A1A2E' };
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { bg: AVATAR_COLORS[hash % AVATAR_COLORS.length], ink: '#FFFFFF' };
}

export default function CommentItem({ comment, onToggle, onDelete, context }) {
  const color = avatarColor(comment.author);
  return (
    <li className={`comment${comment.resolved ? ' is-resolved' : ''}`}>
      <div className="comment__head">
        <span className="avatar" style={{ background: color.bg, color: color.ink }} aria-hidden="true">
          {initials(comment.author)}
        </span>
        <div className="comment__who">
          <span className="comment__author">{comment.author}</span>
          <span className="small muted">{timeAgo(comment.createdAt)}</span>
        </div>
        {comment.resolved && <span className="status status--published">Resolved</span>}
      </div>
      {context}
      {comment.quote && <blockquote className="quote">“{comment.quote}”</blockquote>}
      <p className="comment__text">{comment.text}</p>
      {(onToggle || onDelete) && (
        <div className="comment__actions">
          {onToggle && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onToggle}>
              <Icon name={comment.resolved ? 'undo' : 'check'} size={16} />
              {comment.resolved ? 'Reopen' : 'Resolve'}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onDelete}
            >
              <Icon name="trash" size={16} />
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}
