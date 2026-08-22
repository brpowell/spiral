import {
  EQ_BAND_COUNT,
  clampBandGain,
  normalizeBandGains,
  type EqualizerBandGains,
} from "./types";

/**
 * Rebuild a 10-band curve as a piecewise-linear tilt through `controlBands`.
 *
 * `controlBands` are 1-based. The dragged band takes `draggedGain`; other
 * control points keep their current gains. Unoccupied bands lerp between the
 * surrounding controls (hold the nearest endpoint outside the span).
 *
 * Nature's `AdjustAudio` is the two-point case (bands 1 and 10):
 * `gain[n] = ((10-n)*bass + (n-1)*treble) / 9`.
 */
export function spreadLinearBands(
  current: EqualizerBandGains,
  controlBands: readonly number[],
  draggedBand: number,
  draggedGain: number,
): EqualizerBandGains {
  const controls = uniqueSortedBands([...controlBands, draggedBand]);
  if (controls.length < 2) {
    const next = [...current] as number[];
    if (draggedBand >= 1 && draggedBand <= EQ_BAND_COUNT) {
      next[draggedBand - 1] = clampBandGain(draggedGain);
    }
    return normalizeBandGains(next);
  }

  const gainAt = new Map<number, number>();
  for (const band of controls) {
    const currentGain = current[band - 1] ?? 0;
    gainAt.set(
      band,
      band === draggedBand ? clampBandGain(draggedGain) : currentGain,
    );
  }

  const next = [...current] as number[];
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  const firstGain = gainAt.get(first)!;
  const lastGain = gainAt.get(last)!;

  for (let band = 1; band < first; band += 1) {
    next[band - 1] = firstGain;
  }
  for (let i = 0; i < controls.length - 1; i += 1) {
    const left = controls[i]!;
    const right = controls[i + 1]!;
    const leftGain = gainAt.get(left)!;
    const rightGain = gainAt.get(right)!;
    const span = right - left;
    for (let band = left; band <= right; band += 1) {
      const t = span === 0 ? 0 : (band - left) / span;
      next[band - 1] = leftGain + (rightGain - leftGain) * t;
    }
  }
  for (let band = last + 1; band <= EQ_BAND_COUNT; band += 1) {
    next[band - 1] = lastGain;
  }

  return normalizeBandGains(next);
}

function uniqueSortedBands(bands: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const band of bands) {
    if (band >= 1 && band <= EQ_BAND_COUNT) {
      seen.add(band);
    }
  }
  return [...seen].sort((a, b) => a - b);
}
