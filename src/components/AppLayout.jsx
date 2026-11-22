import { Link, NavLink, Outlet } from 'react-router-dom';
import { useBooks } from '../store/BooksContext.jsx';
import { openComments } from '../lib/utils.js';
import Icon from './Icon.jsx';
import '../styles/layout.css';

const navClass = (base) => ({ isActive }) => (isActive ? `${base} is-active` : base);

export default function AppLayout() {
  const { books } = useBooks();
  const open = books.reduce((n, b) => n + openComments(b), 0);

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
              Library
            </NavLink>
            <NavLink to="/comments" className={navClass('topnav__link')}>
              Comments
              {open > 0 && <span className="count-badge">{open}</span>}
            </NavLink>
          </nav>
        </div>
      </header>

      <main id="main" className="app__main">
        <Outlet />
      </main>

      <nav className="bottomnav" aria-label="Main">
        <NavLink to="/" end className={navClass('bottomnav__link')}>
          <Icon name="book" size={22} />
          Library
        </NavLink>
        <NavLink to="/comments" className={navClass('bottomnav__link')}>
          <span className="bottomnav__icon">
            <Icon name="comment" size={22} />
            {open > 0 && <span className="dot-badge">{open}</span>}
          </span>
          Comments
        </NavLink>
      </nav>
    </div>
  );
}
