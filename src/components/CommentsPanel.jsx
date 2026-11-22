import { useEffect, useId, useRef, useState } from 'react';
import CommentItem from './CommentItem.jsx';
import Icon from './Icon.jsx';
import '../styles/comments.css';

/** Below this width the panel slides over the page (matches editor.css). */
export const OVERLAY_QUERY = '(max-width: 1199px)';

export default function CommentsPanel({
  open,
  onClose,
  chapterTitle,
  comments,
  quote,
  onClearQuote,
  onAdd,
  onToggle,
  onDelete,
}) {
  const id = useId();
  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [tab, setTab] = useState('open');

  const openList = comments.filter((c) => !c.resolved);
  const resolvedList = comments.filter((c) => c.resolved);
  const list = tab === 'open' ? openList : resolvedList;

  const closeRef = useRef(null);
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open && quote) inputRef.current?.focus();
  }, [open, quote]);

  // Where the panel slides over the page, move focus into it when it opens.
  useEffect(() => {
    if (!open || quote) return;
    if (window.matchMedia?.(OVERLAY_QUERY).matches) closeRef.current?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- only when it opens

  // Escape closes the panel from anywhere on the page, unless a dialog is open
  // (the dialog handles Escape itself).
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      // As a slide-over it closes from anywhere; as a side column only from inside it.
      const inside = panelRef.current?.contains(document.activeElement);
      if (!inside && !window.matchMedia?.(OVERLAY_QUERY).matches) return;
      onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function submit(e) {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText('');
    setTab('open');
  }

  return (
    <>
      <div className="comments-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="comments panel"
        aria-label="Comments"
        ref={panelRef}
      >
        <div className="comments__head">
          <div>
            <h2 className="panel-title">Comments</h2>
            <p className="small muted">{chapterTitle || 'Untitled chapter'}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn comments__close"
            aria-label="Close comments"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>

        <form className="comment-form" onSubmit={submit}>
          <label htmlFor={`${id}-text`} className="comment-form__label">
            Add a comment
          </label>
          {quote && (
            <div className="comment-form__quote">
              <blockquote className="quote">“{quote}”</blockquote>
              <button type="button" className="icon-btn icon-btn--sm" aria-label="Remove quote" onClick={onClearQuote}>
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
          <textarea
            id={`${id}-text`}
            ref={inputRef}
            rows={3}
            placeholder="Leave a note on this chapter…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
            }}
          />
          <div className="comment-form__foot">
            <span className="small muted hide-touch">Ctrl + Enter to post</span>
            <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
              Post comment
            </button>
          </div>
        </form>

        <div className="segmented" role="group" aria-label="Show comments">
          <button type="button" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
            Open <span className="segmented__count">{openList.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'resolved'} onClick={() => setTab('resolved')}>
            Resolved <span className="segmented__count">{resolvedList.length}</span>
          </button>
        </div>

        {list.length ? (
          <ul className="comment-list">
            {list.map((c) => (
              <CommentItem key={c.id} comment={c} onToggle={() => onToggle(c.id)} onDelete={() => onDelete(c.id)} />
            ))}
          </ul>
        ) : (
          <p className="comments__empty muted">
            {tab === 'open'
              ? 'No open comments on this chapter. Select some text and press Comment to quote it.'
              : 'No resolved comments yet.'}
          </p>
        )}
      </aside>
    </>
  );
}
