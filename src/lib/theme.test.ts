import { describe, expect, it } from "vitest";
import type { Theme } from "../types/theme";
import {
  DEFAULT_THEME_ID,
  findThemeById,
  resolveActiveThemeId,
} from "./theme";

function makeTheme(id: string, name: string): Theme {
  return {
    id,
    name,
    author: "Spiral",
    description: "",
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
  makeTheme("obsidian", "Obsidian"),
  makeTheme("parchment", "Parchment"),
  makeTheme("noir", "Noir"),
  makeTheme("grove", "Grove"),
];

describe("findThemeById", () => {
  it("finds by stable id", () => {
    expect(findThemeById(themes, "parchment")?.name).toBe("Parchment");
  });

  it("does not match display name", () => {
    expect(findThemeById(themes, "Parchment")).toBeUndefined();
  });
});

describe("resolveActiveThemeId", () => {
  it("keeps an existing id", () => {
    expect(resolveActiveThemeId(themes, "grove")).toBe("grove");
  });

  it("migrates a legacy display name to id", () => {
    expect(resolveActiveThemeId(themes, "Obsidian")).toBe("obsidian");
    expect(resolveActiveThemeId(themes, "Parchment")).toBe("parchment");
  });

  it("falls back to default for unknown values", () => {
    expect(resolveActiveThemeId(themes, "not-a-theme")).toBe(DEFAULT_THEME_ID);
  });

  it("defaults to obsidian", () => {
    expect(DEFAULT_THEME_ID).toBe("obsidian");
  });
});
