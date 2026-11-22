import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Fonts are bundled with the app (no requests to third-party font servers).
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import { BooksProvider } from './store/BooksContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import App from './App.jsx';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <BooksProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BooksProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
