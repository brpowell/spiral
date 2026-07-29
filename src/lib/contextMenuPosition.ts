const VIEWPORT_PADDING = 8;

export interface FitContextMenuPositionOptions {
  /** When flipping upward, align the menu bottom to this Y (e.g. submenu trigger bottom). */
  flipUpAlignBottomY?: number;
  /**
   * Horizontal align relative to `anchorX`.
   * - `start` (default): menu left edge at X (Radix/shadcn `align="start"`)
   * - `end`: menu right edge at X (Radix/shadcn `align="end"`)
   */
  align?: "start" | "end";
}

/** Keep a fixed context menu fully visible inside the viewport. */
export function fitContextMenuPosition(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  options: FitContextMenuPositionOptions = {},
): { left: number; top: number } {
  const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - height - VIEWPORT_PADDING;

  let left = options.align === "end" ? anchorX - width : anchorX;
  let top = anchorY;

  if (options.align !== "end" && left + width > window.innerWidth - VIEWPORT_PADDING) {
    left = anchorX - width;
  }
  if (top + height > window.innerHeight - VIEWPORT_PADDING) {
    const flipAnchorY = options.flipUpAlignBottomY ?? anchorY;
    top = flipAnchorY - height;
  }

  left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  top = Math.max(VIEWPORT_PADDING, Math.min(top, maxTop));

  return { left, top };
}
