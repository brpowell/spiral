import { describe, expect, it } from "vitest";
import { resampleInterleavedPcm } from "./pcmResample";

describe("resampleInterleavedPcm", () => {
  it("returns the same buffer when rates match", () => {
    const samples = new Float32Array([0, 1, 0, -1]);
    expect(resampleInterleavedPcm(samples, 2, 44100, 44100)).toBe(samples);
  });

  it("doubles frame count when upsampling 2x", () => {
    // One stereo frame at 0.5 / -0.5
    const samples = new Float32Array([0.5, -0.5]);
    const out = resampleInterleavedPcm(samples, 2, 22050, 44100);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(-0.5);
  });

  it("halves frame count when downsampling 2x", () => {
    const samples = new Float32Array([0, 0, 1, 1, 0, 0, -1, -1]);
    const out = resampleInterleavedPcm(samples, 2, 48000, 24000);
    expect(out.length).toBe(4);
  });
});
