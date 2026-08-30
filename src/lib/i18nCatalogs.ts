import enCommon from "../locales/en/common.json";
import enDialogs from "../locales/en/dialogs.json";
import enErrors from "../locales/en/errors.json";
import enLibrary from "../locales/en/library.json";
import enMenus from "../locales/en/menus.json";
import enPlayback from "../locales/en/playback.json";
import enPreferences from "../locales/en/preferences.json";
import enStudio from "../locales/en/studio.json";
import enToasts from "../locales/en/toasts.json";

import deCommon from "../locales/de/common.json";
import deErrors from "../locales/de/errors.json";
import deMenus from "../locales/de/menus.json";

export const I18N_NAMESPACES = [
  "common",
  "dialogs",
  "errors",
  "library",
  "menus",
  "playback",
  "preferences",
  "studio",
  "toasts",
] as const;

export const DEFAULT_I18N_NAMESPACE = "common" as const;

/** English catalogs — source of truth for keys and typed unions. */
const enResources = {
  common: enCommon,
  dialogs: enDialogs,
  errors: enErrors,
  library: enLibrary,
  menus: enMenus,
  playback: enPlayback,
  preferences: enPreferences,
  studio: enStudio,
  toasts: enToasts,
} as const;

/** Partial German stub — missing keys fall back to English. */
const deResources = {
  common: deCommon,
  errors: deErrors,
  menus: deMenus,
} as const;

export const i18nResources = {
  en: enResources,
  de: deResources,
} as const;
