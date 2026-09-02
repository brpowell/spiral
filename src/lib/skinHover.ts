/** After the last window resize, ignore hover occupancy for this long. */
export const SKIN_HOVER_RESIZE_QUIET_MS = 200;

/** Expose hovered node ids as `data-hover-{id}` on the view stage. */
export function hoverNodeDataAttributes(
  active: ReadonlySet<string>,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const id of active) {
    attrs[`data-hover-${id}`] = "true";
  }
  return attrs;
}
