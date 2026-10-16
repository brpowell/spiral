import { getSkinPreferences, loadSkinPack, saveSkinPreferences } from "../tauri";
import type { PackSummary } from "../../types/pack";
import type { SkinSetting } from "../../types/skin";
import type { SkinUserPreferences } from "../../types/skinPreferences";

export interface ClearableSkinSetting {
  skinId: string;
  settingIds: string[];
}

export function packSkinContributionIds(pack: PackSummary): string[] {
  return pack.contributions
    .filter((contribution) => contribution.type === "skin")
    .map((contribution) => contribution.effectiveId);
}

export function authorSettingOverrideIds(
  settings: readonly SkinSetting[] | undefined,
  preferences: SkinUserPreferences,
): string[] {
  if (!settings?.length) return [];
  const custom = preferences.custom;
  if (!custom) return [];
  return settings
    .filter((setting) => Object.hasOwn(custom, setting.id))
    .map((setting) => setting.id);
}

export function withoutAuthorSettingOverrides(
  preferences: SkinUserPreferences,
  settingIds: readonly string[],
): SkinUserPreferences {
  if (settingIds.length === 0 || !preferences.custom) return preferences;
  const custom = { ...preferences.custom };
  for (const id of settingIds) {
    delete custom[id];
  }
  if (Object.keys(custom).length === 0) {
    const next = { ...preferences };
    delete next.custom;
    return next;
  }
  return { ...preferences, custom };
}

export function clearableSkinSettingsFromLoaded(
  skins: ReadonlyArray<{
    skinId: string;
    settings?: readonly SkinSetting[];
    preferences: SkinUserPreferences;
  }>,
): ClearableSkinSetting[] {
  const clearable: ClearableSkinSetting[] = [];
  for (const skin of skins) {
    const settingIds = authorSettingOverrideIds(skin.settings, skin.preferences);
    if (settingIds.length > 0) {
      clearable.push({ skinId: skin.skinId, settingIds });
    }
  }
  return clearable;
}

export async function collectClearablePackSkinSettings(
  pack: PackSummary,
): Promise<ClearableSkinSetting[]> {
  return collectClearableSkinSettings(packSkinContributionIds(pack));
}

/** Author-declared skin settings the user has overridden, for the given skin ids. */
export async function collectClearableSkinSettings(
  skinIds: readonly string[],
): Promise<ClearableSkinSetting[]> {
  const loaded = await Promise.all(
    skinIds.map(async (skinId) => {
      try {
        const [loadedPack, preferences] = await Promise.all([
          loadSkinPack(skinId),
          getSkinPreferences(skinId),
        ]);
        return {
          skinId,
          settings: loadedPack.manifest.settings,
          preferences,
        };
      } catch {
        return null;
      }
    }),
  );
  return clearableSkinSettingsFromLoaded(
    loaded.filter((entry): entry is NonNullable<typeof entry> => entry != null),
  );
}

export async function clearPackAuthorSkinSettings(
  entries: readonly ClearableSkinSetting[],
): Promise<void> {
  for (const entry of entries) {
    const current = await getSkinPreferences(entry.skinId);
    const next = withoutAuthorSettingOverrides(current, entry.settingIds);
    await saveSkinPreferences(entry.skinId, next);
  }
}
