const VIEWPORT_PADDING = 8;

export interface FitContextMenuPositionOptions {
  /** When flipping upward, align the menu bottom to this Y (e.g. submenu trigger bottom). */
  flipUpAlignBottomY?: number;
  /** When flipping downward from an above placement, align the menu top to this Y. */
  flipDownAlignTopY?: number;
  /**
   * When flipping to the left (not enough room to open rightward), align the
   * menu's right edge to this X instead of `anchorX` (e.g. a submenu flyout
   * should hug the left edge of its *parent panel*, not its trigger item —
   * otherwise it lands on top of the parent panel when the trigger sits near
   * the panel's own right edge).
   */
  flipLeftAlignRightX?: number;
  /**
   * Horizontal align relative to `anchorX`.
   * - `start` (default): menu left edge at X (Radix/shadcn `align="start"`)
   * - `end`: menu right edge at X (Radix/shadcn `align="end"`)
   */
  align?: "start" | "end";
  /**
   * Vertical placement relative to `anchorY`.
   * - `below` (default): menu top edge at Y
   * - `above`: menu bottom edge at Y
   */
  vertical?: "below" | "above";
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
  const preferAbove = options.vertical === "above";

  let left = options.align === "end" ? anchorX - width : anchorX;
  let top = preferAbove ? anchorY - height : anchorY;

  if (
    options.align !== "end" &&
    left + width > window.innerWidth - VIEWPORT_PADDING
  ) {
    const flipAnchorX = options.flipLeftAlignRightX ?? anchorX;
    left = flipAnchorX - width;
  }
  if (!preferAbove && top + height > window.innerHeight - VIEWPORT_PADDING) {
    const flipAnchorY = options.flipUpAlignBottomY ?? anchorY;
    top = flipAnchorY - height;
  }
  if (preferAbove && top < VIEWPORT_PADDING) {
    top = options.flipDownAlignTopY ?? anchorY;
  }

  left = Math.max(VIEWPORT_PADDING, Math.min(left, maxLeft));
  top = Math.max(VIEWPORT_PADDING, Math.min(top, maxTop));

  return { left, top };
}
