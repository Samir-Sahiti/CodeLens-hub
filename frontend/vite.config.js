import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read env from root directory
  const env = loadEnv(mode, '../', '');

  return {
    plugins: [react()],
    envDir: '../', // Also tell Vite where to find .env for CLIENT side variables
    server: {
      port: 3000,
      proxy: {
        // Forward all /api/* requests to the backend.
        // In Docker, we use 'http://backend:3001'.
        // For local development outside Docker, it defaults to 'http://localhost:3101'.
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3101',
          changeOrigin: true,
        },
      },
    },
  };
});
