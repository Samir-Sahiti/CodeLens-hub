import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from './ui/Icons';

const ToastContext = createContext(null);

// ── Type styles ──────────────────────────────────────────────────────────────
function typeConfig(type) {
  switch (type) {
    case 'success':
      return {
        border: 'border-emerald-500/25',
        bg:     'bg-emerald-500/10',
        text:   'text-emerald-100',
        bar:    'bg-emerald-500',
        icon:   <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />,
      };
    case 'warning':
      return {
        border: 'border-amber-500/25',
        bg:     'bg-amber-500/10',
        text:   'text-amber-100',
        bar:    'bg-amber-500',
        icon:   <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />,
      };
    case 'info':
      return {
        border: 'border-sky-500/25',
        bg:     'bg-sky-500/10',
        text:   'text-sky-100',
        bar:    'bg-sky-500',
        icon:   <Info className="h-4 w-4 text-sky-400 shrink-0" />,
      };
    case 'error':
    default:
      return {
        border: 'border-red-500/25',
        bg:     'bg-red-500/10',
        text:   'text-red-100',
        bar:    'bg-red-500',
        icon:   <XCircle className="h-4 w-4 text-red-400 shrink-0" />,
      };
  }
}

// ── ToastItem ────────────────────────────────────────────────────────────────
function ToastItem({ toast, closing, onClose }) {
  const cfg = typeConfig(toast.type);

  return (
    <div
      className={[
        'pointer-events-auto w-[22rem] max-w-[calc(100vw-2rem)]',
        'rounded-lg border shadow-panel backdrop-blur-md',
        cfg.border, cfg.bg, cfg.text,
        'overflow-hidden',
        'transition-all duration-200 ease-out',
        closing
          ? 'opacity-0 translate-x-4 scale-95'
          : 'opacity-100 translate-x-0 scale-100',
      ].join(' ')}
      style={{
        animation: closing ? undefined : 'slideRight 180ms ease forwards',
      }}
      role="status"
      aria-live="polite"
    >
      {/* Content row */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5">{cfg.icon}</div>
        <div className="flex-1 text-sm leading-relaxed">
          {toast.message}
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="ml-3 rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-white/85 transition hover:bg-white/10 hover:text-white"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-1 shrink-0 rounded-md p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress bar (auto-dismiss countdown) */}
      {toast.duration > 0 && (
        <div className="h-0.5 w-full bg-white/10 overflow-hidden">
          <div
            className={`h-full ${cfg.bar} opacity-60`}
            style={{
              animation: `toastProgress ${toast.duration}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── ToastProvider ────────────────────────────────────────────────────────────
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const closingRef = useRef(new Set());
  const timersRef  = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    closingRef.current.delete(id);
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const dismiss = useCallback((id) => {
    if (closingRef.current.has(id)) return;
    closingRef.current.add(id);
    setToasts(prev => [...prev]); // trigger re-render for closing animation
    setTimeout(() => removeToast(id), 280);
  }, [removeToast]);

  const push = useCallback((type, message, options = {}) => {
    const id       = options.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const duration = typeof options.duration === 'number' ? options.duration : 5000;
    const toast    = { id, type, message, duration, action: options.action };

    setToasts(prev => [toast, ...prev].slice(0, 5));

    if (duration > 0) {
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    push,
    dismiss,
    success: (message, options) => push('success', message, options),
    error:   (message, options) => push('error',   message, options),
    warning: (message, options) => push('warning', message, options),
    info:    (message, options) => push('info',    message, options),
  }), [dismiss, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2.5 sm:bottom-5 sm:right-5">
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            closing={closingRef.current.has(toast.id)}
            onClose={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
