import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import common from "../locales/en/common.json";
import dialogs from "../locales/en/dialogs.json";
import library from "../locales/en/library.json";
import menus from "../locales/en/menus.json";
import playback from "../locales/en/playback.json";
import preferences from "../locales/en/preferences.json";
import studio from "../locales/en/studio.json";
import toasts from "../locales/en/toasts.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common,
      dialogs,
      library,
      menus,
      playback,
      preferences,
      studio,
      toasts,
    },
  },
  lng: "en",
  fallbackLng: "en",
  ns: [
    "common",
    "dialogs",
    "library",
    "menus",
    "playback",
    "preferences",
    "studio",
    "toasts",
  ],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Imperative translator for non-React modules (toasts, menus, lib helpers). */
export const t = i18n.t.bind(i18n);

export { i18n };
