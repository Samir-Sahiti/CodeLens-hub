import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { AnswerBlock, HighlightedCodeBlock, getLanguageClass } from './SharedAnswerComponents';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, FileCode, X } from './ui/Icons';
import { Banner, Button, IconButton, Skeleton } from './ui/Primitives';

const MAX_FALLBACK_LINES = 200;
const MISSING_FILE_MESSAGE = 'This file is no longer present in the latest index';

function normalizeSteps(tour) {
  return [...(tour?.steps || [])].sort((a, b) => {
    const aOrder = Number.isFinite(a?.step_order) ? a.step_order : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(b?.step_order) ? b.step_order : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

function isEditableTarget(target) {
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  return tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target.isContentEditable;
}

function formatLineRange(step) {
  const start = Number(step?.start_line);
  const end = Number(step?.end_line);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    return 'Lines unavailable';
  }
  return `L${start}-L${end}`;
}

function sliceCodeForStep(content, step) {
  const lines = String(content || '').split(/\r?\n/);
  const start = Number(step?.start_line);
  const end = Number(step?.end_line);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    const fallbackLines = lines.slice(0, MAX_FALLBACK_LINES);
    return {
      code: fallbackLines.join('\n'),
      isFallbackRange: true,
      isTruncated: lines.length > MAX_FALLBACK_LINES,
    };
  }

  const clampedStart = Math.max(1, Math.min(start, lines.length || 1));
  const clampedEnd = Math.max(clampedStart, Math.min(end, lines.length || clampedStart));
  return {
    code: lines.slice(clampedStart - 1, clampedEnd).join('\n'),
    isFallbackRange: false,
    isTruncated: false,
  };
}

export default function TourViewer({
  repoId,
  tour,
  open,
  stepIndex = 0,
  onStepChange,
  onClose,
  onFinish,
}) {
  const { session } = useAuth();
  const toast = useToast();
  const fileCacheRef = useRef(new Map());
  const [fileState, setFileState] = useState({ status: 'idle', content: '', language: null, error: null });

  const steps = useMemo(() => normalizeSteps(tour), [tour]);
  const totalSteps = steps.length;
  const safeStepIndex = totalSteps > 0 ? Math.min(Math.max(stepIndex, 0), totalSteps - 1) : 0;
  const step = steps[safeStepIndex] || null;
  const title = tour?.title || tour?.original_query || 'Code tour';
  const progressPct = totalSteps > 0 ? ((safeStepIndex + 1) / totalSteps) * 100 : 0;
  const isFirstStep = safeStepIndex === 0;
  const isLastStep = safeStepIndex >= totalSteps - 1;

  const slicedCode = useMemo(() => {
    if (fileState.status !== 'ready') {
      return { code: '', isFallbackRange: false, isTruncated: false };
    }
    return sliceCodeForStep(fileState.content, step);
  }, [fileState.content, fileState.status, step]);

  const language = fileState.language || getLanguageClass(step?.file_path);

  const goToStep = useCallback((nextIndex) => {
    if (!totalSteps) return;
    const clamped = Math.min(Math.max(nextIndex, 0), totalSteps - 1);
    onStepChange?.(clamped);
  }, [onStepChange, totalSteps]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) goToStep(safeStepIndex - 1);
  }, [goToStep, isFirstStep, safeStepIndex]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onFinish?.();
      return;
    }
    goToStep(safeStepIndex + 1);
  }, [goToStep, isLastStep, onFinish, safeStepIndex]);

  const handleSkip = useCallback(() => {
    if (isLastStep) {
      onFinish?.();
      return;
    }
    goToStep(safeStepIndex + 1);
  }, [goToStep, isLastStep, onFinish, safeStepIndex]);

  const handleCopyPath = useCallback(async () => {
    if (!step?.file_path) return;
    try {
      await navigator.clipboard.writeText(step.file_path);
      toast.success(`Copied ${step.file_path}`);
    } catch {
      toast.error('Failed to copy file path');
    }
  }, [step?.file_path, toast]);

  useEffect(() => {
    if (!open || !step?.file_path || !session?.access_token) return;

    const cached = fileCacheRef.current.get(step.file_path);
    if (cached) {
      setFileState({ status: 'ready', content: cached.content, language: cached.language, error: null });
      return;
    }

    let cancelled = false;
    setFileState({ status: 'loading', content: '', language: null, error: null });

    fetch(apiUrl(`/api/repos/${repoId}/file?path=${encodeURIComponent(step.file_path)}`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (res) => {
        if (res.status === 404) {
          return { missing: true };
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch file content');
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.missing) {
          setFileState({ status: 'missing', content: '', language: null, error: MISSING_FILE_MESSAGE });
          return;
        }
        const next = { content: data.content || '', language: data.language || null };
        fileCacheRef.current.set(step.file_path, next);
        setFileState({ status: 'ready', content: next.content, language: next.language, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFileState({ status: 'error', content: '', language: null, error: err.message || 'Failed to fetch file content' });
      });

    return () => {
      cancelled = true;
    };
  }, [open, repoId, session?.access_token, step?.file_path]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlePrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, onClose, open]);

  if (!open || !tour) return null;

  return (
    <aside
      data-testid="tour-viewer"
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[80vh] flex-col rounded-t-xl border border-surface-700 bg-surface-950 text-white shadow-2xl lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:max-h-none lg:w-full lg:max-w-2xl lg:rounded-none lg:rounded-l-xl lg:border-y-0 lg:border-r-0"
      style={{ animation: 'slideInFromRight 260ms cubic-bezier(0.34,1.56,0.64,1) forwards' }}
      aria-label="Tour viewer"
    >
      <div className="h-1 w-full bg-surface-800">
        <div
          className="h-full bg-accent transition-all duration-200"
          style={{ width: `${progressPct}%` }}
          role="progressbar"
          aria-label="Tour progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
        />
      </div>

      <header className="border-b border-surface-800 bg-surface-900/95 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Tour</p>
            <h2 className="mt-1 truncate text-base font-semibold text-surface-100">{title}</h2>
            <p className="mt-1 text-xs text-surface-500">
              Step {safeStepIndex + 1} of {totalSteps || 1}
            </p>
          </div>
          <IconButton label="Close tour" icon={X} onClick={onClose} variant="ghost" />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {!step ? (
          <Banner tone="warning" icon={AlertTriangle}>This tour has no steps.</Banner>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="min-w-0 space-y-4">
              <div className="rounded-lg border border-surface-800 bg-surface-900/60 p-3">
                <button
                  type="button"
                  onClick={handleCopyPath}
                  className="flex max-w-full items-center gap-2 text-left font-mono text-xs text-accent-soft transition hover:text-blue-200"
                  title="Copy file path"
                >
                  <FileCode className="h-4 w-4 shrink-0 text-surface-500" />
                  <span className="truncate">{step.file_path}</span>
                  <Copy className="h-3.5 w-3.5 shrink-0 text-surface-500" />
                </button>
                <p className="mt-2 text-xs text-surface-500">{formatLineRange(step)}</p>
              </div>

              <div className="rounded-lg border border-surface-800 bg-surface-900/35 p-4">
                <AnswerBlock text={step.explanation || 'No explanation was generated for this step.'} />
              </div>
            </section>

            <section className="min-w-0">
              {fileState.status === 'loading' && (
                <div className="space-y-3 rounded-lg border border-surface-800 bg-surface-900/35 p-4">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              )}

              {fileState.status === 'missing' && (
                <Banner tone="warning" icon={AlertTriangle} className="flex-col sm:flex-row sm:items-center sm:justify-between">
                  <span>{MISSING_FILE_MESSAGE}</span>
                  <Button onClick={handleSkip} variant="outline" size="sm">
                    Skip
                  </Button>
                </Banner>
              )}

              {fileState.status === 'error' && (
                <Banner tone="danger">{fileState.error}</Banner>
              )}

              {fileState.status === 'ready' && (
                <div className="space-y-2">
                  {slicedCode.isFallbackRange && (
                    <p className="text-xs text-surface-500">
                      Line range unavailable{slicedCode.isTruncated ? `; showing first ${MAX_FALLBACK_LINES} lines.` : '.'}
                    </p>
                  )}
                  <HighlightedCodeBlock
                    code={slicedCode.code || '// No code content available for this step.'}
                    language={language}
                    showCopy={false}
                    showLineNumbers
                    wrapLines
                    className="max-h-[28rem] overflow-auto lg:max-h-[calc(100vh-15rem)]"
                    customStyle={{
                      fontSize: '0.75rem',
                      minHeight: '12rem',
                    }}
                  />
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-surface-800 bg-surface-900/95 px-4 py-3 sm:px-5">
        <Button
          onClick={handlePrev}
          disabled={isFirstStep || !step}
          variant="outline"
          icon={ChevronLeft}
        >
          Prev
        </Button>
        <Button
          onClick={handleNext}
          disabled={!step}
          variant="primary"
          icon={isLastStep ? undefined : ChevronRight}
        >
          {isLastStep ? 'Finish' : 'Next'}
        </Button>
      </footer>
    </aside>
  );
}

export { MISSING_FILE_MESSAGE, sliceCodeForStep };
