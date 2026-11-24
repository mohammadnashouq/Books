import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useBooks } from '../store/BooksContext.jsx';
import { coverColor } from '../data/constants.js';
import CommentItem from '../components/CommentItem.jsx';
import '../styles/comments.css';

export default function CommentsPage() {
  const { signedIn } = useBooks();
  if (!signedIn) return <Navigate to="/login?next=%2Fcomments" replace />;
  return <CommentsList />;
}

function CommentsList() {
  const { books, toggleComment } = useBooks();
  const [showResolved, setShowResolved] = useState(false);

  const groups = books
    .map((book) => ({
      book,
      comments: book.comments.filter((c) => showResolved || !c.resolved),
    }))
    .filter((g) => g.comments.length > 0);

  const total = groups.reduce((n, g) => n + g.comments.length, 0);

  return (
    <div className="container page comments-page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Comments</h1>
          <p className="muted">
            {total} {showResolved ? '' : 'open '}
            {total === 1 ? 'comment' : 'comments'} across your books
          </p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          <span className="toggle__track" aria-hidden="true" />
          Show resolved
        </label>
      </section>

      {groups.length === 0 ? (
        <div className="empty">
          <h2>All caught up</h2>
          <p className="muted">There are no open comments. Open a book and press Comment to add one.</p>
          <Link to="/" className="btn btn--primary">
            Go to library
          </Link>
        </div>
      ) : (
        <div className="comment-groups">
          {groups.map(({ book, comments }) => {
            const color = coverColor(book.color);
            return (
              <section key={book.id} className="comment-group panel" aria-labelledby={`group-${book.id}`}>
                <div className="comment-group__head">
                  <span className="comment-group__swatch" style={{ background: color.bg }} aria-hidden="true" />
                  <h2 id={`group-${book.id}`} className="panel-title">
                    {book.title}
                  </h2>
                  <Link to={`/books/${book.id}?comments=1`} className="btn btn--soft btn--sm">
                    Open book
                  </Link>
                </div>
                <ul className="comment-list">
                  {comments.map((c) => {
                    const ch = book.chapters.find((x) => x.id === c.chapterId);
                    return (
                      <CommentItem
                        key={c.id}
                        comment={c}
                        onToggle={() => toggleComment(book.id, c.id)}
                        context={
                          ch && (
                            <Link className="comment__chapter small" to={`/books/${book.id}?chapter=${ch.id}&comments=1`}>
                              {ch.title || 'Untitled chapter'}
                            </Link>
                          )
                        }
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
