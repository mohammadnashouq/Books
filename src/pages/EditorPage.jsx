import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store/BooksContext.jsx';
import { coverColor } from '../data/constants.js';
import { bookProgress, bookWords, countWords, formatNumber, openComments } from '../lib/utils.js';
import BookFormDialog from '../components/BookFormDialog.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';
import Icon from '../components/Icon.jsx';
import StatusChip from '../components/StatusChip.jsx';
import '../styles/editor.css';

export default function EditorPage() {
  const { bookId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    books,
    updateBook,
    deleteBook,
    addChapter,
    updateChapter,
    deleteChapter,
    addComment,
    toggleComment,
    deleteComment,
  } = useBooks();

  const book = books.find((b) => b.id === bookId);
  const [commentsOpen, setCommentsOpen] = useState(params.get('comments') === '1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quote, setQuote] = useState('');
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef();
  const textRef = useRef(null);

  const requested = params.get('chapter');
  const chapter = book && (book.chapters.find((c) => c.id === requested) || book.chapters[0]);
  const chapterIndex = book && chapter ? book.chapters.indexOf(chapter) : -1;

  // Grow the textarea with its content so the page scrolls, not the box.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [chapter?.id, chapter?.text]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  useEffect(() => {
    if (book) document.title = `${book.title} · Books`;
    return () => {
      document.title = 'Books';
    };
  }, [book?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!book) {
    return (
      <div className="container page">
        <div className="empty">
          <h1>Book not found</h1>
          <p className="muted">It may have been deleted.</p>
          <Link to="/" className="btn btn--primary">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  const color = coverColor(book.color);
  const chapterComments = chapter ? book.comments.filter((c) => c.chapterId === chapter.id) : [];
  const openCount = openComments(book);

  function selectChapter(id) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('chapter', id);
        return next;
      },
      { replace: true },
    );
    setQuote('');
  }

  function flashSaved() {
    setSaving(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaving(false), 700);
  }

  function editChapter(patch) {
    updateChapter(book.id, chapter.id, patch);
    flashSaved();
  }

  function handleAddChapter() {
    const id = addChapter(book.id, `Chapter ${book.chapters.length + 1}`);
    selectChapter(id);
  }

  function handleDeleteChapter() {
    if (book.chapters.length <= 1) return;
    if (!window.confirm(`Delete “${chapter.title || 'Untitled chapter'}” and its comments?`)) return;
    const next = book.chapters[chapterIndex + 1] || book.chapters[chapterIndex - 1];
    deleteChapter(book.id, chapter.id);
    selectChapter(next.id);
  }

  function startComment() {
    const el = textRef.current;
    const selected = el ? el.value.slice(el.selectionStart, el.selectionEnd).trim() : '';
    setQuote(selected.length > 240 ? `${selected.slice(0, 240)}…` : selected);
    setCommentsOpen(true);
  }

  const chapterWords = countWords(chapter?.text);
  const totalWords = bookWords(book);

  return (
    <div className={`editor${commentsOpen ? ' comments-open' : ''}`}>
      <a className="skip-link" href="#writer">
        Skip to writing
      </a>
      <header className="editor-bar">
        <Link to="/" className="btn btn--ghost editor-bar__back" aria-label="Back to library">
          <Icon name="chevronLeft" size={22} />
          <span className="hide-sm">Library</span>
        </Link>

        <div className="editor-bar__title">
          <span className="editor-bar__swatch" style={{ background: color.bg }} aria-hidden="true" />
          <div className="editor-bar__text">
            <h1>{book.title}</h1>
            <span className={`save-state${saving ? ' is-saving' : ''}`} role="status">
              {saving ? (
                'Saving…'
              ) : (
                <>
                  <Icon name="check" size={14} strokeWidth={2.6} />
                  All changes saved
                </>
              )}
            </span>
          </div>
        </div>

        <div className="editor-bar__actions">
          <span className="hide-sm">
            <StatusChip status={book.status} />
          </span>
          <button
            type="button"
            className="btn btn--outline editor-bar__settings"
            aria-label="Book settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" size={18} />
            <span className="hide-sm">Settings</span>
          </button>
          <button
            type="button"
            className="icon-btn editor-bar__comments"
            aria-label={`Comments, ${openCount} open`}
            aria-expanded={commentsOpen}
            onClick={() => setCommentsOpen((o) => !o)}
          >
            <Icon name="comment" size={22} />
            {openCount > 0 && <span className="dot-badge">{openCount}</span>}
          </button>
        </div>
      </header>

      <div className="editor__layout">
        <aside className="chapters panel" aria-label="Chapters">
          <div className="chapters__head">
            <h2 className="panel-title">Chapters</h2>
            <span className="small muted">{book.chapters.length}</span>
          </div>
          <ol className="chapters__list">
            {book.chapters.map((c, i) => {
              const active = c.id === chapter?.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`chapter-btn${active ? ' is-active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectChapter(c.id)}
                  >
                    <span className="chapter-btn__num">{i + 1}</span>
                    <span className="chapter-btn__text">
                      <span className="chapter-btn__title">{c.title || 'Untitled chapter'}</span>
                      <span className="small muted">{formatNumber(countWords(c.text))} words</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn--dashed" onClick={handleAddChapter}>
            <Icon name="plus" size={18} />
            Add chapter
          </button>
        </aside>

        <section className="writer panel" aria-label="Chapter editor">
          <div className="writer__toolbar">
            <div className="chapter-picker">
              <label className="sr-only" htmlFor="chapter-picker">
                Chapter
              </label>
              <select id="chapter-picker" value={chapter?.id} onChange={(e) => selectChapter(e.target.value)}>
                {book.chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {c.title || 'Untitled chapter'}
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn" aria-label="Add chapter" onClick={handleAddChapter}>
                <Icon name="plus" />
              </button>
            </div>
            <button type="button" className="btn btn--amber" onClick={startComment}>
              <Icon name="commentPlus" size={18} />
              Comment
            </button>
            <span className="small muted writer__hint">Select text first to quote it</span>
            <button
              type="button"
              className="icon-btn writer__delete"
              aria-label="Delete chapter"
              title={book.chapters.length <= 1 ? 'A book needs at least one chapter' : 'Delete chapter'}
              onClick={handleDeleteChapter}
              disabled={book.chapters.length <= 1}
            >
              <Icon name="trash" />
            </button>
          </div>

          {chapter && (
            <div className="writer__page" id="writer">
              <span className="eyebrow">Chapter {chapterIndex + 1}</span>
              <input
                className="writer__title"
                aria-label="Chapter title"
                placeholder="Chapter title"
                value={chapter.title}
                onChange={(e) => editChapter({ title: e.target.value })}
              />
              <textarea
                ref={textRef}
                className="writer__text"
                aria-label="Chapter text"
                placeholder="Start writing…"
                value={chapter.text}
                onChange={(e) => editChapter({ text: e.target.value })}
              />
            </div>
          )}

          <footer className="writer__foot small muted">
            <span>{formatNumber(chapterWords)} words in this chapter</span>
            <span>
              Book: {formatNumber(totalWords)}
              {book.goal ? ` / ${formatNumber(book.goal)} words · ${bookProgress(book)}%` : ' words'}
            </span>
          </footer>
        </section>

        <CommentsPanel
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          chapterTitle={chapter?.title}
          comments={chapterComments}
          quote={quote}
          onClearQuote={() => setQuote('')}
          onAdd={(text) => {
            addComment(book.id, { chapterId: chapter.id, text, quote });
            setQuote('');
          }}
          onToggle={(id) => toggleComment(book.id, id)}
          onDelete={(id) => deleteComment(book.id, id)}
        />
      </div>

      <BookFormDialog
        open={settingsOpen}
        book={book}
        onClose={() => setSettingsOpen(false)}
        onSubmit={(data) => updateBook(book.id, data)}
        onDelete={() => {
          deleteBook(book.id);
          navigate('/');
        }}
      />
    </div>
  );
}
