import { describe, expect, it } from "vitest";
import { looksLikeColor, soundPackView, themeTokenView } from "./manifestView";

describe("themeTokenView", () => {
  it("separates colors from other tokens", () => {
    const view = themeTokenView({
      tokens: {
        "color-bg": "#000",
        "color-accent": "rgb(1 2 3)",
        "font-mono": "monospace",
        "font-ui": "Inter, sans-serif",
      },
    });
    expect(view.colors.map(([k]) => k)).toEqual(["color-bg", "color-accent"]);
    expect(view.other.map(([k]) => k)).toEqual(["font-mono", "font-ui"]);
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

  it("lists the sound library", () => {
    expect(soundPackView(manifest).sounds).toEqual([
      { id: "blip", file: "sounds/blip.wav" },
      { id: "chime", file: "sounds/chime.wav" },
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
