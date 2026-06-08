const VIEWPORT_PADDING = 8;

export interface FitContextMenuPositionOptions {
  /** When flipping upward, align the menu bottom to this Y (e.g. submenu trigger bottom). */
  flipUpAlignBottomY?: number;
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

  let left = anchorX;
  let top = anchorY;

  if (left + width > window.innerWidth - VIEWPORT_PADDING) {
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
