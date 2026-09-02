import { describe, expect, it } from "vitest";
import {
  authorSettingOverrideIds,
  clearableSkinSettingsFromLoaded,
  packSkinContributionIds,
  withoutAuthorSettingOverrides,
} from "./packSkinSettings";
import type { PackSummary } from "../../types/pack";
import type { SkinSetting } from "../../types/skin";
import { defaultSkinUserPreferences } from "../../types/skinPreferences";

const hideHelpBubble: SkinSetting = {
  id: "hideHelpBubble",
  name: "Hide help bubble",
  type: "boolean",
  default: false,
};

function packWithSkins(ids: string[]): PackSummary {
  return {
    packId: "lost-planet",
    authorId: "skins-factory",
    version: "1.0.0",
    name: "Lost Planet",
    description: "",
    zone: "installed",
    packDir: "/tmp/lost-planet",
    active: false,
    contributions: ids.map((effectiveId) => ({
      type: "skin",
      localId: "lost-planet",
      effectiveId,
      name: "Lost Planet",
      author: "",
      hidden: false,
    })),
  };
}

describe("packSkinSettings", () => {
  it("collects skin contribution ids from a pack", () => {
    const pack = packWithSkins(["skins-factory.lost-planet.skin.lost-planet"]);
    pack.contributions.push({
      type: "theme",
      localId: "noir",
      effectiveId: "skins-factory.lost-planet.theme.noir",
      name: "Noir",
      author: "",
      hidden: false,
    });
    expect(packSkinContributionIds(pack)).toEqual([
      "skins-factory.lost-planet.skin.lost-planet",
    ]);
  });

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
