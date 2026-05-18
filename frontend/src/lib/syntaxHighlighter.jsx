/**
 * Tree-shaken syntax highlighter (Phase 4.2).
 *
 * react-syntax-highlighter's `Prism` entrypoint bundles the full Prism core
 * plus *every* language definition (~250 KB minified). The `light` entrypoint
 * lets us register only the languages the indexer actually supports — eight
 * source languages plus a handful of config/markup formats — saving ~50 KB on
 * the initial bundle.
 *
 * Use the default export as a drop-in replacement for `Prism as SyntaxHighlighter`:
 *
 *   import SyntaxHighlighter from '../lib/syntaxHighlighter';
 *   import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
 *
 *   <SyntaxHighlighter language="python" style={vscDarkPlus}>...</SyntaxHighlighter>
 */

import { PrismLight } from 'react-syntax-highlighter';

import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx        from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx        from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import python     from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import csharp     from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import go         from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java       from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import rust       from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import ruby       from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import bash       from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json       from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml       from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markdown   from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import sql        from 'react-syntax-highlighter/dist/esm/languages/prism/sql';

PrismLight.registerLanguage('javascript', javascript);
PrismLight.registerLanguage('typescript', typescript);
PrismLight.registerLanguage('jsx',        jsx);
PrismLight.registerLanguage('tsx',        tsx);
PrismLight.registerLanguage('python',     python);
PrismLight.registerLanguage('csharp',     csharp);
PrismLight.registerLanguage('go',         go);
PrismLight.registerLanguage('java',       java);
PrismLight.registerLanguage('rust',       rust);
PrismLight.registerLanguage('ruby',       ruby);
PrismLight.registerLanguage('bash',       bash);
PrismLight.registerLanguage('json',       json);
PrismLight.registerLanguage('yaml',       yaml);
PrismLight.registerLanguage('markdown',   markdown);
PrismLight.registerLanguage('sql',        sql);

export default PrismLight;
