import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * VirtualTable — lightweight virtual scrolling table.
 *
 * Only renders rows visible in the viewport plus a configurable buffer
 * (default 20 rows above and below). This keeps the DOM lean even when
 * the dataset has thousands of rows.
 *
 * Props:
 *   rows          — full sorted/filtered data array
 *   rowHeight     — fixed height per row in px (default 44)
 *   bufferRows    — extra rows to render above/below viewport (default 20)
 *   containerHeight — CSS height for the scrollable container (default '100%')
 *   renderHeader  — () => JSX for the sticky <thead>
 *   renderRow     — (row, index) => JSX for a single <tr>
 *   tableClassName — className forwarded to the <table>
 */
export default function VirtualTable({
  rows,
  rowHeight = 44,
  bufferRows = 20,
  containerHeight = '100%',
  renderHeader,
  renderRow,
  tableClassName = '',
}) {
  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerOffsetHeight, setContainerOffsetHeight] = useState(600);

  // Measure container height on mount and resize
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const measure = () => setContainerOffsetHeight(el.clientHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // rAF-throttled scroll handler — avoids layout thrashing
  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) {
        setScrollTop(scrollRef.current.scrollTop);
      }
      rafRef.current = null;
    });
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const totalHeight = rows.length * rowHeight;

  // Compute visible window
  const visibleCount = Math.ceil(containerOffsetHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
  const endIndex = Math.min(rows.length, Math.floor(scrollTop / rowHeight) + visibleCount + bufferRows);

  const visibleRows = rows.slice(startIndex, endIndex);

  const topPadding = startIndex * rowHeight;
  const bottomPadding = (rows.length - endIndex) * rowHeight;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: containerHeight }}>
      {/* Sticky header outside scroll area */}
      {renderHeader && (
        <table className={tableClassName}>
          {renderHeader()}
        </table>
      )}

      {/* Scrollable body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto"
      >
        <table className={tableClassName}>
          <tbody>
            {/* Top spacer */}
            {topPadding > 0 && (
              <tr aria-hidden="true">
                <td style={{ height: topPadding, padding: 0, border: 'none' }} />
              </tr>
            )}

            {visibleRows.map((row, i) => renderRow(row, startIndex + i))}

            {/* Bottom spacer */}
            {bottomPadding > 0 && (
              <tr aria-hidden="true">
                <td style={{ height: bottomPadding, padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
