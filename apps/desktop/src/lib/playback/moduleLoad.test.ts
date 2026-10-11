// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

describe("playback module graph", () => {
  it("loads the playback facade without throwing", async () => {
    const mod = await import("./index");
    expect(mod.load).toBeTypeOf("function");
  });
});
