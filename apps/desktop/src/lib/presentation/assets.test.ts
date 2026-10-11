import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (filePath: string) => `asset://${filePath}`,
}));

import {
  isSafeVizMediaAsset,
  vizLayerAssetUrl,
  vizMediaLayerUrl,
} from "./assets";

describe("isSafeVizMediaAsset", () => {
  it("allows pack-relative media under assets/", () => {
    expect(isSafeVizMediaAsset("assets/bg-far.png")).toBe(true);
    expect(isSafeVizMediaAsset("assets/clips/ambient.webm", "video")).toBe(
      true,
    );
    expect(isSafeVizMediaAsset("assets/bg.png", "image")).toBe(true);
  });

  it("rejects traversal and absolute paths", () => {
    expect(isSafeVizMediaAsset("assets/../secret.png")).toBe(false);
    expect(isSafeVizMediaAsset("/etc/passwd")).toBe(false);
    expect(isSafeVizMediaAsset("\\windows\\system32")).toBe(false);
    expect(isSafeVizMediaAsset("C:/Music/track.mp3")).toBe(false);
    expect(isSafeVizMediaAsset("assets/foo\\bar.png")).toBe(false);
  });

  it("rejects missing prefix, empty segments, and bad extensions", () => {
    expect(isSafeVizMediaAsset("bg.png")).toBe(false);
    expect(isSafeVizMediaAsset("assets//bg.png")).toBe(false);
    expect(isSafeVizMediaAsset("assets/.png")).toBe(false);
    expect(isSafeVizMediaAsset("assets/bg")).toBe(false);
    expect(isSafeVizMediaAsset("assets/bg.exe")).toBe(false);
    expect(isSafeVizMediaAsset("assets/track.mp3")).toBe(false);
  });

  it("enforces kind-specific extensions", () => {
    expect(isSafeVizMediaAsset("assets/clip.webm", "image")).toBe(false);
    expect(isSafeVizMediaAsset("assets/bg.png", "video")).toBe(false);
    expect(isSafeVizMediaAsset("assets/clip.webm", "video")).toBe(true);
  });
});

describe("vizMediaLayerUrl", () => {
  it("builds an asset URL for safe image/video layers", () => {
    expect(
      vizMediaLayerUrl("/packs/demo", {
        kind: "image",
        asset: "assets/bg.png",
      }),
    ).toBe("asset:///packs/demo/assets/bg.png");
  });

  it("returns null for unsafe or non-media layers", () => {
    expect(
      vizMediaLayerUrl("/packs/demo", {
        kind: "image",
        asset: "assets/../x.png",
      }),
    ).toBeNull();
    expect(
      vizMediaLayerUrl("/packs/demo", {
        kind: "canvas",
        asset: "assets/bg.png",
      }),
    ).toBeNull();
    expect(vizMediaLayerUrl("/packs/demo", { kind: "image" })).toBeNull();
  });
});

describe("vizLayerAssetUrl", () => {
  it("throws on unsafe paths", () => {
    expect(() => vizLayerAssetUrl("/packs/demo", "assets/../x.png")).toThrow(
      /rejected asset path/,
    );
  });
});
