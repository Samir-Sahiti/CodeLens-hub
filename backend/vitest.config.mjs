import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/services/**', 'src/parsers/**'],
      exclude: [
        'src/services/indexer.js', // heavy IO / filesystem orchestration
        'src/services/indexerService.js', // end-to-end pipeline (covered via integration-level testing)
        'src/parsers/debug-ast.js', // dev helper script
        'src/parsers/test-parser.js', // manual parser runner
      ],
      thresholds: {
        lines: 70,
      },
    },
  },
});
