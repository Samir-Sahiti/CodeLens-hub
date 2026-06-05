import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sections } from '../content/onboarding-guide.md';
import { fuzzyMatch } from '../utils/fuzzy';
import { mdComponents } from './SharedAnswerComponents';
import { Button, IconButton } from './ui/Primitives';
import { Search, X } from './ui/Icons';

const SEARCH_THRESHOLD = 0.2;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function OnboardingGuide({
  open,
  onClose,
  repoId,
  firstRepoId,
  deepLinkSlug,
}) {
  const [query, setQuery] = useState('');
  const panelRef = useRef(null);
  const navigate = useNavigate();
  const targetRepoId = repoId || firstRepoId;

  const filteredSections = useMemo(() => {
    const q = query.trim();
    if (!q) return sections;
    return sections.filter(section => (
      fuzzyMatch(q, `${section.title} ${section.body}`) >= SEARCH_THRESHOLD
    ));
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = [...(panelRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
        .filter(el => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const timer = setTimeout(() => {
      panelRef.current?.querySelector(FOCUSABLE_SELECTOR)?.focus();
    }, 30);
    return () => {
      clearTimeout(timer);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !deepLinkSlug) return undefined;
    const timer = setTimeout(() => {
      panelRef.current
        ?.querySelector(`#${CSS.escape(deepLinkSlug)}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 320);
    return () => clearTimeout(timer);
  }, [open, deepLinkSlug]);

  const handleTryIt = (section) => {
    if (targetRepoId) {
      navigate(`/repo/${targetRepoId}?tab=${section.tryItTab}`);
    } else {
      navigate('/dashboard?connect=1');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        aria-label="Close onboarding guide"
        tabIndex={-1}
      />

      <aside
        ref={panelRef}
        className={`${open ? 'guide-panel' : 'guide-panel-out'} fixed right-0 top-0 bottom-0 flex w-full flex-col border-l border-surface-800 bg-surface-950 shadow-panel md:w-[400px]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-guide-title"
      >
        <header className="shrink-0 border-b border-surface-800 bg-surface-900/95 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-surface-500">Guide</p>
              <h2 id="onboarding-guide-title" className="truncate text-lg font-semibold text-white">
                CodeLens Onboarding
              </h2>
            </div>
            <IconButton onClick={onClose} label="Close guide" icon={X} />
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-surface-800 bg-surface-950 px-3 py-2 focus-within:border-accent/70">
            <Search className="h-4 w-4 shrink-0 text-surface-500" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search the guide"
              className="w-full bg-transparent text-sm text-surface-100 placeholder:text-surface-600 focus:outline-none"
            />
          </label>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <div className="space-y-7">
            {filteredSections.map(section => (
              <section
                key={section.slug}
                id={section.slug}
                className="scroll-mt-5 border-b border-surface-800 pb-7 last:border-b-0"
              >
                <h3 className="text-base font-semibold text-white">{section.title}</h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-surface-800 bg-surface-900/70">
                  <div className="relative aspect-[16/9]">
                    <img
                      src={`/onboarding/${section.slug}.png`}
                      alt={`${section.title} screenshot`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {section.annotations?.map((annotation, index) => (
                      <span
                        key={`${annotation.label}-${index}`}
                        className="annotation-badge"
                        style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
                        title={annotation.label}
                      >
                        {index + 1}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                    {section.body}
                  </ReactMarkdown>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={() => handleTryIt(section)}
                >
                  {section.tryItLabel || 'Try it'} &rarr;
                </Button>
              </section>
            ))}

            {filteredSections.length === 0 && (
              <div className="rounded-lg border border-surface-800 bg-surface-900/60 p-6 text-center text-sm text-surface-400">
                No guide sections match that search.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
