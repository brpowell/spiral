export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPlacementInput {
  trigger: TooltipRect;
  tooltip: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Preferred side. The other side is used when this one doesn't have room. */
  placement: "top" | "bottom";
  /** Space between the trigger and the tooltip. */
  gap?: number;
  /** Minimum distance kept from every viewport edge. */
  padding?: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  /** The side it ended up on, after any flip. */
  placement: "top" | "bottom";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Where to put a tooltip so it is centered on its trigger and fully visible.
 *
 * Unlike a menu, a tooltip never flips sideways: when centering would overflow the left or right
 * edge it slides along the edge instead, so it stays attached to the trigger. Vertically it flips
 * to the other side when the preferred side is too tight, and otherwise takes the roomier side.
 */
export function placeTooltip({
  trigger,
  tooltip,
  viewport,
  placement,
  gap = 8,
  padding = 8,
}: TooltipPlacementInput): TooltipPlacement {
  const centered = trigger.left + trigger.width / 2 - tooltip.width / 2;
  const left = clamp(
    centered,
    padding,
    Math.max(padding, viewport.width - tooltip.width - padding),
  );

  const roomAbove = trigger.top - gap - padding;
  const roomBelow =
    viewport.height - (trigger.top + trigger.height) - gap - padding;
  const fits = (side: "top" | "bottom") =>
    (side === "top" ? roomAbove : roomBelow) >= tooltip.height;
  const other = placement === "top" ? "bottom" : "top";

  let side = placement;
  if (!fits(placement)) {
    if (fits(other)) side = other;
    else side = roomAbove >= roomBelow ? "top" : "bottom";
  }

  const rawTop =
    side === "top"
      ? trigger.top - gap - tooltip.height
      : trigger.top + trigger.height + gap;
  const top = clamp(
    rawTop,
    padding,
    Math.max(padding, viewport.height - tooltip.height - padding),
  );

  return { left, top, placement: side };
}
