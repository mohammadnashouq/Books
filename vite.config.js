import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    // The API server (npm run dev:server) runs on 3001 in development.
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
  },
});
