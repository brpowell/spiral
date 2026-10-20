import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_TEXT_CONTRAST,
  accessibleMutedOnRaised,
  hexContrastRatio,
  raisedSurfaceHex,
} from "./accessibleColor";

const THEMES_DIR = join(process.cwd(), "src-tauri/packs/builtin/themes");

function builtinThemes(): { id: string; bg: string; ink: string }[] {
  return readdirSync(THEMES_DIR)
    .filter((name) => name.startsWith("spiral."))
    .map((id) => {
      const manifest = JSON.parse(
        readFileSync(join(THEMES_DIR, id, "theme.json"), "utf8"),
      ) as { tokens: Record<string, string> };
      return {
        id,
        bg: manifest.tokens["color-bg"]!,
        ink: manifest.tokens["color-text-primary"]!,
      };
    });
}

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

  it.each(builtinThemes())(
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
