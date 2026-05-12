/**
 * SharedAnswerComponents.jsx
 *
 * Shared UI components for rendering AI-streamed responses and source references.
 * Used by SearchPanel, CodeReviewPanel, FileChatPanel.
 *
 * Exports:
 *   - CopyIcon, ChevronDownIcon, ChevronUpIcon  (legacy — still used in other panels)
 *   - getLanguageClass
 *   - HighlightedCodeBlock
 *   - AnswerBlock  (uses react-markdown + remark-gfm + syntax highlighting)
 *   - SourceCard
 */

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm     from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus }                from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, ChevronDown, ChevronUp } from './ui/Icons';

// ---------------------------------------------------------------------------
// Legacy icon helpers (kept for backward-compatibility)
// ---------------------------------------------------------------------------

export function CopyIcon({ className = 'h-4 w-4' }) {
  return <Copy className={className} />;
}

export function ChevronDownIcon({ className = 'h-4 w-4' }) {
  return <ChevronDown className={className} />;
}

export function ChevronUpIcon({ className = 'h-4 w-4' }) {
  return <ChevronUp className={className} />;
}

// ---------------------------------------------------------------------------
// Language detection helper
// ---------------------------------------------------------------------------

export function getLanguageClass(filePath) {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map = {
    js:   'javascript', jsx: 'javascript',
    ts:   'typescript', tsx: 'typescript',
    py:   'python',
    cs:   'csharp',
    go:   'go',
    java: 'java',
    rs:   'rust',
    rb:   'ruby',
    json: 'json',
    md:   'markdown',
    css:  'css',
    html: 'html',
    sh:   'bash',
    yaml: 'yaml',
    yml:  'yaml',
  };
  return map[ext] || 'text';
}

// ---------------------------------------------------------------------------
// HighlightedCodeBlock — shared syntax-highlighted code block
// ---------------------------------------------------------------------------

export function HighlightedCodeBlock({
  code,
  language = 'text',
  className = '',
  showCopy = true,
  showLineNumbers = false,
  wrapLines = false,
  customStyle = {},
  ...props
}) {
  const [copied, setCopied] = useState(false);
  const sourceCode = String(code ?? '').replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sourceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }, [sourceCode]);

  return (
    <div className={`group relative overflow-hidden rounded-lg border border-surface-700 bg-surface-950 ${className}`}>
      <div className="flex items-center justify-between border-b border-surface-800 bg-surface-900 px-4 py-1.5">
        <span className="font-mono text-xs text-surface-400">{language}</span>
        {showCopy && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-surface-400 transition hover:bg-surface-800 hover:text-white"
            title="Copy code"
          >
            {copied
              ? <><Check className="h-3 w-3 text-emerald-400" /> Copied!</>
              : <><Copy className="h-3 w-3" /> Copy</>
            }
          </button>
        )}
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        showLineNumbers={showLineNumbers}
        wrapLines={wrapLines}
        customStyle={{
          margin: 0,
          padding: '1rem',
          background: 'rgba(9,10,15,0.96)',
          fontSize: '0.75rem',
          lineHeight: '1.6',
          ...customStyle,
        }}
        PreTag="div"
        {...props}
      >
        {sourceCode}
      </SyntaxHighlighter>
    </div>
  );
}

function CodeBlock({ children, className, ...props }) {
  const lang = /language-(\w+)/.exec(className || '')?.[1] ?? 'text';
  return (
    <HighlightedCodeBlock
      code={children}
      language={lang}
      className="my-4"
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// AnswerBlock — renders full markdown with GFM, code highlighting, streaming cursor
// ---------------------------------------------------------------------------

const mdComponents = {
  code({ node, inline, className, children, ...props }) {
    if (inline) {
      return (
        <code
          className="rounded bg-surface-800 px-1.5 py-0.5 font-mono text-[0.8em] text-accent-soft"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <CodeBlock className={className} {...props}>
        {children}
      </CodeBlock>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-accent-soft underline underline-offset-2 transition-colors hover:text-blue-200"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-accent/50 pl-4 italic text-surface-400">
        {children}
      </blockquote>
    );
  },
  ul({ children }) {
    return <ul className="list-disc list-inside space-y-1 my-2 text-gray-300">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside space-y-1 my-2 text-gray-300">{children}</ol>;
  },
  h1({ children }) {
    return <h1 className="text-lg font-bold text-white mt-4 mb-2">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-base font-semibold text-gray-100 mt-4 mb-2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold text-gray-200 mt-3 mb-1">{children}</h3>;
  },
  p({ children }) {
    return <p className="text-gray-300 leading-relaxed mb-2">{children}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-gray-100">{children}</strong>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full text-sm border-collapse border border-gray-700">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border border-gray-700 bg-gray-800 px-3 py-2 text-left text-xs font-semibold text-gray-300">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-gray-700 px-3 py-2 text-gray-400">{children}</td>;
  },
};

export function AnswerBlock({ text, isStreaming }) {
  if (!text) return null;
  return (
    <div className="prose-invert max-w-none text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
      {isStreaming && (
        <span
          className="ml-0.5 inline-block h-4 w-0.5 bg-accent align-middle"
          style={{ animation: 'pulse 1s ease infinite' }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceCard — one referenced chunk from the RAG retrieval
// ---------------------------------------------------------------------------

export function SourceCard({ source, index }) {
  const [expanded, setExpanded] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const lang = getLanguageClass(source.file_path);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source.file_path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <div
      className="overflow-hidden rounded-lg border border-surface-800 bg-surface-900/70 text-sm"
      style={{ animation: `slideUp 250ms ease ${index * 60}ms both` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-surface-800 bg-surface-850 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-500 shrink-0">#{index + 1}</span>
          <button
            onClick={handleCopy}
            title="Copy file path"
            className="flex items-center gap-1.5 min-w-0 group"
          >
            <span className="truncate font-mono text-xs text-accent-soft transition-colors group-hover:text-blue-200">
              {source.file_path}
            </span>
            <Copy className="h-3 w-3 shrink-0 text-surface-600 transition-colors group-hover:text-accent-soft" />
          </button>
          {copied && <span className="text-xs text-emerald-400 shrink-0">Copied!</span>}
        </div>
        <span className="text-xs text-gray-600 shrink-0 whitespace-nowrap">
          L{source.start_line}–{source.end_line}
        </span>
      </div>

      {/* Excerpt */}
      <pre className="overflow-x-auto bg-surface-950/80 px-4 py-3 text-xs leading-relaxed">
        <code className={`language-${lang} text-gray-400 font-mono`}>
          {source.excerpt}
        </code>
      </pre>

      {/* Expand toggle */}
      {source.full_content && source.full_content !== source.excerpt && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-surface-800 py-1.5 text-xs text-surface-500 transition-colors hover:bg-surface-800/50 hover:text-surface-300"
          >
            {expanded
              ? <><ChevronUp className="h-3 w-3" /> Collapse</>
              : <><ChevronDown className="h-3 w-3" /> Expand full chunk</>
            }
          </button>
          {expanded && (
            <pre className="overflow-x-auto border-t border-surface-800 bg-surface-950 px-4 py-3 text-xs leading-relaxed">
              <code className={`language-${lang} text-gray-400 font-mono`}>
                {source.full_content}
              </code>
            </pre>
          )}
        </>
      )}
    </div>
  );
}
