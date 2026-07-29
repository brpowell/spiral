// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { Theme } from "../types/theme";
import {
  DEFAULT_THEME_ID,
  OBSIDIAN_DEFAULT_TOKENS,
  applyTheme,
  findThemeById,
  mergeThemeTokens,
  resolveActiveThemeId,
  resolveThemeTokens,
} from "./theme";

function makeTheme(id: string, name: string): Theme {
  const parts = id.split(".");
  const authorId = parts.length >= 3 ? parts[0]! : "spiral";
  const packId =
    parts.length >= 3 ? parts[1]! : parts.length >= 2 ? parts[0]! : id;
  return {
    id,
    name,
    author: "Spiral",
    description: "",
    packId,
    authorId,
    packName: name,
    packVersion: "1.0.0",
    zone: "builtin",
    mutable: false,
    tokens: {
      "color-bg": "#000",
      "color-surface": "#111",
      "color-text-primary": "#fff",
      "color-text-secondary": "#aaa",
      "color-accent": "#00f",
      "color-accent-muted": "#003",
      "color-border": "#222",
      "color-danger": "#f00",
      "radius-card": "8px",
      "radius-button": "4px",
      "font-ui": "system-ui",
    },
  };
}

const themes: Theme[] = [
  makeTheme("spiral.core.theme.obsidian", "Obsidian"),
  makeTheme("spiral.core.theme.parchment", "Parchment"),
  makeTheme("spiral.core.theme.noir", "Noir"),
  makeTheme("spiral.core.theme.grove", "Grove"),
];

describe("findThemeById", () => {
  it("finds by stable id", () => {
    expect(findThemeById(themes, "spiral.core.theme.parchment")?.name).toBe(
      "Parchment",
    );
  });

  it("does not match display name", () => {
    expect(findThemeById(themes, "Parchment")).toBeUndefined();
  });
});

describe("resolveActiveThemeId", () => {
  it("keeps an existing id", () => {
    expect(resolveActiveThemeId(themes, "spiral.core.theme.grove")).toBe(
      "spiral.core.theme.grove",
    );
  });

  it("falls back to default for unknown values", () => {
    expect(resolveActiveThemeId(themes, "not-a-theme")).toBe(DEFAULT_THEME_ID);
    expect(resolveActiveThemeId(themes, "Obsidian")).toBe(DEFAULT_THEME_ID);
    expect(resolveActiveThemeId(themes, "obsidian")).toBe(DEFAULT_THEME_ID);
  });

  it("defaults to spiral.core.theme.obsidian", () => {
    expect(DEFAULT_THEME_ID).toBe("spiral.core.theme.obsidian");
  });
});

describe("mergeThemeTokens / applyTheme role tokens", () => {
  afterEach(() => {
    document.documentElement.style.cssText = "";
    document.documentElement.classList.remove("theme-transition");
    document.getElementById("spiral-theme-transition")?.remove();
  });

  it("fills color-accent-text and role tokens from Obsidian defaults", () => {
    const merged = mergeThemeTokens({ "color-bg": "#000" });
    expect(merged["color-accent-text"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-accent-text"],
    );
    expect(merged["color-interactive"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-interactive"],
    );
    expect(merged["color-interactive-selected-text"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-interactive-selected-text"],
    );
    expect(merged["radius-input"]).toBe(OBSIDIAN_DEFAULT_TOKENS["radius-input"]);
    expect(merged["color-text-muted"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-text-muted"],
    );
  });

  it("applyTheme writes merged role tokens (derived aliases stay in CSS)", () => {
    const theme = makeTheme("core.test", "Test");
    applyTheme(theme);
    const root = document.documentElement;
    const tokens = resolveThemeTokens(theme);
    expect(root.style.getPropertyValue("--color-accent-text")).toBe(
      tokens["color-accent-text"],
    );
    expect(root.style.getPropertyValue("--color-interactive")).toBe(
      tokens["color-interactive"],
    );
    expect(root.style.getPropertyValue("--radius-input")).toBe(
      tokens["radius-input"],
    );
  });

  it("applyTheme with transition toggles theme-transition on html", () => {
    const theme = makeTheme("core.test", "Test");
    applyTheme(theme, { transition: true });
    expect(document.documentElement.classList.contains("theme-transition")).toBe(
      true,
    );
    applyTheme(theme, { transition: false });
    expect(document.documentElement.classList.contains("theme-transition")).toBe(
      false,
    );
  });
});
