import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

function typeStyles(type) {
  switch (type) {
    case 'success':
      return {
        border: 'border-emerald-500/30',
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-100',
        icon: (
          <svg className="h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ),
      };
    case 'warning':
      return {
        border: 'border-amber-500/30',
        bg: 'bg-amber-500/10',
        text: 'text-amber-100',
        icon: (
          <svg className="h-4 w-4 text-amber-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3h.01M10.25 4.5h3.5c.54 0 1.04.29 1.3.76l6.2 11.17c.56 1.01-.17 2.32-1.32 2.32H4.07c-1.15 0-1.88-1.31-1.32-2.32l6.2-11.17c.26-.47.76-.76 1.3-.76z" />
          </svg>
        ),
      };
    case 'info':
      return {
        border: 'border-sky-500/30',
        bg: 'bg-sky-500/10',
        text: 'text-sky-100',
        icon: (
          <svg className="h-4 w-4 text-sky-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25h1.5v6h-1.5v-6zM12 8.25h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
      };
    case 'error':
    default:
      return {
        border: 'border-red-500/30',
        bg: 'bg-red-500/10',
        text: 'text-red-100',
        icon: (
          <svg className="h-4 w-4 text-red-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3h.01M10.25 4.5h3.5c.54 0 1.04.29 1.3.76l6.2 11.17c.56 1.01-.17 2.32-1.32 2.32H4.07c-1.15 0-1.88-1.31-1.32-2.32l6.2-11.17c.26-.47.76-.76 1.3-.76z" />
          </svg>
        ),
      };
  }
}

function ToastItem({ toast, closing, onClose }) {
  const styles = typeStyles(toast.type);

  return (
    <div
      className={[
        'pointer-events-auto w-[22rem] max-w-[calc(100vw-2rem)]',
        'rounded-xl border shadow-2xl shadow-black/40 backdrop-blur',
        styles.border,
        styles.bg,
        styles.text,
        'px-4 py-3',
        'transition-all duration-300 ease-out',
        closing ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0',
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{styles.icon}</div>
        <div className="flex-1 text-sm leading-relaxed">
          {toast.message}
        </div>
        <button
          onClick={onClose}
          className="ml-1 shrink-0 rounded-md p-1 text-white/70 hover:text-white hover:bg-white/10 transition"
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <span className="font-mono text-base leading-none">✕</span>
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const closingRef = useRef(new Set());
  const timersRef = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    closingRef.current.delete(id);
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback((id) => {
    if (closingRef.current.has(id)) return;
    closingRef.current.add(id);
    // Allow the fade/slide animation to play before removing.
    setTimeout(() => removeToast(id), 250);
  }, [removeToast]);

  const push = useCallback((type, message, options = {}) => {
    const id = options.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const duration = typeof options.duration === 'number' ? options.duration : 5000;

    const toast = { id, type, message, duration };
    setToasts((prev) => [toast, ...prev].slice(0, 5));

    if (duration > 0) {
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [dismiss]);

  const api = useMemo(() => {
    return {
      push,
      dismiss,
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      warning: (message, options) => push('warning', message, options),
      info: (message, options) => push('info', message, options),
    };
  }, [dismiss, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-3">
        {toasts.map((toast) => (
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

