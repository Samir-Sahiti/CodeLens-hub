/**
 * src/components/ui/Modal.jsx
 *
 * Shared animated modal wrapper.
 * Backdrop fades in, content scales up with spring easing.
 * Handles Escape key, click-outside-to-close, and focus trap.
 *
 * Props:
 *   isOpen    — boolean
 *   onClose   — () => void
 *   title     — string | ReactNode  (optional)
 *   children  — ReactNode
 *   maxWidth  — string tailwind class, default 'max-w-lg'
 */
import { useEffect, useId, useRef } from 'react';
import { X } from './Icons';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}) {
  const overlayRef = useRef(null);
  const contentRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const generatedTitleId = useId();
  const titleId = title ? `modal-title-${generatedTitleId}` : undefined;

  /* ── Keyboard: Escape to close ── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  /* ── Body scroll lock ── */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  /* ── Focus trap ── */
  useEffect(() => {
    if (!isOpen || !contentRef.current) return;
    previouslyFocusedRef.current = document.activeElement;
    const focusable = contentRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0] || contentRef.current;
    const last  = focusable[focusable.length - 1] || contentRef.current;

    const trap = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };

    document.addEventListener('keydown', trap);
    first?.focus();
    return () => {
      document.removeEventListener('keydown', trap);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ animation: 'fadeIn 180ms ease forwards' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose?.(); }}
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : 'Modal'}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" />

      {/* Content */}
      <div
        ref={contentRef}
        tabIndex={-1}
        className={`relative flex max-h-[calc(100vh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-panel`}
        style={{ animation: 'scaleIn 180ms ease forwards' }}
      >
        {/* Header */}
        {(title !== undefined) && (
          <div className="flex shrink-0 items-center justify-between border-b border-surface-800 px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold text-surface-50">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-lg p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-white"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Body */}
        {children}
      </div>
    </div>
  );
}
