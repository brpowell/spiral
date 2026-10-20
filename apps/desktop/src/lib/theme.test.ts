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
  stripDerivedThemeTokens,
  windowAppearanceForBackground,
} from "./theme";
import { resolveFontStack } from "./fonts";

function makeTheme(id: string, name: string): Theme {
  const parts = id.split(".");
  const publisherId = parts.length >= 3 ? parts[0]! : "spiral";
  return {
    id,
    name,
    author: "Spiral",
    description: "",
    publisherId,
    version: "1.0.0",
    zone: "builtin",
    mutable: false,
    tokens: {
      "color-bg": "#000",
      "color-text-primary": "#fff",
      "color-accent": "#00f",
      "color-danger": "#f00",
      "font-ui": "system-ui",
    },
  };
}

const themes: Theme[] = [
  makeTheme("spiral.theme.obsidian", "Obsidian"),
  makeTheme("spiral.theme.parchment", "Parchment"),
  makeTheme("spiral.theme.noir", "Noir"),
  makeTheme("spiral.theme.grove", "Grove"),
];

describe("findThemeById", () => {
  it("finds by stable id", () => {
    expect(findThemeById(themes, "spiral.theme.parchment")?.name).toBe(
      "Parchment",
    );
  });

  it("does not match display name", () => {
    expect(findThemeById(themes, "Parchment")).toBeUndefined();
  });
});

describe("resolveActiveThemeId", () => {
  it("keeps an existing id", () => {
    expect(resolveActiveThemeId(themes, "spiral.theme.grove")).toBe(
      "spiral.theme.grove",
    );
  });

  it("falls back to default for unknown values", () => {
    expect(resolveActiveThemeId(themes, "not-a-theme")).toBe(DEFAULT_THEME_ID);
    expect(resolveActiveThemeId(themes, "Obsidian")).toBe(DEFAULT_THEME_ID);
    expect(resolveActiveThemeId(themes, "obsidian")).toBe(DEFAULT_THEME_ID);
  });

  it("defaults to spiral.theme.obsidian", () => {
    expect(DEFAULT_THEME_ID).toBe("spiral.theme.obsidian");
  });
});

describe("mergeThemeTokens / applyTheme", () => {
  afterEach(() => {
    document.documentElement.style.cssText = "";
    document.documentElement.classList.remove("theme-transition");
    delete document.documentElement.dataset.appearance;
    document.getElementById("spiral-theme-transition")?.remove();
  });

  it("fills authorable tokens from Obsidian defaults", () => {
    const merged = mergeThemeTokens({ "color-bg": "#000" });
    expect(merged["color-accent"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-accent"],
    );
    expect(merged["color-danger"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-danger"],
    );
    expect(merged["color-alert-info"]).toBe(
      OBSIDIAN_DEFAULT_TOKENS["color-alert-info"],
    );
    expect(merged["font-ui"]).toBe(OBSIDIAN_DEFAULT_TOKENS["font-ui"]);
  });

  it("strips retired derived tokens from merge results", () => {
    const merged = mergeThemeTokens({
      "color-bg": "#000",
      "color-danger-bg": "#2a1518",
      "color-alert-error": "#e06c75",
      "color-surface": "#1a1a1e",
      "color-accent-text": "#ffffff",
      "color-interactive": "#7b8cde",
    });
    expect(merged["color-danger-bg"]).toBeUndefined();
    expect(merged["color-alert-error"]).toBeUndefined();
    expect(merged["color-surface"]).toBeUndefined();
    expect(merged["color-accent-text"]).toBeUndefined();
    expect(merged["color-interactive"]).toBeUndefined();
    expect(merged["color-bg"]).toBe("#000");
  });

  it("stripDerivedThemeTokens removes retired keys only", () => {
    const stripped = stripDerivedThemeTokens({
      "color-bg": "#111",
      "color-text-muted": "#6a6a7a",
      "color-border": "#222",
    });
    expect(stripped).toEqual({ "color-bg": "#111" });
  });

  it("applyTheme writes authorable tokens and clears derived overrides", () => {
    const root = document.documentElement;
    root.style.setProperty("--color-danger-bg", "#2a1518");
    root.style.setProperty("--color-alert-error", "#e06c75");
    root.style.setProperty("--color-surface", "#1a1a1e");

    const theme = makeTheme("core.test", "Test");
    applyTheme(theme);
    const tokens = resolveThemeTokens(theme);

    expect(root.style.getPropertyValue("--color-accent")).toBe(
      tokens["color-accent"],
    );
    expect(root.style.getPropertyValue("--color-danger")).toBe(
      tokens["color-danger"],
    );
    expect(root.style.getPropertyValue("--font-ui")).toBe(
      resolveFontStack(theme.tokens["font-ui"]),
    );
    expect(root.style.getPropertyValue("--color-danger-bg")).toBe("");
    expect(root.style.getPropertyValue("--color-alert-error")).toBe("");
    expect(root.style.getPropertyValue("--color-surface")).toBe("");
    expect(root.style.getPropertyValue("--color-accent-text")).toBe("");
    expect(root.dataset.appearance).toBe("dark");
  });

  it("marks cream paper as a light appearance", () => {
    const theme = makeTheme("core.test", "Test");
    theme.tokens["color-bg"] = "#f3f1e4";
    applyTheme(theme);
    expect(document.documentElement.dataset.appearance).toBe("light");
  });

  it("applyTheme with transition toggles theme-transition on html", () => {
    const theme = makeTheme("core.test", "Test");
    applyTheme(theme, { transition: true });
    expect(
      document.documentElement.classList.contains("theme-transition"),
    ).toBe(true);
    applyTheme(theme, { transition: false });
    expect(
      document.documentElement.classList.contains("theme-transition"),
    ).toBe(false);
  });
});

describe("windowAppearanceForBackground", () => {
  it("maps cream paper to light and near-black to dark", () => {
    expect(windowAppearanceForBackground("#f3f1e4")).toBe("light");
    expect(windowAppearanceForBackground("#0e0e10")).toBe("dark");
  });

  it("defaults unknown colors to dark", () => {
    expect(windowAppearanceForBackground(undefined)).toBe("dark");
    expect(windowAppearanceForBackground("oklch(0.5 0.1 120)")).toBe("dark");
  });
});
