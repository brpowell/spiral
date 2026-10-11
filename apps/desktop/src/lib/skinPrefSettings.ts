import type { SkinSetting } from "../types/skin";
import type { SkinUserPreferences } from "../types/skinPreferences";

export function findSkinSetting(
  settings: readonly SkinSetting[] | undefined,
  id: string,
): SkinSetting | undefined {
  return settings?.find((setting) => setting.id === id);
}

export function evaluateAuthorSkinPref(
  id: string,
  settings: readonly SkinSetting[] | undefined,
  preferences: SkinUserPreferences,
): boolean | null {
  const setting = findSkinSetting(settings, id);
  if (!setting || setting.type !== "boolean") return null;
  const stored = preferences.custom?.[id];
  if (typeof stored === "boolean") return stored;
  return setting.default;
}

export function toggledBooleanCustomPref(
  preferences: SkinUserPreferences,
  id: string,
  current: boolean,
): SkinUserPreferences {
  return {
    ...preferences,
    custom: {
      ...preferences.custom,
      [id]: !current,
    },
  };
}

export function setBooleanCustomPref(
  preferences: SkinUserPreferences,
  id: string,
  value: boolean,
): SkinUserPreferences {
  return {
    ...preferences,
    custom: {
      ...preferences.custom,
      [id]: value,
    },
  };
}
