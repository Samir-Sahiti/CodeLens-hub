import { describe, expect, it } from 'vitest';

import { scanFileForSecrets } from '../src/services/secretScanner.js';

describe('secretScanner', () => {
  it('returns no issues for benign content', async () => {
    const issues = await scanFileForSecrets('src/clean.js', 'const greeting = "hello world";\n');
    expect(issues).toEqual([]);
  });

  it('flags a hardcoded AWS access key id', async () => {
    const content = 'const key = "AKIAIOSFODNN7EXAMPLE";\n';
    const issues = await scanFileForSecrets('src/leaky.js', content);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe('hardcoded_secret');
    expect(issues[0].file_paths).toEqual(['src/leaky.js']);
    expect(issues[0]._meta).toMatchObject({ line_number: 1 });
    expect(issues[0].description).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('catches high-entropy assignments to sensitive variable names', async () => {
    const content = 'const api_token = "Zx9aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6";\n';
    const issues = await scanFileForSecrets('src/config.js', content);

    const generic = issues.find((i) => i._meta?.rule_id === 'generic_high_entropy');
    expect(generic).toBeDefined();
    expect(generic.severity).toBe('high');
  });

  it('reports the correct 1-indexed line number', async () => {
    const content = [
      'function helper() {',
      '  return true;',
      '}',
      'const key = "AKIAIOSFODNN7EXAMPLE";',
    ].join('\n');

    const issues = await scanFileForSecrets('src/oops.js', content);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]._meta.line_number).toBe(4);
  });
});
