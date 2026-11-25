import { Routes, Route, useParams } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import StorageBanner from './components/StorageBanner.jsx';
import ConflictNotices from './components/ConflictNotices.jsx';
import { useAuth } from './store/AuthContext.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import CommentsPage from './pages/CommentsPage.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import ReaderPage from './pages/ReaderPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

/** Remount the reader per book so a previous book never flashes. */
function ReaderRoute() {
  const { bookId } = useParams();
  return <ReaderPage key={bookId} />;
}

export default function App() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <p className="muted" style={{ padding: 24 }}>
        Loading…
      </p>
    );
  }
  return (
    <>
      <StorageBanner />
      <ConflictNotices />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<LibraryPage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="read/:bookId" element={<ReaderRoute />} />
          <Route path="comments" element={<CommentsPage />} />
          <Route path="login" element={<AuthPage mode="login" key="login" />} />
          <Route path="register" element={<AuthPage mode="register" key="register" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="books/:bookId" element={<EditorPage />} />
      </Routes>
    </>
  );
}
