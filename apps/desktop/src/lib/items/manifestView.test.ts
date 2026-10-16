import { describe, expect, it } from "vitest";
import {
  looksLikeColor,
  skinContentsView,
  soundPackView,
  themeTokenView,
  visualizerLayers,
} from "./manifestView";

describe("themeTokenView", () => {
  it("separates colors from other tokens", () => {
    const view = themeTokenView({
      tokens: {
        "color-bg": "#000",
        "color-accent": "rgb(1 2 3)",
        "radius-card": "12px",
        "font-ui": "Inter, sans-serif",
      },
    });
    expect(view.colors.map(([k]) => k)).toEqual(["color-bg", "color-accent"]);
    expect(view.other.map(([k]) => k)).toEqual(["radius-card", "font-ui"]);
  });

  it("tolerates a missing or malformed tokens field", () => {
    expect(themeTokenView({})).toEqual({ colors: [], other: [] });
    expect(themeTokenView({ tokens: [1, 2] })).toEqual({
      colors: [],
      other: [],
    });
  });

  it("detects color values by key or value", () => {
    expect(looksLikeColor("color-x", "anything")).toBe(true);
    expect(looksLikeColor("accent", "#abc")).toBe(true);
    expect(looksLikeColor("accent", "oklch(0.7 0.1 200)")).toBe(true);
    expect(looksLikeColor("radius-card", "12px")).toBe(false);
  });
});

describe("soundPackView", () => {
  const manifest = {
    sounds: { blip: "sounds/blip.wav", chime: "sounds/chime.wav" },
    cues: { transportPlay: "chime", extraCue: "blip", broken: "missing" },
  };

  it("lists sounds with the cues that use them", () => {
    const view = soundPackView(manifest);
    expect(view.sounds).toEqual([
      { id: "blip", file: "sounds/blip.wav", cues: ["extraCue"] },
      { id: "chime", file: "sounds/chime.wav", cues: ["transportPlay"] },
    ]);
  });

  it("flags unknown cues, dangling assignments and unassigned known cues", () => {
    const cues = soundPackView(manifest).cues;
    const byCue = Object.fromEntries(cues.map((c) => [c.cue, c]));
    expect(byCue.transportPlay).toMatchObject({ known: true, valid: true });
    expect(byCue.extraCue).toMatchObject({ known: false, valid: true });
    expect(byCue.broken).toMatchObject({ known: false, valid: false });
    expect(byCue.transportControl).toMatchObject({
      known: true,
      soundId: null,
    });
  });
});

describe("skinContentsView", () => {
  it("summarizes views, settings, sounds and the visualizer pin", () => {
    const view = skinContentsView({
      stylesheet: "skin.css",
      visualizer: { id: "spiral.visualizer.bars" },
      soundEffects: { button: "sounds/click" },
      settings: [{ id: "glow", name: "Glow", type: "boolean", default: true }],
      views: {
        main: {
          presentation: "primary",
          window: { defaultWidth: 320, defaultHeight: 468, resizable: true },
        },
        mini: {},
      },
    });
    expect(view.views).toEqual([
      {
        id: "main",
        presentation: "primary",
        defaultSize: "320 × 468",
        resizable: true,
      },
      { id: "mini", presentation: null, defaultSize: null, resizable: null },
    ]);
    expect(view.settings).toEqual([
      { id: "glow", name: "Glow", type: "boolean", defaultValue: "true" },
    ]);
    expect(view.soundEffects).toEqual([["button", "sounds/click"]]);
    expect(view.visualizer).toBe("spiral.visualizer.bars");
    expect(view.stylesheet).toBe("skin.css");
  });

  it("treats a global visualizer as no pin", () => {
    expect(
      skinContentsView({ visualizer: { id: "global" } }).visualizer,
    ).toBeNull();
    expect(skinContentsView({}).visualizer).toBeNull();
  });
});

describe("visualizerLayers", () => {
  it("reads kind, source and layout", () => {
    expect(
      visualizerLayers({
        children: [
          { id: "dream", kind: "webgl", layout: "fill", entry: "index.js" },
          { kind: "image", layout: { x: 0 }, asset: "assets/bg.png" },
        ],
      }),
    ).toEqual([
      { id: "dream", kind: "webgl", source: "index.js", layout: "fill" },
      { id: null, kind: "image", source: "assets/bg.png", layout: "custom" },
    ]);
  });
});
