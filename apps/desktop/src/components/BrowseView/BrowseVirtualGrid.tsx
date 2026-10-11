import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  BROWSE_GRID_MIN_COL_PX,
  BROWSE_GRID_OVERSCAN_ROWS,
  BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX,
  BROWSE_GRID_VIRTUALIZE_AFTER,
  browseGridColumnCount,
  browseGridColumnWidth,
  browseGridRowCount,
  browseGridRowHeight,
  parseGridTemplateTracks,
} from "../../lib/browseGridLayout";

interface BrowseGridMetrics {
  columns: number;
  columnWidth: number;
  rowGap: number;
  textBlock: number;
  scrollMargin: number;
}

const FALLBACK_METRICS: BrowseGridMetrics = {
  columns: 1,
  columnWidth: BROWSE_GRID_MIN_COL_PX,
  rowGap: 24,
  textBlock: BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX,
  scrollMargin: 0,
};

function cssVarPx(
  style: CSSStyleDeclaration,
  varName: string,
  fallback: number,
): number {
  const raw = style.getPropertyValue(varName).trim();
  if (!raw) return fallback;
  if (raw.endsWith("rem")) {
    const rem = parseFloat(raw);
    const root = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    return Number.isFinite(rem) && Number.isFinite(root)
      ? rem * root
      : fallback;
  }
  const px = parseFloat(raw);
  return Number.isFinite(px) ? px : fallback;
}

function measureScrollMargin(
  gridEl: HTMLElement | null,
  scrollEl: HTMLElement | null,
): number {
  if (!gridEl || !scrollEl) return 0;
  const gridRect = gridEl.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  return gridRect.top - scrollRect.top + scrollEl.scrollTop;
}

function measureBrowseGrid(
  gridEl: HTMLElement,
): Omit<BrowseGridMetrics, "scrollMargin"> {
  const style = getComputedStyle(gridEl);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const columnGap = parseFloat(style.columnGap) || 0;
  const rowGap = parseFloat(style.rowGap) || 0;
  const available = Math.max(
    0,
    gridEl.clientWidth - paddingLeft - paddingRight,
  );
  const minCol = cssVarPx(
    style,
    "--browse-grid-min-col",
    BROWSE_GRID_MIN_COL_PX,
  );
  const textBlock = cssVarPx(
    style,
    "--browse-grid-text-block",
    BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX,
  );

  const parsed = parseGridTemplateTracks(style.gridTemplateColumns);
  if (parsed && parsed.count > 0) {
    return {
      columns: parsed.count,
      columnWidth:
        parsed.firstTrackPx ??
        browseGridColumnWidth(available, parsed.count, columnGap),
      rowGap,
      textBlock,
    };
  }

  const columns = browseGridColumnCount(available, minCol, columnGap);
  return {
    columns,
    columnWidth: browseGridColumnWidth(available, columns, columnGap),
    rowGap,
    textBlock,
  };
}

interface BrowseVirtualGridProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  scrollRef: RefObject<HTMLElement | null>;
}

export function BrowseVirtualGrid<T>({
  items,
  getItemKey,
  renderItem,
  scrollRef,
}: BrowseVirtualGridProps<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const useVirtual = items.length > BROWSE_GRID_VIRTUALIZE_AFTER;
  const [metrics, setMetrics] = useState<BrowseGridMetrics>(FALLBACK_METRICS);

  useLayoutEffect(() => {
    if (!useVirtual) return;

    const update = () => {
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const next = {
        ...measureBrowseGrid(gridEl),
        scrollMargin: measureScrollMargin(gridEl, scrollRef.current),
      };
      setMetrics((prev) =>
        prev.columns === next.columns &&
        prev.columnWidth === next.columnWidth &&
        prev.rowGap === next.rowGap &&
        prev.textBlock === next.textBlock &&
        prev.scrollMargin === next.scrollMargin
          ? prev
          : next,
      );
    };

    update();

    const observer = new ResizeObserver(update);
    if (gridRef.current) observer.observe(gridRef.current);
    const scrollEl = scrollRef.current;
    if (scrollEl) observer.observe(scrollEl);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [useVirtual, scrollRef]);

  const rowCount = browseGridRowCount(items.length, metrics.columns);
  const rowHeight = browseGridRowHeight(metrics.columnWidth, metrics.textBlock);

  const getScrollElement = useCallback(() => scrollRef.current, [scrollRef]);

  const virtualizer = useVirtualizer({
    enabled: useVirtual,
    count: useVirtual ? rowCount : 0,
    getScrollElement,
    estimateSize: () => rowHeight,
    gap: metrics.rowGap,
    overscan: BROWSE_GRID_OVERSCAN_ROWS,
    scrollMargin: metrics.scrollMargin,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  useLayoutEffect(() => {
    if (!useVirtual) return;
    virtualizerRef.current.measure();
  }, [useVirtual, metrics.columns, rowHeight, metrics.rowGap]);

  if (!useVirtual) {
    return (
      <div className="browse-grid" role="list">
        {items.map((item, index) => (
          <Fragment key={getItemKey(item, index)}>
            {renderItem(item, index)}
          </Fragment>
        ))}
      </div>
    );
  }

  const virtualRows = virtualizer.getVirtualItems();
  const columns = metrics.columns;

  return (
    <div
      ref={gridRef}
      className="browse-grid browse-grid--virtual"
      role="list"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualRows.map((virtualRow) => {
        const start = virtualRow.index * columns;
        const end = Math.min(start + columns, items.length);
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="browse-grid__row"
            style={{
              transform: `translate3d(0, ${virtualRow.start - virtualizer.options.scrollMargin}px, 0)`,
            }}
          >
            {items.slice(start, end).map((item, offset) => {
              const index = start + offset;
              return (
                <Fragment key={getItemKey(item, index)}>
                  {renderItem(item, index)}
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
