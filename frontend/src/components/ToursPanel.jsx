import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/constants';
import { useToast } from './Toast';
import Modal from './ui/Modal';
import { AlertTriangle, MoreVertical, Search, Star, Trash2 } from './ui/Icons';
import { Banner, Button, EmptyState, IconButton, Input, Skeleton } from './ui/Primitives';

const PAGE_SIZE = 30;
const EMPTY_TEXT = 'Tours turn questions about this repo into guided walkthroughs';

function isStartHereTour(tour) {
  return tour?.is_auto_generated === true && tour?.title === 'Start Here';
}

function makeTourWithSteps(response) {
  if (!response) return null;
  if (response.tour) {
    return { ...response.tour, steps: response.steps || response.tour.steps || [] };
  }
  return response;
}

function getDisplayText(tour) {
  return tour.description || tour.original_query || '';
}

function getInitial(name = '') {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

function groupTours(tours, userId) {
  const featuredTour = tours.find(isStartHereTour) || null;
  return {
    featured: featuredTour ? [featuredTour] : [],
    mine: tours.filter((tour) => tour.created_by === userId && tour.id !== featuredTour?.id),
    team: tours.filter((tour) => tour.is_team_shared === true && tour.created_by !== userId),
  };
}

function TourGroup({ title, icon: Icon, tours, onStartTour, onRequestDelete, page, onPageChange }) {
  if (!tours.length) return null;

  const needsPagination = tours.length > PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(tours.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const visibleTours = needsPagination
    ? tours.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : tours;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-accent-soft" />}
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-surface-400">{title}</h3>
        <span className="text-xs text-surface-600">({tours.length})</span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {visibleTours.map((tour) => (
          <TourCard
            key={tour.id}
            tour={tour}
            onStartTour={onStartTour}
            onRequestDelete={onRequestDelete}
          />
        ))}
      </div>
      {needsPagination && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-surface-500">Page {safePage + 1} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={safePage >= totalPages - 1}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

function CreatorAvatar({ creator }) {
  const name = creator?.name || 'Unknown user';
  if (creator?.avatar_url) {
    return (
      <img
        src={creator.avatar_url}
        alt={`${name} avatar`}
        className="h-7 w-7 rounded-full object-cover ring-1 ring-surface-700"
      />
    );
  }
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-800 text-xs font-bold text-surface-300 ring-1 ring-surface-700">
      {getInitial(name)}
    </div>
  );
}

function TourCard({ tour, onStartTour, onRequestDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const creator = tour.creator || {};

  return (
    <article className="relative rounded-lg border border-surface-800 bg-surface-900/55 p-4 shadow-panel">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-surface-100">{tour.title}</h4>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-surface-400">
            {getDisplayText(tour)}
          </p>
        </div>
        {tour.can_delete && (
          <div className="relative shrink-0">
            <IconButton
              label="Tour actions"
              icon={MoreVertical}
              variant="ghost"
              onClick={() => setMenuOpen((value) => !value)}
            />
            {menuOpen && (
              <div className="absolute right-0 top-9 z-10 min-w-32 rounded-lg border border-surface-700 bg-surface-950 p-1 shadow-panel">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-red-200 transition hover:bg-red-500/10"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestDelete(tour);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-surface-500">
        <span>{tour.step_count || tour.steps?.length || 0} steps</span>
        <span>Updated {formatDate(tour.updated_at)}</span>
        <div className="flex min-w-0 items-center gap-2">
          <CreatorAvatar creator={creator} />
          <span className="truncate text-surface-400">{creator.name || 'Unknown user'}</span>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={() => onStartTour(tour)} variant="primary" size="sm">
          Start tour
        </Button>
      </div>
    </article>
  );
}

export default function ToursPanel({ repoId, onStartTour }) {
  const { user, session } = useAuth();
  const toast = useToast();
  const composerRef = useRef(null);
  const [tours, setTours] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pages, setPages] = useState({ featured: 0, mine: 0, team: 0 });

  const fetchTours = useCallback(async () => {
    if (!session?.access_token || !repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/tours`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch tours');
      }
      const data = await res.json();
      setTours(data.tours || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch tours');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, session?.access_token]);

  useEffect(() => {
    fetchTours();
  }, [fetchTours]);

  const groups = useMemo(() => groupTours(tours, user?.id), [tours, user?.id]);
  const hasTours = tours.length > 0;

  useEffect(() => {
    if (!isLoading && !hasTours) {
      composerRef.current?.focus();
    }
  }, [hasTours, isLoading]);

  const handleStartTour = useCallback((tour) => {
    onStartTour?.({ ...tour, steps: tour.steps || [] });
  }, [onStartTour]);

  const handleGenerate = useCallback(async (event) => {
    event.preventDefault();
    if (!query.trim() || isGenerating || !session?.access_token) return;

    setIsGenerating(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/tours/generate`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query: query.trim(), save: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate tour');
      }
      const data = await res.json();
      const generatedTour = makeTourWithSteps(data);
      setQuery('');
      await fetchTours();
      if (generatedTour) {
        handleStartTour(generatedTour);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to generate tour');
    } finally {
      setIsGenerating(false);
    }
  }, [fetchTours, handleStartTour, isGenerating, query, repoId, session?.access_token, toast]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || !session?.access_token) return;
    setIsDeleting(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/tours/${deleteTarget.id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete tour');
      }
      setTours((current) => current.filter((tour) => tour.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message || 'Failed to delete tour');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, repoId, session?.access_token, toast]);

  return (
    <div className="flex h-auto min-h-[30rem] flex-col gap-5 xl:h-[calc(100vh-12rem)]">
      <form onSubmit={handleGenerate} className="rounded-lg border border-surface-800 bg-surface-900/55 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Input
            ref={composerRef}
            id="tour-question"
            icon={Search}
            label="Ask a question to generate a new tour"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="How does authentication work?"
            className="min-w-0 flex-1"
            disabled={isGenerating}
          />
          <Button type="submit" variant="primary" loading={isGenerating} disabled={!query.trim() || isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate tour'}
          </Button>
        </div>
      </form>

      {error && <Banner tone="danger">{error}</Banner>}

      {isLoading ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="rounded-lg border border-surface-800 bg-surface-900/45 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
              <Skeleton className="mt-5 h-8 w-24" />
            </div>
          ))}
        </div>
      ) : !hasTours ? (
        <EmptyState
          icon={Star}
          title={EMPTY_TEXT}
          description={null}
          className="flex-1"
        />
      ) : (
        <div className="space-y-7 overflow-y-auto pr-1">
          <TourGroup
            title="Featured"
            icon={Star}
            tours={groups.featured}
            onStartTour={handleStartTour}
            onRequestDelete={setDeleteTarget}
            page={pages.featured}
            onPageChange={(page) => setPages((current) => ({ ...current, featured: page }))}
          />
          <TourGroup
            title="My tours"
            tours={groups.mine}
            onStartTour={handleStartTour}
            onRequestDelete={setDeleteTarget}
            page={pages.mine}
            onPageChange={(page) => setPages((current) => ({ ...current, mine: page }))}
          />
          <TourGroup
            title="Team tours"
            tours={groups.team}
            onStartTour={handleStartTour}
            onRequestDelete={setDeleteTarget}
            page={pages.team}
            onPageChange={(page) => setPages((current) => ({ ...current, team: page }))}
          />
        </div>
      )}

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => !isDeleting && setDeleteTarget(null)}
        title="Delete tour?"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 p-5">
          <Banner tone="warning" icon={AlertTriangle}>
            This deletes the tour and its steps.
          </Banner>
          <p className="text-sm text-surface-300">
            Delete <span className="font-semibold text-surface-100">{deleteTarget?.title}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} loading={isDeleting}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export { EMPTY_TEXT, groupTours, isStartHereTour };
