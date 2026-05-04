import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { isTestFilePath, parseCoverageOverrides } from '../src/services/testCoverageService.js';

let tempDirs = [];

async function makeTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codelens-coverage-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('testCoverageService', () => {
  it('identifies supported test file naming patterns strictly', () => {
    expect(isTestFilePath('src/foo.test.js')).toBe(true);
    expect(isTestFilePath('src/foo.spec.ts')).toBe(true);
    expect(isTestFilePath('tests/api.py')).toBe(true);
    expect(isTestFilePath('src/test_widget.py')).toBe(true);
    expect(isTestFilePath('pkg/widget_test.go')).toBe(true);
    expect(isTestFilePath('src/UserServiceTest.java')).toBe(true);
    expect(isTestFilePath('src/UserServiceTests.cs')).toBe(true);
    expect(isTestFilePath('src/contest.js')).toBe(false);
  });

  it('maps ambiguous LCOV filenames by exact path before suffix fallback', async () => {
    const repo = await makeTempRepo();
    await fs.writeFile(path.join(repo, 'unit.lcov'), [
      'TN:',
      'SF:/workspace/src/a/util.js',
      'LF:10',
      'LH:0',
      'end_of_record',
      'TN:',
      'SF:/workspace/src/b/util.js',
      'LF:10',
      'LH:8',
      'end_of_record',
    ].join('\n'));

    const { coverageByPath } = await parseCoverageOverrides(repo, ['src/a/util.js', 'src/b/util.js']);

    expect(coverageByPath.get('src/a/util.js')).toBe(0);
    expect(coverageByPath.get('src/b/util.js')).toBe(80);
  });

  it('warns and falls back when coverage.xml is not Cobertura', async () => {
    const repo = await makeTempRepo();
    await fs.writeFile(path.join(repo, 'coverage.xml'), '<report><package name="x"><counter type="LINE" covered="1" missed="1"/></package></report>');

    const { coverageByPath, hasCoverageFiles } = await parseCoverageOverrides(repo, ['src/app.js']);

    expect(hasCoverageFiles).toBe(true);
    expect(coverageByPath.size).toBe(0);
  });
});
