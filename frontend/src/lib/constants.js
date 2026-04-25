/**
 * src/lib/constants.js
 *
 * Single source of truth for shared data, helpers, and mappings.
 * Import from here instead of defining locally in each component.
 */

// ── Language colour palette ─────────────────────────────────────────────────
export const LANGUAGE_COLORS = {
  javascript:  '#60a5fa',
  typescript:  '#60a5fa',
  python:      '#facc15',
  c_sharp:     '#a78bfa',
  go:          '#06b6d4',
  java:        '#f97316',
  rust:        '#ea580c',
  ruby:        '#ef4444',
  kotlin:      '#7c3aed',
  swift:       '#f97316',
  php:         '#818cf8',
  shell:       '#4ade80',
  yaml:        '#fbbf24',
  toml:        '#fbbf24',
  sql:         '#22d3ee',
  dockerfile:  '#38bdf8',
  xml:         '#94a3b8',
  css:         '#f472b6',
  html:        '#fb923c',
  markdown:    '#94a3b8',
  unknown:     '#94a3b8',
};

// ── Language display name map ───────────────────────────────────────────────
const DISPLAY_NAMES = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python:     'Python',
  c_sharp:    'C#',
  go:         'Go',
  java:       'Java',
  rust:       'Rust',
  ruby:       'Ruby',
  kotlin:     'Kotlin',
  swift:      'Swift',
  php:        'PHP',
  shell:      'Shell',
  yaml:       'YAML',
  toml:       'TOML',
  sql:        'SQL',
  dockerfile: 'Dockerfile',
  xml:        'XML',
  css:        'CSS',
  html:       'HTML',
  markdown:   'Markdown',
  unknown:    'Unknown',
};

/** Returns a human-readable language name. */
export function formatLanguage(lang) {
  if (!lang) return 'Unknown';
  return DISPLAY_NAMES[lang.toLowerCase()] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

// ── Date formatter ──────────────────────────────────────────────────────────
/**
 * Formats an ISO date string into a readable relative / absolute label.
 * e.g. "2 hours ago", "3 days ago", "Jan 15, 2026"
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date  = new Date(dateStr);
  const now   = new Date();
  const diff  = Math.floor((now - date) / 1000);

  if (diff < 60)             return 'just now';
  if (diff < 3600)           return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)          return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7)      return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Syntax-highlighter language map ────────────────────────────────────────
/** Maps file extension → react-syntax-highlighter language identifier. */
export const SYNTAX_LANGUAGE_MAP = {
  js:         'javascript',
  jsx:        'javascript',
  ts:         'typescript',
  tsx:        'typescript',
  py:         'python',
  cs:         'csharp',
  go:         'go',
  java:       'java',
  rs:         'rust',
  rb:         'ruby',
  kt:         'kotlin',
  kts:        'kotlin',
  swift:      'swift',
  php:        'php',
  sh:         'bash',
  bash:       'bash',
  zsh:        'bash',
  yaml:       'yaml',
  yml:        'yaml',
  toml:       'toml',
  sql:        'sql',
  dockerfile: 'dockerfile',
  xml:        'xml',
  html:       'html',
  css:        'css',
  scss:       'scss',
  json:       'json',
  md:         'markdown',
  mdx:        'markdown',
};

/** Returns the syntax highlighter language for a given file path. */
export function getSyntaxLanguage(filePath) {
  if (!filePath) return 'text';
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return SYNTAX_LANGUAGE_MAP[ext] ?? 'text';
}
