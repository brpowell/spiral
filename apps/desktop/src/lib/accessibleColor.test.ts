// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  MIN_TEXT_CONTRAST,
  accessibleMutedOnRaised,
  hexContrastRatio,
  accessibleSelectedText,
  raisedSurfaceHex,
  selectedTextSurfacesHex,
} from "./accessibleColor";
import { builtinThemeColors } from "./builtinThemeColors.testutil";
import { windowAppearanceForBackground } from "./theme";

describe("accessibleMutedOnRaised", () => {
  it("returns null for non-hex colors", () => {
    expect(accessibleMutedOnRaised("rgb(0 0 0)", "#fff")).toBeNull();
    expect(accessibleMutedOnRaised("#000", "oklch(1 0 0)")).toBeNull();
  });

  it("accepts shorthand hex", () => {
    expect(accessibleMutedOnRaised("#000", "#fff")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("adds more ink as the required ratio rises", () => {
    // A low bar is met by the starting 45% mix; a high one needs more ink.
    const low = accessibleMutedOnRaised("#0e0e10", "#f0f0f0", 1.5)!;
    const high = accessibleMutedOnRaised("#0e0e10", "#f0f0f0", 7)!;
    const surface = raisedSurfaceHex("#0e0e10", "#f0f0f0")!;
    expect(hexContrastRatio(high, surface)!).toBeGreaterThan(
      hexContrastRatio(low, surface)!,
    );
  });

  it.each(builtinThemeColors())(
    "clears AA on the raised surface for $id",
    ({ bg, ink }) => {
      const muted = accessibleMutedOnRaised(bg, ink)!;
      const surface = raisedSurfaceHex(bg, ink)!;
      // Hex rounding can shave a hair off the exact ratio.
      expect(hexContrastRatio(muted, surface)!).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST - 0.02,
      );
    },
  );
});

describe("accessibleSelectedText", () => {
  it("returns null for non-hex colors", () => {
    expect(accessibleSelectedText("red", "#fff", "#f00", "dark")).toBeNull();
  });

  it("keeps an accent that already passes", () => {
    // Abyss's cyan clears AA on its dark surfaces untouched.
    expect(
      accessibleSelectedText("#0a1220", "#eef1f8", "#5ecfd4", "dark"),
    ).toBe("#5ecfd4");
  });

  it("lightens a failing accent on dark pages and darkens it on light ones", () => {
    const dark = accessibleSelectedText(
      "#181512",
      "#f6f1e8",
      "#e63946",
      "dark",
    )!;
    const light = accessibleSelectedText(
      "#f3f1e4",
      "#2a2c18",
      "#7ab01c",
      "light",
    )!;
    expect(dark).not.toBe("#e63946");
    expect(light).not.toBe("#7ab01c");
  });

  it("holds the bar for arbitrary user-picked colors", () => {
    const bg = "#808080";
    const ink = "#ffffff";
    const accent = "#888800";
    const label = accessibleSelectedText(bg, ink, accent, "dark", 4.5)!;
    for (const surface of selectedTextSurfacesHex(bg, ink, accent)!) {
      expect(hexContrastRatio(label, surface)!).toBeGreaterThanOrEqual(4.4);
    }
  });

  it.each(builtinThemeColors())(
    "clears AA on every selected surface for $id",
    ({ bg, ink, accent }) => {
      const appearance = windowAppearanceForBackground(bg);
      const label = accessibleSelectedText(bg, ink, accent, appearance)!;
      for (const surface of selectedTextSurfacesHex(bg, ink, accent)!) {
        expect(hexContrastRatio(label, surface)!).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST - 0.02,
        );
      }
    },
  );
});
