import { describe, expect, it } from "vitest";
import { resolveAuxStartupRequirements } from "./skinAuxStartupRequirements";
import type { LoadedSkinPack } from "../types/skin";

function makePack(views: LoadedSkinPack["manifest"]["views"]): LoadedSkinPack {
  return {
    summary: {
      id: "test",
      name: "Test",
      author: "Test",
      description: "",
      isBuiltin: true,
      previewPath: null,
    },
    packDir: "/tmp/test",
    manifest: {
      version: 1,
      name: "Test",
      author: "Test",
      description: "",
      defaultView: "main",
      views,
    },
  };
}

describe("resolveAuxStartupRequirements", () => {
  it("detects T3-style canvas EQ view from eqBand nodes", () => {
    const pack = makePack({
      eq: {
        layoutMode: "canvas",
        layout: {
          type: "canvas",
          children: [
            {
              type: "eqBand",
              band: 1,
              presentation: {
                kind: "bitmapVerticalSlider",
                track: "sliders/eq-track",
                thumb: "sliders/eq-thumb",
              },
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "eq")).toEqual({
      player: true,
      eq: true,
      visualizer: false,
      playlists: false,
      theme: false,
    });
  });

  it("detects visualizer view from layout nodes", () => {
    const pack = makePack({
      vis: {
        layoutMode: "canvas",
        layout: {
          type: "canvas",
          children: [
            {
              type: "visualizer",
              presentation: {
                kind: "framedPanel",
                mask: "viz-mask",
                frame: "viz-frame",
              },
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "vis")).toEqual({
      player: true,
      eq: false,
      visualizer: true,
      playlists: false,
      theme: false,
    });
  });

  it("detects playlist aux and slot theme requirement", () => {
    const pack = makePack({
      playlist: {
        layout: {
          type: "column",
          children: [
            {
              type: "playlist",
              presentation: { kind: "compact" },
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "playlist")).toEqual({
      player: true,
      eq: false,
      visualizer: false,
      playlists: true,
      theme: true,
    });
  });

  it("detects playlist nodes nested inside tiledFrame", () => {
    const pack = makePack({
      playlist: {
        layoutMode: "canvas",
        layout: {
          type: "canvas",
          children: [
            {
              type: "tiledFrame",
              presentation: {
                kind: "tiledFrame",
                frameThickness: 53,
                contentInset: { left: 0, top: 0, right: 0, bottom: 0 },
                assets: {
                  topLeft: "a",
                  topCenter: "b",
                  topRight: "c",
                  topStretch: "d",
                  leftStretch: "e",
                  rightStretch: "f",
                  bottomLeft: "g",
                  bottomCenter: "h",
                  bottomRight: "i",
                  bottomStretch: "j",
                },
                tileSizes: {
                  topLeft: { w: 1, h: 1 },
                  topCenter: { w: 1, h: 1 },
                  topRight: { w: 1, h: 1 },
                  leftStretch: { w: 1, h: 1 },
                  rightStretch: { w: 1, h: 1 },
                  bottomLeft: { w: 1, h: 1 },
                  bottomCenter: { w: 1, h: 1 },
                  bottomRight: { w: 1, h: 1 },
                },
              },
              children: [
                {
                  type: "playlist",
                  presentation: { kind: "compact" },
                },
              ],
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "playlist").playlists).toBe(true);
  });

  it("detects visualizer nodes nested inside tiledFrame", () => {
    const pack = makePack({
      vis: {
        layoutMode: "canvas",
        layout: {
          type: "canvas",
          children: [
            {
              type: "tiledFrame",
              presentation: {
                kind: "tiledFrame",
                frameThickness: 53,
                contentInset: { left: 0, top: 0, right: 0, bottom: 0 },
                assets: {
                  topLeft: "a",
                  topCenter: "b",
                  topRight: "c",
                  topStretch: "d",
                  leftStretch: "e",
                  rightStretch: "f",
                  bottomLeft: "g",
                  bottomCenter: "h",
                  bottomRight: "i",
                  bottomStretch: "j",
                },
                tileSizes: {
                  topLeft: { w: 1, h: 1 },
                  topCenter: { w: 1, h: 1 },
                  topRight: { w: 1, h: 1 },
                  leftStretch: { w: 1, h: 1 },
                  rightStretch: { w: 1, h: 1 },
                  bottomLeft: { w: 1, h: 1 },
                  bottomCenter: { w: 1, h: 1 },
                  bottomRight: { w: 1, h: 1 },
                },
              },
              children: [
                {
                  type: "visualizer",
                  presentation: { kind: "primitive" },
                },
              ],
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "vis").visualizer).toBe(true);
  });

  it("detects eq from eqBand nodes", () => {
    const pack = makePack({
      eqPanel: {
        layoutMode: "canvas",
        layout: {
          type: "canvas",
          children: [
            {
              type: "eqBand",
              band: 3,
              presentation: {
                kind: "stripSlider",
                map: "eq-map",
                width: 14,
                height: 116,
              },
            },
          ],
        },
      },
    });

    expect(resolveAuxStartupRequirements(pack, "eqPanel").eq).toBe(true);
  });

  it("defaults theme on for missing view", () => {
    const pack = makePack({});
    expect(resolveAuxStartupRequirements(pack, "missing")).toEqual({
      player: true,
      eq: false,
      visualizer: false,
      playlists: false,
      theme: true,
    });
  });
});
