import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import yaml from 'js-yaml';

function onboardingPlugin() {
  return {
    name: 'codelens-onboarding',
    transform(src, id) {
      if (!id.endsWith('onboarding-guide.md')) return null;

      const sections = src
        .split(/^---\s*$/m)
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((acc, part, index, parts) => {
          if (index % 2 !== 0) return acc;
          const frontmatter = yaml.load(part) || {};
          const body = (parts[index + 1] || '').trim();
          acc.push({ ...frontmatter, body });
          return acc;
        }, []);

      return {
        code: `export const sections = ${JSON.stringify(sections)};`,
        map: null,
      };
    },
  };
}

// Bundle visualizer (Phase 0): generates dist/stats.html on every production
// build so chunk size regressions are visible. Loaded dynamically to avoid
// pulling the dep into the dev server. Soft-fails if the plugin is not
// installed yet.
let visualizerPlugin = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { visualizer } = require('rollup-plugin-visualizer');
  visualizerPlugin = visualizer({
    filename: 'dist/stats.html',
    template: 'treemap',
    gzipSize: true,
    brotliSize: true,
  });
} catch {
  // rollup-plugin-visualizer not installed — that's fine, just skip.
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read env from root directory
  const env = loadEnv(mode, '../', '');

  return {
    plugins: [react(), onboardingPlugin(), ...(visualizerPlugin ? [visualizerPlugin] : [])],
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
