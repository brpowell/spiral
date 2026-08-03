import { describe, expect, it } from "vitest";
import pcmStreamProcessorUrl from "./pcmStreamProcessor.ts?worker&url";

describe("pcm stream worklet module URL", () => {
  it("resolves to a same-origin asset URL, not an inlined data: URL", () => {
    // Production CSP allows script-src 'self' blob: — data: is rejected with
    // "Not allowed by CSP" (see GitHub #203). Vite's plain new URL(.ts) path
    // incorrectly inlines TypeScript as data:video/mp2t.
    expect(pcmStreamProcessorUrl).toEqual(expect.any(String));
    expect(pcmStreamProcessorUrl.startsWith("data:")).toBe(false);
  });
});
