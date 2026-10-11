const EMPTY = new Float32Array(0);

function concatFloat32(head: Float32Array, tail: Float32Array): Float32Array {
  const merged = new Float32Array(head.length + tail.length);
  merged.set(head);
  merged.set(tail, head.length);
  return merged;
}

/**
 * Linear-interpolation resampler for interleaved PCM that carries fractional
 * read position and boundary frames across calls.
 *
 * Resampling each chunk independently restarts the interpolation phase and
 * interpolates the final frame against itself, which puts a small discontinuity
 * at every chunk seam. Keeping the state makes a chunked stream produce the same
 * output as resampling the whole stream at once.
 */
export class PcmResampler {
  private readonly channels: number;
  /** Source frames advanced per output frame. */
  private readonly step: number;
  /** Source frames kept from previous calls, still needed for interpolation. */
  private carry: Float32Array = EMPTY;
  /** Fractional read position within `carry` + the next input. */
  private position = 0;

  constructor(channels: number, fromRate: number, toRate: number) {
    this.channels = channels;
    this.step = fromRate / toRate;
  }

  reset(): void {
    this.carry = EMPTY;
    this.position = 0;
  }

  process(samples: Float32Array): Float32Array {
    const channels = this.channels;
    if (samples.length === 0) return EMPTY;

    const src =
      this.carry.length === 0 ? samples : concatFloat32(this.carry, samples);
    const totalFrames = Math.floor(src.length / channels);

    // Both `index` and `index + 1` must be real frames, so the last frame is
    // held back until the next chunk supplies its neighbour.
    if (totalFrames < 2 || this.position > totalFrames - 2) {
      this.carry = src.slice();
      return EMPTY;
    }

    const outFrames =
      Math.floor((totalFrames - 2 - this.position) / this.step) + 1;
    const out = new Float32Array(outFrames * channels);

    let position = this.position;
    for (let i = 0; i < outFrames; i++) {
      const index = Math.floor(position);
      const frac = position - index;
      const base0 = index * channels;
      const base1 = base0 + channels;
      for (let ch = 0; ch < channels; ch++) {
        const s0 = src[base0 + ch] ?? 0;
        const s1 = src[base1 + ch] ?? 0;
        out[i * channels + ch] = s0 + (s1 - s0) * frac;
      }
      position += this.step;
    }

    const consumed = Math.min(Math.floor(position), totalFrames - 1);
    this.carry = src.slice(consumed * channels);
    this.position = position - consumed;
    return out;
  }

  /** Emit whatever the held-back tail can still produce, then reset. */
  flush(): Float32Array {
    const channels = this.channels;
    const totalFrames = Math.floor(this.carry.length / channels);
    if (totalFrames === 0 || this.position > totalFrames - 1) {
      this.reset();
      return EMPTY;
    }

    const outFrames =
      Math.floor((totalFrames - 1 - this.position) / this.step) + 1;
    const out = new Float32Array(outFrames * channels);
    const src = this.carry;

    let position = this.position;
    for (let i = 0; i < outFrames; i++) {
      const index = Math.floor(position);
      const frac = position - index;
      const base0 = index * channels;
      const base1 = Math.min(index + 1, totalFrames - 1) * channels;
      for (let ch = 0; ch < channels; ch++) {
        const s0 = src[base0 + ch] ?? 0;
        const s1 = src[base1 + ch] ?? 0;
        out[i * channels + ch] = s0 + (s1 - s0) * frac;
      }
      position += this.step;
    }

    this.reset();
    return out;
  }
}
