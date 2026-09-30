import { describe, expect, it } from "vitest";
import { encodeWavPcm16, formatPeakDb, peakDb } from "./wav";

describe("transport signature wav", () => {
  it("writes a mono 16-bit header", () => {
    const bytes = encodeWavPcm16(new Float32Array([0, 0.5, -1]), 44100);
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe(
      "RIFF",
    );
    expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe(
      "WAVE",
    );
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.length).toBe(44 + 6);
    expect(view.getInt16(44 + 2, true)).toBe(0x3fff);
    expect(view.getInt16(44 + 4, true)).toBe(-0x8000);
  });

  it("reports peak level in decibels", () => {
    expect(peakDb(new Float32Array([0.5, -0.25]))).toBeCloseTo(-6.0206, 3);
    expect(peakDb(new Float32Array([0, 0]))).toBe(Number.NEGATIVE_INFINITY);
    expect(formatPeakDb(Number.NEGATIVE_INFINITY)).toBe("Silent");
    expect(formatPeakDb(0)).toBe("Peak 0.0 dB · clipping");
    expect(formatPeakDb(-12.04)).toBe("Peak -12.0 dB");
  });
});
