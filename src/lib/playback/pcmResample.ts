/**
 * Linear-interpolation resample of interleaved PCM.
 * Used when a file's sample rate differs from the shared AudioContext rate.
 */
export function resampleInterleavedPcm(
  samples: Float32Array,
  channels: number,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (
    fromRate <= 0 ||
    toRate <= 0 ||
    channels <= 0 ||
    fromRate === toRate ||
    samples.length === 0
  ) {
    return samples;
  }

  const srcFrames = Math.floor(samples.length / channels);
  if (srcFrames <= 0) return samples;

  const destFrames = Math.max(1, Math.round((srcFrames * toRate) / fromRate));
  const out = new Float32Array(destFrames * channels);
  const ratio = srcFrames / destFrames;

  for (let i = 0; i < destFrames; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, srcFrames - 1);
    const frac = srcPos - i0;
    for (let ch = 0; ch < channels; ch++) {
      const s0 = samples[i0 * channels + ch] ?? 0;
      const s1 = samples[i1 * channels + ch] ?? 0;
      out[i * channels + ch] = s0 + (s1 - s0) * frac;
    }
  }
  return out;
}
