import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';

// Same colours as DependencyGraph.jsx
const LANGUAGE_COLORS = {
  javascript: '#60a5fa',
  typescript: '#60a5fa',
  python:     '#facc15',
  c_sharp:    '#a78bfa',
  unknown:    '#94a3b8',
};

// graph_nodes.language → SyntaxHighlighter language name
const SYNTAX_LANG = {
  javascript: 'javascript',
  typescript: 'typescript',
  python:     'python',
  c_sharp:    'csharp',
};

function getBasename(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function buildTree(nodes) {
  const root = { dirs: {}, files: [] };
  for (const node of nodes) {
    const parts = node.file_path.replace(/\\/g, '/').split('/');
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cursor.dirs[parts[i]]) {
        cursor.dirs[parts[i]] = { dirs: {}, files: [] };
      }
      cursor = cursor.dirs[parts[i]];
    }
    cursor.files.push(node);
  }
  return root;
}

function TreeNode({ name, subtree, depth, selectedPath, onSelect, expandedDirs, toggleDir, pathPrefix }) {
  const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;
  const isExpanded = expandedDirs.has(fullPath);
  const hasDirs  = Object.keys(subtree.dirs).length > 0;
  const hasFiles = subtree.files.length > 0;

  return (
    <div>
      {/* Directory row */}
      <button
        onClick={() => toggleDir(fullPath)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="shrink-0 text-gray-600 font-mono">{isExpanded ? '▾' : '▸'}</span>
        <span className="truncate">{name}</span>
      </button>

      {isExpanded && (
        <div>
          {/* Subdirectories */}
          {Object.entries(subtree.dirs)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([dirName, dirSubtree]) => (
              <TreeNode
                key={dirName}
                name={dirName}
                subtree={dirSubtree}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                pathPrefix={fullPath}
              />
            ))}

          {/* Files */}
          {subtree.files
            .sort((a, b) => a.file_path.localeCompare(b.file_path))
            .map((node) => {
              const isActive = node.file_path === selectedPath;
              const color = LANGUAGE_COLORS[node.language] || LANGUAGE_COLORS.unknown;
              return (
                <button
                  key={node.file_path}
                  onClick={() => onSelect(node.file_path)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-200'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                  title={node.file_path}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{getBasename(node.file_path)}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function RootFiles({ files, selectedPath, onSelect, depth = 0 }) {
  return (
    <>
      {files
        .sort((a, b) => a.file_path.localeCompare(b.file_path))
        .map((node) => {
          const isActive = node.file_path === selectedPath;
          const color = LANGUAGE_COLORS[node.language] || LANGUAGE_COLORS.unknown;
          return (
            <button
              key={node.file_path}
              onClick={() => onSelect(node.file_path)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                isActive
                  ? 'bg-indigo-500/20 text-indigo-200'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
              }`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              title={node.file_path}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="truncate">{getBasename(node.file_path)}</span>
            </button>
          );
        })}
    </>
  );
}

export default function FileBrowser({ repoId, nodes }) {
  const { session } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedPath, setSelectedPath] = useState(null);
  const [content, setContent]           = useState(null);
  const [language, setLanguage]         = useState(null);
  const [isFetching, setIsFetching]     = useState(false);
  const [fetchError, setFetchError]     = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Auto-expand top-level directories on first load
  useEffect(() => {
    const topDirs = Object.keys(tree.dirs);
    if (topDirs.length > 0) {
      setExpandedDirs(new Set(topDirs));
    }
  }, [tree]);

  const toggleDir = useCallback((path) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Auto-open file from ?file= URL param (set by Issues tab "Open in Files")
  const fileParam = searchParams.get('file');
  useEffect(() => {
    if (!fileParam || !nodes.length || !session?.access_token) return;
    const matchingNode = nodes.find((n) => n.file_path === fileParam);
    if (!matchingNode) return;

    // Expand all ancestor directories of the target file
    const parts = fileParam.replace(/\\/g, '/').split('/');
    const ancestorPaths = [];
    for (let i = 1; i < parts.length; i++) {
      ancestorPaths.push(parts.slice(0, i).join('/'));
    }
    setExpandedDirs((prev) => new Set([...prev, ...ancestorPaths]));
    setSelectedPath(fileParam);

    // Clear the param so navigating away and back doesn't re-trigger
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      return next;
    }, { replace: true });
  // fetchFile is defined after this effect; call it imperatively via ref below
  }, [fileParam, nodes, session?.access_token, setSearchParams]);

  const fetchFile = useCallback(async (filePath) => {
    if (!session?.access_token) return;
    setIsFetching(true);
    setFetchError(null);
    setContent(null);
    setLanguage(null);

    try {
      const res = await fetch(
        apiUrl(`/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`),
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );

      if (res.status === 404) {
        const data = await res.json();
        setFetchError(data.error || 'No indexed content for this file');
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch file content');

      const data = await res.json();
      setContent(data.content);
      setLanguage(data.language);
    } catch (err) {
      console.error('[FileBrowser]', err);
      setFetchError(err.message);
    } finally {
      setIsFetching(false);
    }
  }, [repoId, session?.access_token]);

  // Fetch content whenever selectedPath changes (handles both manual clicks and URL-param auto-open)
  useEffect(() => {
    if (selectedPath) fetchFile(selectedPath);
  // fetchFile identity is stable (useCallback with stable deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const handleSelect = useCallback((filePath) => {
    setSelectedPath(filePath);
  }, []);

  const handleLineCopy = useCallback(async (lineNum) => {
    if (!selectedPath) return;
    const text = `${selectedPath}:${lineNum}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${getBasename(selectedPath)}:${lineNum}`);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }, [selectedPath, toast]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[calc(100vh-12rem)] min-h-[30rem] items-center justify-center rounded-xl border border-dashed border-gray-800 bg-gray-900/30">
        <p className="text-sm text-gray-500">No files indexed yet. Re-index the repository first.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[30rem] gap-4">
      {/* File tree — left panel */}
      <div className="w-64 shrink-0 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/30 py-2">
        {/* Root-level files */}
        <RootFiles files={tree.files} selectedPath={selectedPath} onSelect={handleSelect} />

        {/* Directories */}
        {Object.entries(tree.dirs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dirName, subtree]) => (
            <TreeNode
              key={dirName}
              name={dirName}
              subtree={subtree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              pathPrefix=""
            />
          ))}
      </div>

      {/* Code viewer — right panel */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
        {!selectedPath && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-gray-500">Select a file from the tree to view its source code.</p>
          </div>
        )}

        {selectedPath && isFetching && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {selectedPath && !isFetching && fetchError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            {fetchError === 'No indexed content for this file' ? (
              <>
                <svg className="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm font-medium text-gray-400">No indexed content for this file</p>
                <p className="text-xs text-gray-600">{selectedPath}</p>
                <p className="text-xs text-gray-600">This file's language may not be supported for indexing.</p>
              </>
            ) : (
              <p className="text-sm text-red-400">{fetchError}</p>
            )}
          </div>
        )}

        {selectedPath && !isFetching && !fetchError && content !== null && (
          <>
            {/* File header */}
            <div className="flex items-center border-b border-gray-800 bg-gray-900/60 px-4 py-2.5">
              <span
                className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: LANGUAGE_COLORS[language] || LANGUAGE_COLORS.unknown }}
              />
              <span className="font-mono text-xs text-gray-300 truncate">{selectedPath}</span>
            </div>

            {/* Syntax-highlighted source */}
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={SYNTAX_LANG[language] || 'text'}
                style={vscDarkPlus}
                showLineNumbers
                wrapLines
                lineProps={(lineNum) => ({
                  style: { cursor: 'pointer', display: 'block' },
                  onClick: () => handleLineCopy(lineNum),
                  title: `Click to copy ${getBasename(selectedPath)}:${lineNum}`,
                })}
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  background: 'transparent',
                  fontSize: '0.8125rem',
                  lineHeight: '1.6',
                }}
                lineNumberStyle={{
                  minWidth: '3em',
                  paddingRight: '1em',
                  color: '#4b5563',
                  userSelect: 'none',
                }}
              >
                {content}
              </SyntaxHighlighter>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
