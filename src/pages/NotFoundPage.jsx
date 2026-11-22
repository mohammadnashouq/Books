import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="container page">
      <div className="empty">
        <h1>Page not found</h1>
        <p className="muted">That page doesn’t exist.</p>
        <Link to="/" className="btn btn--primary">
          Back to library
        </Link>
      </div>
    </div>
  );
}
