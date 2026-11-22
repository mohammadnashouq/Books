import { useEffect, useId, useRef, useState } from 'react';
import { COVER_COLORS, GENRES, STATUSES, coverColor } from '../data/constants.js';
import Icon from './Icon.jsx';
import '../styles/dialog.css';

const BLANK = { title: '', genre: '', status: 'draft', goal: '60000', color: 'violet' };

export default function BookFormDialog({ open, onClose, onSubmit, onDelete, book }) {
  const ref = useRef(null);
  const id = useId();
  const [form, setForm] = useState(BLANK);
  const [wasOpen, setWasOpen] = useState(false);

  // Reset the form each time the dialog opens (during render, not in an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(
        book
          ? { title: book.title, genre: book.genre, status: book.status, goal: String(book.goal || ''), color: book.color }
          : BLANK,
      );
    }
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    onSubmit({
      title,
      genre: form.genre.trim(),
      status: form.status,
      goal: Math.max(0, parseInt(form.goal, 10) || 0),
      color: form.color,
    });
    onClose();
  }

  function handleDelete() {
    if (window.confirm(`Delete “${book.title}”? This removes all its chapters and comments.`)) {
      onDelete();
    }
  }

  const preview = coverColor(form.color);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-heading`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <form className="dialog__form" onSubmit={handleSubmit}>
        <div className="dialog__head">
          <h2 id={`${id}-heading`}>{book ? 'Book settings' : 'New book'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="dialog__body">
          <div
            className="cover dialog__preview"
            style={{ '--cover-bg': preview.bg, '--cover-ink': preview.ink }}
            aria-hidden="true"
          >
            <span className="cover__genre">{form.genre || 'Genre'}</span>
            <span className="cover__title">{form.title || 'Your title'}</span>
          </div>

          <div className="dialog__fields">
            <div className="field">
              <label htmlFor={`${id}-title`}>Title</label>
              <input id={`${id}-title`} value={form.title} onChange={set('title')} required autoFocus maxLength={120} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-genre`}>Genre</label>
                <input id={`${id}-genre`} list={`${id}-genres`} value={form.genre} onChange={set('genre')} maxLength={40} />
                <datalist id={`${id}-genres`}>
                  {GENRES.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor={`${id}-status`}>Status</label>
                <select id={`${id}-status`} value={form.status} onChange={set('status')}>
                  {Object.entries(STATUSES).map(([value, s]) => (
                    <option key={value} value={value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor={`${id}-goal`}>Word goal</label>
              <input
                id={`${id}-goal`}
                type="number"
                inputMode="numeric"
                min="0"
                step="1000"
                value={form.goal}
                onChange={set('goal')}
              />
            </div>

            <fieldset className="field">
              <legend>Cover color</legend>
              <div className="swatches">
                {COVER_COLORS.map((c) => (
                  <label key={c.id} className="swatch" style={{ '--swatch': c.bg }} title={c.name}>
                    <input
                      type="radio"
                      name={`${id}-color`}
                      value={c.id}
                      checked={form.color === c.id}
                      onChange={set('color')}
                    />
                    <span className="sr-only">{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <div className="dialog__foot">
          {book && onDelete && (
            <button type="button" className="btn btn--danger" onClick={handleDelete}>
              <Icon name="trash" size={18} />
              Delete book
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            {book ? 'Save changes' : 'Create book'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
