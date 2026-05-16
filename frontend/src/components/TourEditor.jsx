import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { AlertTriangle, GripVertical, Plus, Trash2, Users, X } from './ui/Icons';
import { Banner, Button, IconButton, Input, Switch, Textarea } from './ui/Primitives';

const MIN_STEPS = 2;
const MIN_EXPLANATION = 10;
const AUTOCOMPLETE_LIMIT = 8;

function normalizeStep(step, index) {
  return {
    tempId:      step.id || step.tempId || `local-${index}-${Math.random().toString(36).slice(2, 8)}`,
    file_path:   step.file_path || '',
    start_line:  Number.isFinite(Number(step.start_line)) ? Number(step.start_line) : 1,
    end_line:    Number.isFinite(Number(step.end_line))   ? Number(step.end_line)   : 1,
    explanation: step.explanation || '',
  };
}

function validateForm({ title, steps, knownPaths }) {
  const errors = {};
  if (!title || title.trim().length === 0) {
    errors.title = 'Title is required';
  }
  if (steps.length < MIN_STEPS) {
    errors._form = `At least ${MIN_STEPS} steps are required`;
    return errors;
  }
  steps.forEach((step, idx) => {
    if (!step.file_path || step.file_path.trim().length === 0) {
      errors[`steps.${idx}.file_path`] = 'File path required';
    } else if (knownPaths && knownPaths.size > 0 && !knownPaths.has(step.file_path)) {
      errors[`steps.${idx}.file_path`] = 'File not in this repo';
    }
    if ((step.explanation || '').trim().length < MIN_EXPLANATION) {
      errors[`steps.${idx}.explanation`] = `Min ${MIN_EXPLANATION} characters`;
    }
    const start = Number(step.start_line);
    const end   = Number(step.end_line);
    if (!Number.isInteger(start) || start < 1) {
      errors[`steps.${idx}.start_line`] = 'Must be ≥ 1';
    }
    if (!Number.isInteger(end) || end < start) {
      errors[`steps.${idx}.end_line`] = 'Must be ≥ start';
    }
  });
  return errors;
}

