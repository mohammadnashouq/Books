import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext.jsx';
import { useBooks } from '../store/BooksContext.jsx';
import { openComments } from '../lib/utils.js';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';
import '../styles/layout.css';
import '../styles/auth.css';

const navClass = (base) => ({ isActive }) => (isActive ? `${base} is-active` : base);

/** Sign out, warning first if some work hasn't reached the server yet. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSignOut() {
  const { signOut } = useAuth();
  const { signedIn, isFullySynced, forgetLocalCopy, losers } = useBooks();
  const navigate = useNavigate();
  const { showToast } = useToast();
  return async () => {
    const unsent = signedIn && !isFullySynced();
    const kept = signedIn && losers.length > 0;
    if (unsent || kept) {
      const what = [
        unsent && 'some changes haven’t reached the server yet',
        kept && `${losers.length} conflicting ${losers.length === 1 ? 'version is' : 'versions are'} waiting to be downloaded`,
      ]
        .filter(Boolean)
        .join(', and ');
      const ok = window.confirm(
        `Before you go: ${what}. They stay in this browser and come back the next time you sign in here. Sign out anyway?`,
      );
      if (!ok) return;
    }
    try {
      await signOut({
        // Everything is on the server: don't leave a copy behind on this computer.
        beforeClear: () => {
          if (signedIn && isFullySynced()) forgetLocalCopy();
        },
      });
      navigate('/browse');
    } catch (error) {
      showToast({ message: `Couldn’t sign out (${error.message}) You’re still signed in; try again.` });
    }
  };
}

export default function AppLayout() {
  const { user } = useAuth();
  const { books } = useBooks();
  const signOut = useSignOut();
  const location = useLocation();
  const open = books.reduce((n, b) => n + openComments(b), 0);
  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="container topbar__inner">
          <Link to="/" className="brand">
            <span className="brand__mark">
              <Icon name="book" size={22} />
            </span>
            <span className="brand__name">Books</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end className={navClass('topnav__link')}>
              My books
            </NavLink>
            <NavLink to="/browse" className={navClass('topnav__link')}>
              Browse
            </NavLink>
            {user && (
              <NavLink to="/comments" className={navClass('topnav__link')}>
                Comments
                {open > 0 && <span className="count-badge">{open}</span>}
              </NavLink>
            )}
          </nav>
          <div className="account">
            {user ? (
              <>
                <span className="account__name small" title={`Signed in as ${user.username}`}>
                  {user.username}
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to={`/login?next=${next}`} className="btn btn--ghost btn--sm">
                  Sign in
                </Link>
                <Link to={`/register?next=${next}`} className="btn btn--primary btn--sm">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="app__main">
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="Main">
        <NavLink to="/" end className={navClass('bottomnav__link')}>
          <Icon name="book" size={22} />
          My books
        </NavLink>
        <NavLink to="/browse" className={navClass('bottomnav__link')}>
          <Icon name="search" size={22} />
          Browse
        </NavLink>
        {user && (
          <NavLink to="/comments" className={navClass('bottomnav__link')}>
            <span className="bottomnav__icon">
              <Icon name="comment" size={22} />
              {open > 0 && <span className="dot-badge">{open}</span>}
            </span>
            Comments
          </NavLink>
        )}
      </nav>
    </div>
  );
}
