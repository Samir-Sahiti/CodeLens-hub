import { describe, expect, it } from 'vitest';

import { parseFile } from '../src/parsers/repositoryParser.js';

describe('repositoryParser.parseFile', () => {
  it('parses JS/TS imports and resolves relative paths', () => {
    const allFiles = new Set([
      'src/foo.js',
      'bar.ts',
      'src/index.ts',
    ]);

    const source = [
      "import foo from './foo';",
      "const bar = require('../bar');",
      "import('./index');",
      '',
    ].join('\n');

    const result = parseFile('src/main.js', source, allFiles);
    expect(result.filePath).toBe('src/main.js');
    expect(result.imports).toContain('src/foo.js');
    expect(result.imports).toContain('bar.ts');
    expect(result.imports).toContain('src/index.ts');
  });

  it('parses Python imports (absolute and relative)', () => {
    const allFiles = new Set([
      'pkg/utils.py',
      'pkg/sub/__init__.py',
      'pkg/sub/mod.py',
    ]);

    const source = [
      'from .utils import thing',
      'from pkg.sub import mod',
    ].join('\n');

    const result = parseFile('pkg/mod.py', source, allFiles);
    expect(result.imports).toContain('pkg/utils.py');
    expect(result.imports).toContain('pkg/sub/__init__.py');
  });

  it('parses C# using directives using a namespace map', () => {
    const namespaceMap = new Map([
      ['MyApp.Services', ['src/Services/UserService.cs']],
      ['MyApp.Utils', ['src/Utils/Thing.cs', 'src/Utils/Other.cs']],
    ]);

    const source = [
      'using MyApp.Services;',
      'using MyApp.Utils;',
      'namespace MyApp {',
      '  class Program {}',
      '}',
    ].join('\n');

    const result = parseFile('src/Program.cs', source, namespaceMap);
    expect(result.imports).toContain('src/Services/UserService.cs');
    expect(result.imports).toContain('src/Utils/Thing.cs');
    expect(result.imports).toContain('src/Utils/Other.cs');
  });
});

