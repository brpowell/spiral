/** WMP SLIDER thumb geometry: value maps to the thumb *center*. */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function centerTravel(trackLength: number, borderSize: number): number {
  return Math.max(0, trackLength - borderSize * 2);
}

/** Thumb top (px) for a vertical slider; `ratio` 1 = top/max, 0 = bottom/min. */
export function wmpVerticalThumbTop(opts: {
  ratio: number;
  trackHeight: number;
  thumbHeight: number;
  borderSize: number;
}): number {
  const { ratio, trackHeight, thumbHeight, borderSize } = opts;
  const travel = centerTravel(trackHeight, borderSize);
  const centerY = borderSize + (1 - clamp01(ratio)) * travel;
  return centerY - thumbHeight / 2;
}

/** Map a local Y (within the control) to 0…1 for a vertical WMP slider. */
export function wmpVerticalPointerToRatio(opts: {
  localY: number;
  trackHeight: number;
  borderSize: number;
}): number {
  const { localY, trackHeight, borderSize } = opts;
  const travel = centerTravel(trackHeight, borderSize);
  if (travel <= 0) return 0.5;
  return clamp01(1 - (localY - borderSize) / travel);
}

/** Thumb left (px) for a horizontal slider; `ratio` 0 = left/min, 1 = right/max. */
export function wmpHorizontalThumbLeft(opts: {
  ratio: number;
  trackWidth: number;
  thumbWidth: number;
  borderSize: number;
}): number {
  const { ratio, trackWidth, thumbWidth, borderSize } = opts;
  const travel = centerTravel(trackWidth, borderSize);
  const centerX = borderSize + clamp01(ratio) * travel;
  return centerX - thumbWidth / 2;
}

export function wmpHorizontalPointerToRatio(opts: {
  localX: number;
  trackWidth: number;
  borderSize: number;
}): number {
  const { localX, trackWidth, borderSize } = opts;
  const travel = centerTravel(trackWidth, borderSize);
  if (travel <= 0) return 0.5;
  return clamp01((localX - borderSize) / travel);
}

/** Integer cross-axis offset so a 16px thumb in a 17px box does not bleed 0.5px. */
export function wmpCrossAxisOffset(
  trackSize: number,
  thumbSize: number,
): number {
  return Math.floor((trackSize - thumbSize) / 2);
}

/** Fill span along the travel axis, ending at the thumb center (WMP foregroundImage). */
export function wmpSliderFillSpan(opts: {
  ratio: number;
  trackLength: number;
  borderSize: number;
}): number {
  const { ratio, trackLength, borderSize } = opts;
  const travel = centerTravel(trackLength, borderSize);
  return borderSize + clamp01(ratio) * travel;
}

/** True when local coords fall inside the thumb sprite box. */
export function pointInThumb(opts: {
  localX: number;
  localY: number;
  thumbLeft: number;
  thumbTop: number;
  thumbWidth: number;
  thumbHeight: number;
}): boolean {
  const { localX, localY, thumbLeft, thumbTop, thumbWidth, thumbHeight } = opts;
  return (
    localX >= thumbLeft &&
    localX < thumbLeft + thumbWidth &&
    localY >= thumbTop &&
    localY < thumbTop + thumbHeight
  );
}
