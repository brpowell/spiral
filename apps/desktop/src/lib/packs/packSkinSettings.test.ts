import { describe, expect, it } from "vitest";
import {
  authorSettingOverrideIds,
  clearableSkinSettingsFromLoaded,
  withoutAuthorSettingOverrides,
} from "./packSkinSettings";
import type { SkinSetting } from "../../types/skin";
import { defaultSkinUserPreferences } from "../../types/skinPreferences";

const hideHelpBubble: SkinSetting = {
  id: "hideHelpBubble",
  name: "Hide help bubble",
  type: "boolean",
  default: false,
};

describe("packSkinSettings", () => {
  it("lists declared setting ids that have custom overrides", () => {
    expect(
      authorSettingOverrideIds([hideHelpBubble], defaultSkinUserPreferences()),
    ).toEqual([]);
    expect(
      authorSettingOverrideIds([hideHelpBubble], {
        builtin: {},
        custom: { hideHelpBubble: true },
      }),
    ).toEqual(["hideHelpBubble"]);
  });

  it("ignores orphan custom keys that are not declared settings", () => {
    expect(
      authorSettingOverrideIds([hideHelpBubble], {
        builtin: {},
        custom: { leftover: true },
      }),
    ).toEqual([]);
  });

  it("strips listed custom keys and drops an empty custom bag", () => {
    const next = withoutAuthorSettingOverrides(
      {
        builtin: { soundEffectsEnabled: false },
        custom: { hideHelpBubble: true, leftover: 1 },
      },
      ["hideHelpBubble"],
    );
    expect(next.builtin.soundEffectsEnabled).toBe(false);
    expect(next.custom).toEqual({ leftover: 1 });

    const emptied = withoutAuthorSettingOverrides(
      { builtin: {}, custom: { hideHelpBubble: true } },
      ["hideHelpBubble"],
    );
    expect(emptied.custom).toBeUndefined();
  });

  it("only marks skins that have declared overrides as clearable", () => {
    expect(
      clearableSkinSettingsFromLoaded([
        {
          skinId: "a",
          settings: [hideHelpBubble],
          preferences: defaultSkinUserPreferences(),
        },
        {
          skinId: "b",
          settings: [hideHelpBubble],
          preferences: { builtin: {}, custom: { hideHelpBubble: true } },
        },
      ]),
    ).toEqual([{ skinId: "b", settingIds: ["hideHelpBubble"] }]);
  });
});
