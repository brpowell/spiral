import { describe, expect, it } from "vitest";
import {
  isSkinAssetIconPath,
  resolveSkinLibraryIcon,
} from "./skinLibraryIcons";

describe("isSkinAssetIconPath", () => {
  it("detects pack-relative raster paths", () => {
    expect(isSkinAssetIconPath("icons/foo.png")).toBe(true);
    expect(isSkinAssetIconPath("buttons/play.GIF")).toBe(true);
    expect(isSkinAssetIconPath("setList")).toBe(false);
  });
});

describe("resolveSkinLibraryIcon", () => {
  it("maps camelCase ids to Icon* exports", () => {
    expect(resolveSkinLibraryIcon("setList")).toBeDefined();
    expect(resolveSkinLibraryIcon("alwaysOnTop")).toBeDefined();
    expect(resolveSkinLibraryIcon("chevronLeft")).toBeDefined();
  });

  it("resolves IconVisualizer alias", () => {
    expect(resolveSkinLibraryIcon("visualizer")).toBe(
      resolveSkinLibraryIcon("audioWaveform"),
    );
  });

  it("returns undefined for unknown or asset paths", () => {
    expect(resolveSkinLibraryIcon("notAnIcon")).toBeUndefined();
    expect(resolveSkinLibraryIcon("setlist")).toBeUndefined();
    expect(resolveSkinLibraryIcon("icons/foo.png")).toBeUndefined();
  });
});
