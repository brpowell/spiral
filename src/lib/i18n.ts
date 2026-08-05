import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import common from "../locales/en/common.json";
import library from "../locales/en/library.json";
import playback from "../locales/en/playback.json";
import preferences from "../locales/en/preferences.json";
import studio from "../locales/en/studio.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common,
      library,
      playback,
      preferences,
      studio,
    },
  },
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "library", "playback", "preferences", "studio"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Imperative translator for non-React modules (toasts, menus, lib helpers). */
export const t = i18n.t.bind(i18n);

export { i18n };
