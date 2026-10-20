import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_ID,
  findThemeFont,
  resolveFontStack,
  THEME_FONTS,
} from "./fonts";

function rustFontIds(): string[] {
  const source = readFileSync(
    join(process.cwd(), "../../libs/spk-format/src/theme.rs"),
    "utf8",
  );
  const block = /pub const THEME_FONT_IDS[^=]*=\s*&\[([^\]]*)\]/.exec(source);
  if (!block) throw new Error("THEME_FONT_IDS not found in theme.rs");
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("theme font catalog", () => {
  it("matches the ids the spk-format validator accepts", () => {
    expect(rustFontIds()).toEqual(THEME_FONTS.map((font) => font.id));
  });

  it("has unique ids and includes the default", () => {
    const ids = THEME_FONTS.map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findThemeFont(DEFAULT_FONT_ID)).toBeDefined();
  });

  it("declares an @font-face for every bundled font", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/fonts.css"),
      "utf8",
    );
    for (const font of THEME_FONTS.filter((f) => f.group === "bundled")) {
      expect(css).toContain(`font-family: "${font.label}"`);
    }
  });

  it("resolves an id to its stack and falls back for unknown ids", () => {
    expect(resolveFontStack("georgia")).toContain("Georgia");
    const fallback = resolveFontStack(DEFAULT_FONT_ID);
    expect(resolveFontStack("'Inter', sans-serif")).toBe(fallback);
    expect(resolveFontStack(undefined)).toBe(fallback);
  });
});
