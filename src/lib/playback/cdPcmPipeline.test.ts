import { describe, expect, it } from "vitest";
import { decodePcmBase64 } from "./cdPcmPipeline";

describe("decodePcmBase64", () => {
  it("decodes little-endian f32 PCM", () => {
    const samples = new Float32Array([0, 0.5, -0.25, 1]);
    const bytes = new Uint8Array(samples.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const b64 = btoa(binary);
    const decoded = decodePcmBase64(b64);
    expect(Array.from(decoded)).toEqual(Array.from(samples));
  });
});
