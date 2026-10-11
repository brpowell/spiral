import { describe, expect, it } from "vitest";
import {
  evaluateAuthorSkinPref,
  setBooleanCustomPref,
  toggledBooleanCustomPref,
} from "./skinPrefSettings";
import { defaultSkinUserPreferences } from "../types/skinPreferences";
import type { SkinSetting } from "../types/skin";

const hideHelpBubble: SkinSetting = {
  id: "hideHelpBubble",
  name: "Hide help bubble",
  type: "boolean",
  default: false,
};

describe("skinPrefSettings", () => {
  it("returns manifest default when custom is absent", () => {
    expect(
      evaluateAuthorSkinPref(
        "hideHelpBubble",
        [hideHelpBubble],
        defaultSkinUserPreferences(),
      ),
    ).toBe(false);
  });

  it("returns stored custom boolean when present", () => {
    expect(
      evaluateAuthorSkinPref("hideHelpBubble", [hideHelpBubble], {
        builtin: {},
        custom: { hideHelpBubble: true },
      }),
    ).toBe(true);
  });

  it("ignores mistyped stored values and falls back to default", () => {
    expect(
      evaluateAuthorSkinPref("hideHelpBubble", [hideHelpBubble], {
        builtin: {},
        custom: { hideHelpBubble: "yes" },
      }),
    ).toBe(false);
  });

  it("returns null for undeclared settings", () => {
    expect(
      evaluateAuthorSkinPref(
        "missing",
        [hideHelpBubble],
        defaultSkinUserPreferences(),
      ),
    ).toBeNull();
  });

  it("toggles and sets boolean custom prefs", () => {
    const toggled = toggledBooleanCustomPref(
      defaultSkinUserPreferences(),
      "hideHelpBubble",
      false,
    );
    expect(toggled.custom?.hideHelpBubble).toBe(true);

    const set = setBooleanCustomPref(
      defaultSkinUserPreferences(),
      "hideHelpBubble",
      true,
    );
    expect(set.custom?.hideHelpBubble).toBe(true);
  });
});
