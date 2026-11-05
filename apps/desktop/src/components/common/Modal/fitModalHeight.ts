/** Parsed CSS pixel length, or null when the computed value is not a length. */
export function readCssPx(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Content height, limited by the panel's computed max-height. */
export function capHeight(natural: number, maxHeight: number | null): number {
  if (maxHeight == null || maxHeight <= 0) return natural;
  return Math.min(natural, maxHeight);
}

/** Boxes laid out inside `el`. A `display: contents` wrapper has none of its own, so its children stand in. */
function layoutChildren(el: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    const { display } = getComputedStyle(child);
    if (display === "contents") found.push(...layoutChildren(child));
    else if (display !== "none") found.push(child);
  }
  return found;
}

/** Content height of a tab panel, ignoring space the scrollport adds when stretched. */
export function contentBoxHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const gap = Number.parseFloat(style.rowGap) || 0;
  const children = layoutChildren(el);
  let height = 0;
  for (const child of children) height += child.offsetHeight;
  if (children.length > 1 && gap > 0) height += gap * (children.length - 1);
  height +=
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0) +
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  return height;
}

/** Vertically center a panel in the backdrop's content box. */
function centeredOffsetTop(
  panelHeight: number,
  backdropClientHeight: number,
  padTop: number,
  padBottom: number,
): number {
  const contentHeight = backdropClientHeight - padTop - padBottom;
  return Math.max(0, (contentHeight - panelHeight) / 2);
}

/**
 * Top edge for the current tab: centered as if the panel were the tallest
 * tab, then shifted up only if this tab's height would pass the backdrop.
 */
export function anchorOffsetTop(
  maxPanelHeight: number,
  currentPanelHeight: number,
  backdropClientHeight: number,
  padTop: number,
  padBottom: number,
): number {
  return pinnedOffsetTop(
    centeredOffsetTop(maxPanelHeight, backdropClientHeight, padTop, padBottom),
    currentPanelHeight,
    backdropClientHeight,
    padTop,
    padBottom,
  );
}

/**
 * Clamp a preferred top so `panelHeight` stays inside the backdrop padding.
 */
export function pinnedOffsetTop(
  preferredOffsetTop: number,
  panelHeight: number,
  backdropClientHeight: number,
  padTop: number,
  padBottom: number,
): number {
  const contentHeight = backdropClientHeight - padTop - padBottom;
  const maxOffset = Math.max(0, contentHeight - panelHeight);
  return Math.min(Math.max(0, preferredOffsetTop), maxOffset);
}