function FilePathAutocomplete({ value, onChange, options, error, disabled }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = (value || '').toLowerCase().trim();
    if (!q) return options.slice(0, AUTOCOMPLETE_LIMIT);
    return options
      .filter((path) => path.toLowerCase().includes(q))
      .slice(0, AUTOCOMPLETE_LIMIT);
  }, [options, value]);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        disabled={disabled}
        placeholder="src/path/to/file.js"
        className={`h-9 w-full rounded-lg border bg-surface-950 px-3 font-mono text-xs text-surface-100 placeholder:text-surface-500 transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? 'border-red-500/70 focus:ring-red-500/15' : 'border-surface-700 focus:border-accent/70 focus:ring-accent/15'
        }`}
      />
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-surface-700 bg-surface-950 shadow-panel"
        >
          {matches.map((path) => (
            <li key={path}>
              <button
                type="button"
                className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs text-surface-200 transition hover:bg-surface-800"
                onMouseDown={(e) => { e.preventDefault(); onChange(path); setOpen(false); }}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepRow({
  step,
  index,
  total,
  errors,
  knownPaths,
  filePathOptions,
  onChange,
  onDelete,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget,
  disabled,
}) {
  const canDelete = total > MIN_STEPS;
  const update = (patch) => onChange(index, { ...step, ...patch });
  return (
    <div
      data-testid={`tour-step-row-${index}`}
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`rounded-lg border bg-surface-900/55 p-3 transition-colors ${
        isDragging ? 'opacity-40' : ''
      } ${isDropTarget ? 'border-accent' : 'border-surface-800'}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 cursor-grab text-surface-500 hover:text-surface-300 active:cursor-grabbing"
          aria-label={`Drag step ${index + 1}`}
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-surface-500">
              Step {index + 1}
            </span>
            <IconButton
              label={canDelete ? 'Delete step' : `At least ${MIN_STEPS} steps required`}
              icon={Trash2}
              variant="ghost"
              onClick={() => canDelete && onDelete(index)}
              disabled={!canDelete || disabled}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-[0.18em] text-surface-500">File path</label>
            <FilePathAutocomplete
              value={step.file_path}
              onChange={(value) => update({ file_path: value })}
              options={filePathOptions}
              error={errors[`steps.${index}.file_path`]}
              disabled={disabled}
            />
            {errors[`steps.${index}.file_path`] && (
              <p className="text-[11px] text-red-300">{errors[`steps.${index}.file_path`]}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-surface-500">Start line</label>
              <input
                type="number"
                min={1}
                value={step.start_line}
                onChange={(e) => update({ start_line: Number(e.target.value) })}
                disabled={disabled}
                className={`mt-1 h-9 w-full rounded-lg border bg-surface-950 px-3 text-sm text-surface-100 focus:outline-none focus:ring-2 ${
                  errors[`steps.${index}.start_line`]
                    ? 'border-red-500/70 focus:ring-red-500/15'
                    : 'border-surface-700 focus:border-accent/70 focus:ring-accent/15'
                }`}
              />
              {errors[`steps.${index}.start_line`] && (
                <p className="text-[11px] text-red-300">{errors[`steps.${index}.start_line`]}</p>
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-surface-500">End line</label>
              <input
                type="number"
                min={1}
                value={step.end_line}
                onChange={(e) => update({ end_line: Number(e.target.value) })}
                disabled={disabled}
                className={`mt-1 h-9 w-full rounded-lg border bg-surface-950 px-3 text-sm text-surface-100 focus:outline-none focus:ring-2 ${
                  errors[`steps.${index}.end_line`]
                    ? 'border-red-500/70 focus:ring-red-500/15'
                    : 'border-surface-700 focus:border-accent/70 focus:ring-accent/15'
                }`}
              />
              {errors[`steps.${index}.end_line`] && (
                <p className="text-[11px] text-red-300">{errors[`steps.${index}.end_line`]}</p>
              )}
            </div>
          </div>

          <div>
            <Textarea
              label="Explanation"
              value={step.explanation}
              onChange={(e) => update({ explanation: e.target.value })}
              rows={3}
              disabled={disabled}
              placeholder="What does the reader take away from this step?"
            />
            {errors[`steps.${index}.explanation`] && (
              <p className="text-[11px] text-red-300">{errors[`steps.${index}.explanation`]}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TourEditor({
  repoId,
  tour,
  open,
  graphNodes = [],
  repoHasTeam = false,
  onClose,
  onSaved,
}) {
  const { session } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isTeamShared, setIsTeamShared] = useState(false);
  const [steps, setSteps] = useState([]);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);

  const filePathOptions = useMemo(
    () => graphNodes.map((n) => n.file_path).filter(Boolean).sort(),
    [graphNodes]
  );
  const knownPaths = useMemo(() => new Set(filePathOptions), [filePathOptions]);

  // Hydrate from tour prop whenever it changes (also when reopened).
  const tourId = tour?.id;
  useEffect(() => {
    if (!open || !tour) return;
    setTitle(tour.title || '');
    setDescription(tour.description || '');
    setIsTeamShared(Boolean(tour.is_team_shared));
    setSteps((tour.steps || []).map(normalizeStep));
    setErrors({});
  }, [open, tour, tourId]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (event.key === 'Escape' && !isSaving) closeRef.current?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSaving, open]);

  const handleStepChange = useCallback((index, nextStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? nextStep : s)));
  }, []);

  const handleAddStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      normalizeStep({ file_path: '', start_line: 1, end_line: 1, explanation: '' }, prev.length),
    ]);
  }, []);

  const handleDeleteStep = useCallback((index) => {
    setSteps((prev) => (prev.length > MIN_STEPS ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const handleDragStart = useCallback((event, index) => {
    setDraggingIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDragOver = useCallback((event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  }, []);

  const handleDrop = useCallback((event, index) => {
    event.preventDefault();
    const fromIdx = Number(event.dataTransfer.getData('text/plain'));
    setDropTargetIndex(null);
    setDraggingIndex(null);
    if (!Number.isInteger(fromIdx) || fromIdx === index) return;
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(index, 0, moved);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  }, []);

  const handleSave = useCallback(async () => {
    const formErrors = validateForm({ title, steps, knownPaths });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }
    if (!session?.access_token) return;

    setIsSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/tours/${tour.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          // Always send `description` as a string (possibly empty) so the SQL
          // COALESCE doesn't mistake a cleared field for "leave unchanged".
          title:          title.trim(),
          description:    description.trim(),
          is_team_shared: isTeamShared,
          steps: steps.map((step, idx) => ({
            order:       idx,
            file_path:   step.file_path,
            start_line:  Number(step.start_line),
            end_line:    Number(step.end_line),
            explanation: step.explanation,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save tour');
      }
      const data = await res.json();
      const savedTour = { ...(data.tour || {}), steps: data.steps || [] };
      toast.success('Tour saved');
      onSaved?.(savedTour);
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Failed to save tour');
    } finally {
      setIsSaving(false);
    }
  }, [description, isTeamShared, knownPaths, onClose, onSaved, repoId, session?.access_token, steps, title, toast, tour?.id]);

  if (!open || !tour) return null;

  const shareToggleDisabled = !repoHasTeam && !isTeamShared;

  return (
    <aside
      data-testid="tour-editor"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-xl border border-surface-700 bg-surface-950 text-white shadow-2xl lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-full lg:max-h-none lg:w-full lg:max-w-2xl lg:rounded-none lg:rounded-l-xl lg:border-y-0 lg:border-r-0"
      aria-label="Edit tour"
    >
      <header className="flex items-start justify-between gap-3 border-b border-surface-800 bg-surface-900/95 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-surface-500">Edit tour</p>
          <h2 className="mt-1 truncate text-base font-semibold text-surface-100">{tour.title}</h2>
        </div>
        <IconButton label="Close editor" icon={X} onClick={onClose} variant="ghost" disabled={isSaving} />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
        <section className="space-y-3 rounded-lg border border-surface-800 bg-surface-900/45 p-4">
          <Input
            id="tour-edit-title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSaving}
            placeholder="A short, descriptive name"
          />
          {errors.title && <p className="text-[11px] text-red-300">{errors.title}</p>}
          <Textarea
            id="tour-edit-description"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            disabled={isSaving}
            placeholder="Optional — shown on the tour card"
          />

          {(repoHasTeam || isTeamShared) && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-surface-800 bg-surface-950/60 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Users className="h-4 w-4 shrink-0 text-accent-soft" />
                <div className="min-w-0">
                  <p className="text-sm text-surface-200">Share with team</p>
                  <p className="text-[11px] text-surface-500">Teammates can read and fork this tour.</p>
                </div>
              </div>
              <Switch
                checked={isTeamShared}
                onChange={setIsTeamShared}
                disabled={isSaving || shareToggleDisabled}
                label="Share with team"
              />
            </div>
          )}
        </section>

        {errors._form && <Banner tone="warning" icon={AlertTriangle}>{errors._form}</Banner>}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-surface-400">
              Steps ({steps.length})
            </h3>
            <Button variant="outline" size="sm" icon={Plus} onClick={handleAddStep} disabled={isSaving}>
              Add step
            </Button>
          </div>

          <div className="space-y-2">
            {steps.map((step, idx) => (
              <StepRow
                key={step.tempId}
                step={step}
                index={idx}
                total={steps.length}
                errors={errors}
                knownPaths={knownPaths}
                filePathOptions={filePathOptions}
                onChange={handleStepChange}
                onDelete={handleDeleteStep}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragging={draggingIndex === idx}
                isDropTarget={dropTargetIndex === idx && draggingIndex !== null && draggingIndex !== idx}
                disabled={isSaving}
              />
            ))}
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-surface-800 bg-surface-900/95 px-4 py-3 sm:px-5">
        <Button onClick={onClose} variant="outline" disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="primary" loading={isSaving} disabled={isSaving}>
          Save
        </Button>
      </footer>
    </aside>
  );
}

export { validateForm, MIN_STEPS, MIN_EXPLANATION };
