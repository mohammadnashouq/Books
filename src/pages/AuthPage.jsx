import { useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import '../styles/auth.css';

/** Only same-site paths are allowed as a redirect target after signing in. */
// eslint-disable-next-line react-refresh/only-export-components
export function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // Browsers read "/\host" as "//host"; reject backslashes and control characters outright.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(value)) return '/';
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

export default function AuthPage({ mode }) {
  const register = mode === 'register';
  const { user, expired, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `${register ? 'Create account' : 'Sign in'} · Books`;
    return () => {
      document.title = 'Books';
    };
  }, [register]);

  // Signed in already (and the session is still good): nothing to do here.
  if (user && !expired && !busy) return <Navigate to={next} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (register && password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      await signIn(register ? 'register' : 'login', username.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const otherLink = `${register ? '/login' : '/register'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="container page auth">
      <form className="auth__card panel" onSubmit={handleSubmit} aria-labelledby={`${id}-title`} noValidate>
        <h1 id={`${id}-title`} className="auth__title">
          {register ? 'Create your account' : 'Sign in'}
        </h1>
        <p className="muted small">
          {register
            ? 'Just a username and a password: no email needed.'
            : 'Sign in to write and save your books.'}
        </p>

        <div className="field">
          <label htmlFor={`${id}-username`}>Username</label>
          <input
            id={`${id}-username`}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9._\-]{3,32}"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-describedby={register ? `${id}-username-hint` : undefined}
            autoFocus
          />
          {register && (
            <span id={`${id}-username-hint`} className="small muted">
              3–32 characters: letters, numbers, dot, dash or underscore.
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            required
            minLength={register ? 8 : undefined}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={register ? `${id}-password-hint` : undefined}
          />
          {register && (
            <span id={`${id}-password-hint`} className="small muted">
              At least 8 characters.
            </span>
          )}
        </div>

        {register && (
          <div className="field">
            <label htmlFor={`${id}-confirm`}>Repeat password</label>
            <input
              id={`${id}-confirm`}
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              maxLength={200}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}

        {register && (
          <p className="auth__warning small">
            There’s no email, so a forgotten password can’t be reset. Store it in a password manager, and download a
            backup of your books now and then.
          </p>
        )}

        {error && (
          <p className="auth__error small" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
        </button>

        <p className="small muted auth__switch">
          {register ? 'Already have an account? ' : 'New here? '}
          <Link to={otherLink}>{register ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </form>
    </div>
  );
}
