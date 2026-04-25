import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read env from root directory
  const env = loadEnv(mode, '../', '');

  return {
    plugins: [react()],
    envDir: '../', // Tell Vite where to find .env for CLIENT-side variables

    server: {
      port: 3000,
      proxy: {
        // Forward all /api/* requests to the backend.
        // In Docker, we use 'http://backend:3001'.
        // For local development outside Docker, defaults to 'http://localhost:3001'.
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },

    build: {
      // Raise the default warning threshold (default is 500kb)
      chunkSizeWarningLimit: 1500,

      rollupOptions: {
        output: {
          /**
           * Manual chunk splitting for optimal caching and parallel loading.
           *
           * Strategy:
           *   vendor-react      — React runtime (rarely changes)
           *   vendor-router     — React Router
           *   vendor-motion     — Framer Motion (large, dedicated chunk)
           *   vendor-graph      — D3 (large, only used on graph tab)
           *   vendor-highlight  — react-syntax-highlighter (large, lazy-loaded)
           *   vendor-markdown   — react-markdown + remark/rehype
           * Remaining vendor modules stay with Rollup's default chunk graph to
           * avoid artificial circular chunks between markdown utilities.
           */
          manualChunks(id) {
            // ── React core ───────────────────────────────────────────────────
            if (id.includes('node_modules/react/') ||
                id.includes('node_modules/react-dom/') ||
                id.includes('node_modules/scheduler/')) {
              return 'vendor-react';
            }

            // ── React Router ────────────────────────────────────────────────
            if (id.includes('node_modules/react-router') ||
                id.includes('node_modules/@remix-run/')) {
              return 'vendor-router';
            }

            // ── Framer Motion ───────────────────────────────────────────────
            if (id.includes('node_modules/framer-motion')) {
              return 'vendor-motion';
            }

            // ── D3 (dependency graph) ────────────────────────────────────────
            if (id.includes('node_modules/d3') ||
                id.includes('node_modules/d3-')) {
              return 'vendor-graph';
            }

            // ── Syntax highlighting ──────────────────────────────────────────
            if (id.includes('node_modules/react-syntax-highlighter') ||
                id.includes('node_modules/refractor') ||
                id.includes('node_modules/prismjs') ||
                id.includes('node_modules/highlight.js')) {
              return 'vendor-highlight';
            }

            // ── Markdown ────────────────────────────────────────────────────
            if (id.includes('node_modules/react-markdown') ||
                id.includes('node_modules/remark') ||
                id.includes('node_modules/rehype') ||
                id.includes('node_modules/unified') ||
                id.includes('node_modules/micromark') ||
                id.includes('node_modules/mdast-') ||
                id.includes('node_modules/hast-') ||
                id.includes('node_modules/vfile')) {
              return 'vendor-markdown';
            }

            return undefined;
          },
        },
      },
    },
  };
});
