/**
 * src/components/ui/Tooltip.jsx
 *
 * Tiny hover tooltip positioned above/below the trigger.
 * Appears with 150ms delay and a fade-in.
 *
 * Props:
 *   content   — string | ReactNode  (tooltip text)
 *   children  — ReactNode           (trigger element)
 *   position  — 'top' | 'right' | 'bottom' | 'left'  (default 'right')
 *   delay     — number ms (default 150)
 *   className — extra classes on tooltip bubble
 */
import { cloneElement, isValidElement, useCallback, useId, useRef, useState } from 'react';

export default function Tooltip({
  content,
  children,
  position = 'right',
  delay = 150,
  className = '',
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const tooltipId = useId();

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  if (!content) return children;

  const positionClasses = {
    top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left:   'right-full top-1/2 -translate-y-1/2 mr-2',
    right:  'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': visible ? tooltipId : undefined,
      })
    : children;

  return (
    <div
      className="relative inline-flex min-w-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {trigger}

      {visible && (
        <div
          id={tooltipId}
          role="tooltip"
          className={[
            'absolute z-[200] max-w-[min(18rem,calc(100vw-2rem))] px-2.5 py-1.5',
            'rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur',
            'text-xs font-medium leading-relaxed text-gray-200 shadow-xl',
            'pointer-events-none',
            'animate-fade-in',
            'whitespace-normal break-words',
            positionClasses[position] ?? positionClasses.right,
            className,
          ].join(' ')}
        >
          {content}
          {/* Arrow */}
          {position === 'right' && (
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-700" />
          )}
          {position === 'left' && (
            <span className="absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-gray-700" />
          )}
          {position === 'top' && (
            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
          )}
          {position === 'bottom' && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-700" />
          )}
        </div>
      )}
    </div>
  );
}
