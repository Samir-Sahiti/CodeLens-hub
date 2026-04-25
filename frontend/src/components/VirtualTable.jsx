import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * VirtualTable — lightweight virtual scrolling table.
 *
 * Only renders rows visible in the viewport plus a configurable buffer
 * (default 20 rows above and below). This keeps the DOM lean even when
 * the dataset has thousands of rows.
 *
 * Keyboard navigation:
 *   ArrowUp / ArrowDown  — move focused row
 *   Home / End           — jump to first / last row
 *   PageUp / PageDown    — jump by visible page
 *
 * Props:
 *   rows            — full sorted/filtered data array
 *   rowHeight       — fixed height per row in px (default 44)
 *   bufferRows      — extra rows to render above/below viewport (default 20)
 *   containerHeight — CSS height for the scrollable container (default '100%')
 *   renderHeader    — () => JSX for the sticky <thead>
 *   renderRow       — (row, index, isFocused) => JSX for a single <tr>
 *   tableClassName  — className forwarded to the <table>
 *   colGroup        — optional <colgroup> JSX
 *   onRowFocus      — (row, index) => called when focused row changes
 */
export default function VirtualTable({
  rows,
  rowHeight = 44,
  bufferRows = 20,
  containerHeight = '100%',
  renderHeader,
  renderRow,
  tableClassName = '',
  colGroup,
  onRowFocus,
}) {
  const scrollRef = useRef(null);
  const rafRef    = useRef(null);
  const [scrollTop, setScrollTop]                   = useState(0);
  const [containerOffsetHeight, setContainerOffsetHeight] = useState(600);
  const [focusedIndex, setFocusedIndex]             = useState(-1);

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
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
      rafRef.current = null;
    });
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Scroll focused row into view
  const scrollRowIntoView = useCallback((index) => {
    const el = scrollRef.current;
    if (!el) return;
    const rowTop    = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [rowHeight]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!rows.length) return;

    const visiblePage = Math.max(1, Math.floor(containerOffsetHeight / rowHeight));
    let next = focusedIndex;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        next = Math.min(rows.length - 1, focusedIndex < 0 ? 0 : focusedIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        next = Math.max(0, focusedIndex < 0 ? rows.length - 1 : focusedIndex - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        next = Math.min(rows.length - 1, (focusedIndex < 0 ? 0 : focusedIndex) + visiblePage);
        break;
      case 'PageUp':
        e.preventDefault();
        next = Math.max(0, (focusedIndex < 0 ? 0 : focusedIndex) - visiblePage);
        break;
      case 'Home':
        e.preventDefault();
        next = 0;
        break;
      case 'End':
        e.preventDefault();
        next = rows.length - 1;
        break;
      default:
        return;
    }

    setFocusedIndex(next);
    scrollRowIntoView(next);
    onRowFocus?.(rows[next], next);
  }, [rows, focusedIndex, containerOffsetHeight, rowHeight, scrollRowIntoView, onRowFocus]);

  const totalHeight  = rows.length * rowHeight;
  const visibleCount = Math.ceil(containerOffsetHeight / rowHeight);
  const startIndex   = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
  const endIndex     = Math.min(rows.length, Math.floor(scrollTop / rowHeight) + visibleCount + bufferRows);
  const visibleRows  = rows.slice(startIndex, endIndex);
  const topPadding   = startIndex * rowHeight;
  const bottomPadding = (rows.length - endIndex) * rowHeight;

  // Detect how many columns for spacer td colSpan
  const colCount = colGroup
    ? colGroup.props?.children?.length ?? 1
    : undefined;

  return (
    <div
      className="flex flex-col overflow-hidden outline-none"
      style={{ height: containerHeight }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="grid"
      aria-rowcount={rows.length}
      aria-label="Virtualized data table"
    >
      {/* Sticky header outside scroll area */}
      {renderHeader && (
        <table className={tableClassName}>
          {colGroup}
          {renderHeader()}
        </table>
      )}

      {/* Scrollable body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto"
        tabIndex={-1}
      >
        <table className={tableClassName}>
          {colGroup}
          <tbody>
            {/* Top spacer */}
            {topPadding > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={colCount}
                  style={{ height: topPadding, padding: 0, border: 'none' }}
                />
              </tr>
            )}

            {visibleRows.map((row, i) =>
              renderRow(row, startIndex + i, startIndex + i === focusedIndex)
            )}

            {/* Bottom spacer */}
            {bottomPadding > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={colCount}
                  style={{ height: bottomPadding, padding: 0, border: 'none' }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
