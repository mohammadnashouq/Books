import { Routes, Route } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import StorageBanner from './components/StorageBanner.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import CommentsPage from './pages/CommentsPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <>
      <StorageBanner />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<LibraryPage />} />
          <Route path="comments" element={<CommentsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="books/:bookId" element={<EditorPage />} />
      </Routes>
    </>
  );
}
