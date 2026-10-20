import { describe, expect, it } from "vitest";
import type { Theme } from "../types/theme";
import {
  formatThemeValidationError,
  isThemeApplicable,
  validateThemeForApply,
  validateThemeForSave,
} from "./themeValidation";

function makeTheme(
  partial?: Partial<Theme> & { replaceTokens?: boolean },
): Theme {
  const baseTokens = {
    "color-bg": "#000",
    "color-text-primary": "#fff",
    "color-accent": "#00f",
    "color-danger": "#f00",
    "font-ui": "system-ui",
  };
  const { tokens: partialTokens, replaceTokens, ...rest } = partial ?? {};
  return {
    id: "my-theme.theme",
    name: "My Theme",
    author: "",
    description: "",
    publisherId: "spiral",
    version: "0.0.0",
    zone: "linked",
    mutable: true,
    ...rest,
    tokens: replaceTokens
      ? { ...(partialTokens ?? {}) }
      : { ...baseTokens, ...partialTokens },
  };
}

describe("validateThemeForSave", () => {
  it("allows incomplete drafts", () => {
    const issues = validateThemeForSave(
      makeTheme({
        name: "",
        tokens: { "color-bg": "#000" },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("rejects non-mutable themes", () => {
    const issues = validateThemeForSave(makeTheme({ mutable: false }));
    expect(issues.some((i) => i.field === "mutable")).toBe(true);
  });
});

describe("validateThemeForApply", () => {
  it("passes a complete theme", () => {
    expect(validateThemeForApply(makeTheme())).toEqual([]);
    expect(isThemeApplicable(makeTheme())).toBe(true);
  });

  it("blocks missing name", () => {
    const issues = validateThemeForApply(makeTheme({ name: "  " }));
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("blocks missing required tokens", () => {
    const issues = validateThemeForApply(
      makeTheme({
        tokens: {
          "color-bg": "",
        },
      }),
    );
    expect(issues.some((i) => i.field === "tokens.color-bg")).toBe(true);

    expect(
      isThemeApplicable(makeTheme({ replaceTokens: true, tokens: {} })),
    ).toBe(false);
  });

  it("formats multi-issue errors", () => {
    const issues = validateThemeForApply(
      makeTheme({ name: "", replaceTokens: true, tokens: {} }),
    );
    expect(formatThemeValidationError(issues)).toMatch(/\+\d+ more/);
  });
});
