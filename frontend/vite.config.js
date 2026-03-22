import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '../', // Read .env from the root directory instead of frontend/
  server: {
    port: 3000,
    proxy: {
      // Forward all /api/* requests to the Express backend in dev.
      // This covers /api/auth, /api/repos, /api/search, /api/analysis.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
