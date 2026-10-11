import { describe, expect, it } from "vitest";
import { PcmResampler } from "./pcmResample";

function sineFrames(frames: number, channels: number): Float32Array {
  const out = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      out[i * channels + ch] = Math.sin((i / 32) * Math.PI * 2 + ch);
    }
  }
  return out;
}

function drain(resampler: PcmResampler, chunks: Float32Array[]): Float32Array {
  const parts = chunks.map((chunk) => resampler.process(chunk));
  parts.push(resampler.flush());
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunked(samples: Float32Array, frames: number, channels: number) {
  const chunks: Float32Array[] = [];
  const step = frames * channels;
  for (let offset = 0; offset < samples.length; offset += step) {
    chunks.push(samples.slice(offset, Math.min(offset + step, samples.length)));
  }
  return chunks;
}

describe("PcmResampler", () => {
  it("produces identical output whether fed in one chunk or many", () => {
    const channels = 2;
    const input = sineFrames(1000, channels);

    const oneShot = drain(new PcmResampler(channels, 44100, 48000), [input]);
    const inChunks = drain(
      new PcmResampler(channels, 44100, 48000),
      chunked(input, 128, channels),
    );

    expect(inChunks.length).toBe(oneShot.length);
    for (let i = 0; i < oneShot.length; i++) {
      expect(inChunks[i]).toBeCloseTo(oneShot[i]!, 6);
    }
  });

  it("keeps chunk seams continuous for a smooth signal", () => {
    const channels = 1;
    const input = sineFrames(600, channels);
    const out = drain(
      new PcmResampler(channels, 44100, 48000),
      chunked(input, 64, channels),
    );

    // A 1/32-cycle-per-frame sine never steps far between adjacent output
    // frames; a phase reset at a chunk seam would show up as a large jump.
    let maxDelta = 0;
    for (let i = 1; i < out.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(out[i]! - out[i - 1]!));
    }
    expect(maxDelta).toBeLessThan(0.25);
  });

  it("scales frame count by the rate ratio", () => {
    const channels = 2;
    const input = sineFrames(4410, channels);
    const out = drain(new PcmResampler(channels, 44100, 48000), [input]);
    expect(out.length / channels).toBeGreaterThan(4700);
    expect(out.length / channels).toBeLessThanOrEqual(4800);
  });

  it("downsamples by the rate ratio", () => {
    const channels = 2;
    const input = sineFrames(4800, channels);
    const out = drain(new PcmResampler(channels, 48000, 24000), [input]);
    expect(out.length / channels).toBeGreaterThan(2350);
    expect(out.length / channels).toBeLessThanOrEqual(2400);
  });

  it("holds back a partial frame until more input arrives", () => {
    const channels = 2;
    const resampler = new PcmResampler(channels, 44100, 48000);
    expect(resampler.process(new Float32Array([0.5, -0.5])).length).toBe(0);
    expect(resampler.process(new Float32Array([0.25, -0.25])).length).toBe(2);
  });

  it("resets carried state", () => {
    const channels = 1;
    const resampler = new PcmResampler(channels, 44100, 48000);
    resampler.process(sineFrames(100, channels));
    resampler.reset();
    expect(resampler.flush().length).toBe(0);
  });
});
