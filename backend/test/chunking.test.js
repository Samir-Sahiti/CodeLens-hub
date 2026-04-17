import { describe, expect, it } from 'vitest';

import { estimateTokens, extractChunksFromFile } from '../src/parsers/chunkParser.js';

describe('chunkParser', () => {
  it('estimateTokens uses ~4 chars per token heuristic', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('extractChunksFromFile returns a single chunk for short files under the token limit', () => {
    const source = [
      'function add(a, b) {',
      '  return a + b;',
      '}',
      '',
    ].join('\n');

    const chunks = extractChunksFromFile('src/add.js', source, 'repo-1');
    expect(chunks.length).toBe(1);
    expect(chunks[0].file_path).toBe('src/add.js');
    expect(chunks[0].start_line).toBe(1);
    expect(chunks[0].end_line).toBe(4);
    expect(chunks[0].content).toContain('function add');
  });

  it('extractChunksFromFile slices short files that exceed the token limit', () => {
    const longLine = 'x'.repeat(3000);
    const source = [longLine, longLine].join('\n'); // <= 50 lines, > 500 tokens
    const chunks = extractChunksFromFile('minified.js', source, 'repo-1');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.file_path === 'minified.js')).toBe(true);
  });

  it('extractChunksFromFile uses AST chunks and fills uncovered gaps for supported languages', () => {
    const header = Array.from({ length: 30 }, (_, i) => `// header ${i + 1}`).join('\n');
    const bigFn = [
      'function big() {',
      ...Array.from({ length: 12 }, (_, i) => `  const v${i} = ${i};`),
      '  return 123;',
      '}',
    ].join('\n');
    // This function is intentionally too small to be captured by the AST query.
    const tinyFn = [
      'function tiny() {',
      '  return 1;',
      '}',
    ].join('\n');
    const footer = Array.from({ length: 30 }, (_, i) => `// footer ${i + 1}`).join('\n');

    const source = [header, bigFn, tinyFn, footer].join('\n\n');
    const chunks = extractChunksFromFile('src/file.js', source, 'repo-1');

    // Should include AST-captured big() plus additional gap chunks.
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.content.includes('function big'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('function tiny'))).toBe(true);
  });

  it('extractChunksFromFile falls back to mechanical slicing for unsupported extensions', () => {
    const source = Array.from({ length: 1200 }, (_, i) => `line ${i + 1} ${'x'.repeat(80)}`).join('\n');
    const chunks = extractChunksFromFile('README.md', source, 'repo-1');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.file_path === 'README.md')).toBe(true);
  });
});
