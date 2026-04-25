import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { LANGUAGE_COLORS, getSyntaxLanguage } from '../lib/constants';
import { ChevronRight, FileCode, FileX, Folder } from './ui/Icons';
import { EmptyState, Panel, SearchInput } from './ui/Primitives';

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
      if (!cursor.dirs[parts[i]]) cursor.dirs[parts[i]] = { dirs: {}, files: [] };
      cursor = cursor.dirs[parts[i]];
    }
    cursor.files.push(node);
  }
  return root;
}

function TreeNode({ name, subtree, depth, selectedPath, onSelect, expandedDirs, toggleDir, pathPrefix, filterText }) {
  const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;
  const isExpanded = expandedDirs.has(fullPath);

  // When filter active, show subtree if any child matches
  const hasMatchingChild = filterText
    ? subtree.files.some(n => getBasename(n.file_path).toLowerCase().includes(filterText.toLowerCase()))
    : true;

  if (filterText && !hasMatchingChild) return null;

  return (
    <div>
      <button
        onClick={() => toggleDir(fullPath)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-gray-600 transition-transform ${isExpanded || filterText ? 'rotate-90' : ''}`} />
        <Folder className="h-3.5 w-3.5 shrink-0 text-surface-500" />
        <span className="truncate">{name}</span>
      </button>

      {(isExpanded || filterText) && (
        <div>
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
                filterText={filterText}
              />
            ))}
          {subtree.files
            .filter(node => !filterText || getBasename(node.file_path).toLowerCase().includes(filterText.toLowerCase()))
            .sort((a, b) => a.file_path.localeCompare(b.file_path))
            .map(node => {
              const isActive = node.file_path === selectedPath;
              const color = LANGUAGE_COLORS[node.language] ?? LANGUAGE_COLORS.unknown;
              return (
                <button
                  key={node.file_path}
                  onClick={() => onSelect(node.file_path)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    isActive ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
                  }`}
                  style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
                  title={node.file_path}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate">{getBasename(node.file_path)}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function RootFiles({ files, selectedPath, onSelect, filterText }) {
  return (
    <>
      {files
        .filter(node => !filterText || getBasename(node.file_path).toLowerCase().includes(filterText.toLowerCase()))
        .sort((a, b) => a.file_path.localeCompare(b.file_path))
        .map(node => {
          const isActive = node.file_path === selectedPath;
          const color = LANGUAGE_COLORS[node.language] ?? LANGUAGE_COLORS.unknown;
          return (
            <button
              key={node.file_path}
              onClick={() => onSelect(node.file_path)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                isActive ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-300 hover:bg-gray-800 hover:text-gray-100'
              }`}
              style={{ paddingLeft: '8px' }}
              title={node.file_path}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
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
  const [content,      setContent]      = useState(null);
  const [language,     setLanguage]     = useState(null);
  const [isFetching,   setIsFetching]   = useState(false);
  const [fetchError,   setFetchError]   = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [filterText,   setFilterText]   = useState('');

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Auto-expand top-level directories on first load
  useEffect(() => {
    const topDirs = Object.keys(tree.dirs);
    if (topDirs.length > 0) setExpandedDirs(new Set(topDirs));
  }, [tree]);

  const toggleDir = useCallback((path) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Auto-open file from ?file= URL param
  const fileParam = searchParams.get('file');
  useEffect(() => {
    if (!fileParam || !nodes.length || !session?.access_token) return;
    const matchingNode = nodes.find(n => n.file_path === fileParam);
    if (!matchingNode) return;

    const parts = fileParam.replace(/\\/g, '/').split('/');
    const ancestorPaths = [];
    for (let i = 1; i < parts.length; i++) ancestorPaths.push(parts.slice(0, i).join('/'));
    setExpandedDirs(prev => new Set([...prev, ...ancestorPaths]));
    setSelectedPath(fileParam);

    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete('file');
      return next;
    }, { replace: true });
  }, [fileParam, nodes, session?.access_token, setSearchParams]);

  const fetchFile = useCallback(async (filePath) => {
    if (!session?.access_token) return;
    setIsFetching(true); setFetchError(null); setContent(null); setLanguage(null);

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
      setFetchError(err.message);
    } finally {
      setIsFetching(false);
    }
  }, [repoId, session?.access_token]);

  useEffect(() => {
    if (selectedPath) fetchFile(selectedPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const handleSelect = useCallback((filePath) => setSelectedPath(filePath), []);

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
      <div className="flex h-auto min-h-[30rem] items-center justify-center rounded-xl border border-dashed border-gray-800 bg-gray-900/30 xl:h-[calc(100vh-12rem)]">
        <EmptyState icon={FileCode} title="No files indexed" description="Re-index this repository after parsing finishes to inspect source content." />
      </div>
    );
  }

  return (
    <div className="flex h-auto min-h-[30rem] flex-col gap-4 xl:h-[calc(100vh-12rem)] xl:flex-row">
      {/* File tree — left panel */}
      <Panel padded={false} className="max-h-72 w-full shrink-0 overflow-hidden xl:max-h-none xl:w-64">
        {/* Fuzzy search */}
        <div className="px-2 py-2 border-b border-gray-800">
          <SearchInput
            placeholder="Search files"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            inputClassName="h-8 text-xs"
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-2">
          <RootFiles files={tree.files} selectedPath={selectedPath} onSelect={handleSelect} filterText={filterText} />
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
                filterText={filterText}
              />
            ))}
        </div>
      </Panel>

      {/* Code viewer — right panel */}
      <Panel padded={false} className="flex min-h-[28rem] flex-1 flex-col overflow-hidden">
        {!selectedPath && (
          <div className="flex flex-1 items-center justify-center">
            <p className="px-6 text-center text-sm text-gray-500">Select a file from the tree to view its source code.</p>
          </div>
        )}

        {selectedPath && isFetching && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {selectedPath && !isFetching && fetchError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center sm:p-8">
            {fetchError === 'No indexed content for this file' ? (
              <>
                <FileX className="h-10 w-10 text-gray-600" />
                <p className="text-sm font-medium text-gray-400">No indexed content for this file</p>
                <p className="text-xs text-gray-600">{selectedPath}</p>
                <p className="text-xs text-gray-600">This file&apos;s language may not be supported for indexing.</p>
              </>
            ) : (
              <p className="text-sm text-red-400">{fetchError}</p>
            )}
          </div>
        )}

        {selectedPath && !isFetching && !fetchError && content !== null && (
          <div style={{ animation: 'slideUp 200ms ease both' }} className="flex flex-col flex-1 overflow-hidden">
            {/* File header */}
            <div className="flex min-w-0 items-center border-b border-gray-800 bg-gray-900/60 px-4 py-2.5">
              <span
                className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: LANGUAGE_COLORS[language] ?? LANGUAGE_COLORS.unknown }}
              />
              <span className="font-mono text-xs text-gray-300 truncate">{selectedPath}</span>
            </div>

            {/* Syntax-highlighted source */}
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={getSyntaxLanguage(selectedPath)}
                style={vscDarkPlus}
                showLineNumbers
                wrapLines
                lineProps={lineNum => ({
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
                  color: '#6b7280',  // brighter than original #4b5563
                  userSelect: 'none',
                }}
              >
                {content}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
