const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const CSharp = require('tree-sitter-c-sharp');
const path = require('path');

const LANGUAGE_MAP = {
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.ts': TypeScript,
  '.tsx': TypeScript,
  '.py': Python,
  '.cs': CSharp,
};

const CHUNK_QUERIES = {
  javascript: `
    (function_declaration) @chunk
    (class_declaration) @chunk
    (method_definition) @chunk
    (arrow_function) @chunk
    (export_statement (declaration)) @chunk
  `,
  python: `
    (module) @chunk
    (function_definition) @chunk
    (class_definition) @chunk
  `,
  c_sharp: `
    (method_declaration) @chunk
    (class_declaration) @chunk
  `
};

const getLanguageKey = (ext) => {
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.cs') return 'c_sharp';
  return null;
};

// Heuristic token estimator (industry standard rough estimate ~4 chars per token)
const estimateTokens = (text) => Math.ceil(text.length / 4);

// Function to mechanically slice text lines that exceed token limits
const sliceTextByTokensAndLines = (lines, startLine) => {
  const chunks = [];
  let currentLines = [];
  let currentTokenCount = 0;
  let currentStart = startLine;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = Math.ceil((line.length + 1) / 4);
    
    // using 450 token safety buffer to guarantee <512 limit
    if (currentTokenCount + lineTokens > 450 && currentLines.length > 0) {
      chunks.push({
        text: currentLines.join('\n'),
        start: currentStart,
        end: currentStart + currentLines.length - 1
      });
      currentLines = [];
      currentTokenCount = 0;
      currentStart = startLine + i;
    }
    
    currentLines.push(line);
    currentTokenCount += lineTokens;
  }
  
  if (currentLines.length > 0) {
    chunks.push({
      text: currentLines.join('\n'),
      start: currentStart,
      end: currentStart + currentLines.length - 1
    });
  }
  
  return chunks;
};

const extractChunksFromFile = (filePath, sourceContent, repoId) => {
  if (!sourceContent || sourceContent.trim().length === 0) return [];
  
  const ext = path.extname(filePath).toLowerCase();
  const rawLines = sourceContent.split('\n');
  const lineCount = rawLines.length;

  const createChunkObject = (content, start, end) => ({
    repo_id: repoId,
    file_path: filePath,
    start_line: start,
    end_line: end,
    content: content.trim()
  });

  // Short file fallback
  if (lineCount <= 50) {
    const tokens = estimateTokens(sourceContent);
    if (tokens <= 500) {
      return [createChunkObject(sourceContent, 1, lineCount)];
    } else {
      // Exceeds 500 tokens but under 50 lines (e.g. minified logic)
      const slices = sliceTextByTokensAndLines(rawLines, 1);
      return slices.map(s => createChunkObject(s.text, s.start, s.end));
    }
  }

  const language = LANGUAGE_MAP[ext];
  const queryKey = getLanguageKey(ext);
  const queryStr = CHUNK_QUERIES[queryKey];

  if (!language || !queryStr) {
    // Unsupported language fallback - split entirely by mechanical lines/tokens
    const slices = sliceTextByTokensAndLines(rawLines, 1);
    return slices.map(s => createChunkObject(s.text, s.start, s.end));
  }

  try {
    const parser = new Parser();
    parser.setLanguage(language);
    const src = typeof sourceContent === 'string' ? sourceContent : (sourceContent == null ? '' : String(sourceContent));
    // tree-sitter v0.21.x rejects strings longer than 32767 chars; use callback for large files
    const tree = src.length < 32768
      ? parser.parse(src)
      : parser.parse((i) => i < src.length ? src.slice(i, i + 8192) : null);
    const query = new Parser.Query(language, queryStr);
    const matches = query.matches(tree.rootNode);

    const chunks = [];

    for (const match of matches) {
      for (const capture of match.captures) {
        const start = capture.node.startPosition.row + 1;
        const end = capture.node.endPosition.row + 1;
        
        // Minimum 5 lines logical split rule (4 lines +) per note
        if (end - start < 4) continue;

        const text = capture.node.text;
        const tokens = estimateTokens(text);
        
        if (tokens > 500) {
          const slices = sliceTextByTokensAndLines(text.split('\n'), start);
          slices.forEach(s => chunks.push(createChunkObject(s.text, s.start, s.end)));
        } else {
          chunks.push(createChunkObject(text, start, end));
        }
      }
    }
    
    // Fill uncovered structural gaps to strictly guarantee 100% file code coverage
    const coveredLines = new Set();
    for (const c of chunks) {
      for (let l = c.start_line; l <= c.end_line; l++) coveredLines.add(l);
    }

    let gapStart = null;
    const gapChunks = [];
    for (let i = 1; i <= lineCount; i++) {
      if (!coveredLines.has(i)) {
        if (gapStart === null) gapStart = i;
      } else {
        if (gapStart !== null) {
          const gapLines = rawLines.slice(gapStart - 1, i - 1);
          if (gapLines.join('').trim().length > 0) {
            const slices = sliceTextByTokensAndLines(gapLines, gapStart);
            slices.forEach(s => gapChunks.push(createChunkObject(s.text, s.start, s.end)));
          }
          gapStart = null;
        }
      }
    }
    if (gapStart !== null) {
      const gapLines = rawLines.slice(gapStart - 1, lineCount);
      if (gapLines.join('').trim().length > 0) {
        const slices = sliceTextByTokensAndLines(gapLines, gapStart);
        slices.forEach(s => gapChunks.push(createChunkObject(s.text, s.start, s.end)));
      }
    }
    chunks.push(...gapChunks);

    // If AST didn't capture anything, default to mechanical slicing
    if (chunks.length === 0) {
      const slices = sliceTextByTokensAndLines(rawLines, 1);
      return slices.map(s => createChunkObject(s.text, s.start, s.end));
    }

    // Eliminate exact coordinate captures (avoid overriding generic content)
    const unique = [];
    const seen = new Set();
    for (const c of chunks) {
      const key = `${c.file_path}:${c.start_line}-${c.end_line}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }

    return unique;

  } catch (err) {
    console.warn(`[chunkParser] Failed to parse AST for ${filePath}: ${err.message}. Falling back to token slicing.`);
    // Fallback mechanical slicing
    const slices = sliceTextByTokensAndLines(rawLines, 1);
    return slices.map(s => createChunkObject(s.text, s.start, s.end));
  }
};

module.exports = { extractChunksFromFile, estimateTokens };
