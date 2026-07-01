import { describe, expect, it } from "vitest";
import { formatAssetForDisplay } from "./assetUrl";

describe("formatAssetForDisplay", () => {
  it("returns file paths unchanged", () => {
    const path =
      "/Users/bryan/Music/Spiral Library/Media/SEGA/14 - Track.m4a";
    expect(formatAssetForDisplay(path)).toBe(path);
  });

  it("decodes asset:// URLs and strips cache-bust query", () => {
    const encoded =
      "asset://localhost/%2FUsers%2Fbryan%2FMusic%2FSpiral%20Library%2FMedia%2Ftrack.m4a?v=1760800496117";
    expect(formatAssetForDisplay(encoded)).toBe(
      "/Users/bryan/Music/Spiral Library/Media/track.m4a",
    );
  });

  it("decodes https://asset.localhost URLs", () => {
    const url =
      "https://asset.localhost/Users%2Fbryan%2Ftrack.m4a?v=1";
    expect(formatAssetForDisplay(url)).toBe("/Users/bryan/track.m4a");
  });
});
