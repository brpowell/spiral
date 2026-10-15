import { getAnalyser } from "../../lib/playback";

function bucketRms(
  bins: readonly number[],
  start: number,
  end: number,
): number {
  const startIdx = Math.max(0, Math.floor(start));
  const endIdx = Math.min(bins.length, Math.ceil(end));
  if (endIdx <= startIdx) return 0;
  let sum = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const normalized = (bins[i] ?? 0) / 255;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / (endIdx - startIdx));
}

/** RMS energy buckets from frequency bins (0–1), for glow and layer drives. */
export function computeAudioEnergy(bins: readonly number[]): {
  overallEnergy: number;
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
} {
  if (bins.length === 0) {
    return {
      overallEnergy: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
    };
  }

  const len = bins.length;
  const bassEnd = Math.max(1, Math.floor(len * 0.08));
  const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.45));

  return {
    overallEnergy: bucketRms(bins, 0, len),
    bassEnergy: bucketRms(bins, 0, bassEnd),
    midEnergy: bucketRms(bins, bassEnd, midEnd),
    trebleEnergy: bucketRms(bins, midEnd, len),
  };
}

export function sampleFrequencyData(
  localDataArrayRef: { current: Uint8Array<ArrayBuffer> | null },
  remoteBins: number[] | null,
): Uint8Array<ArrayBuffer> | number[] | null {
  if (remoteBins) return remoteBins;

  const analyser = getAnalyser();
  if (!analyser) return null;

  if (!localDataArrayRef.current) {
    localDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
  }
  const localData = localDataArrayRef.current;
  analyser.getByteFrequencyData(localData);
  return localData;
}

export function sampleTimeDomainData(localDataArrayRef: {
  current: Uint8Array<ArrayBuffer> | null;
}): Uint8Array<ArrayBuffer> | null {
  const analyser = getAnalyser();
  if (!analyser) return null;

  if (
    !localDataArrayRef.current ||
    localDataArrayRef.current.length !== analyser.fftSize
  ) {
    localDataArrayRef.current = new Uint8Array(analyser.fftSize);
  }
  const localData = localDataArrayRef.current;
  analyser.getByteTimeDomainData(localData);
  return localData;
}
