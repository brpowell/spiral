/** Matches `.browse-grid` `minmax(160px, 1fr)` auto-fill. */
export const BROWSE_GRID_MIN_COL_PX = 160;

/** Fallback for `--browse-grid-text-block` (3.04rem at a 16px root). */
export const BROWSE_GRID_TEXT_BLOCK_FALLBACK_PX = 48.64;

/**
 * Stay on native CSS Grid until the collection is large enough that mounting
 * every album card (cover, motion, tilt) is the bottleneck.
 * ~8–10 rows at typical column counts; track lists wait until 40 cheaper rows.
 */
export const BROWSE_GRID_VIRTUALIZE_AFTER = 64;

/** Extra rows above/below the viewport. Each row is several image cards. */
export const BROWSE_GRID_OVERSCAN_ROWS = 2;

/**
 * CSS Grid `repeat(auto-fill, minmax(min, 1fr))` column count.
 * `availableWidth` is the grid content box (padding already subtracted).
 */
export function browseGridColumnCount(
  availableWidth: number,
  minColumnWidth: number,
  columnGap: number,
): number {
  if (availableWidth <= 0 || minColumnWidth <= 0) return 1;
  const denom = minColumnWidth + columnGap;
  if (denom <= 0) return 1;
  return Math.max(1, Math.floor((availableWidth + columnGap) / denom));
}

export function browseGridColumnWidth(
  availableWidth: number,
  columnCount: number,
  columnGap: number,
): number {
  if (columnCount <= 1) return availableWidth;
  return (availableWidth - columnGap * (columnCount - 1)) / columnCount;
}

export function browseGridRowCount(
  itemCount: number,
  columnCount: number,
): number {
  if (itemCount <= 0 || columnCount <= 0) return 0;
  return Math.ceil(itemCount / columnCount);
}

export function browseGridRowHeight(
  columnWidth: number,
  textBlockHeight: number,
): number {
  return Math.max(0, columnWidth) + Math.max(0, textBlockHeight);
}

/** Parse computed `grid-template-columns` into track count and first track px. */
export function parseGridTemplateTracks(gridTemplateColumns: string): {
  count: number;
  firstTrackPx: number | null;
} | null {
  const value = gridTemplateColumns.trim();
  if (!value || value === "none") return null;
  // Specified `repeat(auto-fill, …)` is not a used track list yet.
  if (/auto-fill|auto-fit/i.test(value)) return null;

  const repeat = /^repeat\(\s*(\d+)\s*,/i.exec(value);
  if (repeat) {
    const count = Number(repeat[1]);
    if (!Number.isFinite(count) || count < 1) return null;
    const afterComma = value.slice(repeat[0].length);
    const firstPx = parseFloat(afterComma);
    return {
      count,
      firstTrackPx: Number.isFinite(firstPx) ? firstPx : null,
    };
  }

  const tracks = value.split(/\s+/).filter(Boolean);
  if (tracks.length === 0) return null;
  const firstPx = parseFloat(tracks[0] ?? "");
  return {
    count: tracks.length,
    firstTrackPx: Number.isFinite(firstPx) ? firstPx : null,
  };
}
