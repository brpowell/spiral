import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import common from "../locales/en/common.json";
import library from "../locales/en/library.json";
import playback from "../locales/en/playback.json";
import preferences from "../locales/en/preferences.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common,
      library,
      playback,
      preferences,
    },
  },
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "library", "playback", "preferences"],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Imperative translator for non-React modules (toasts, menus, lib helpers). */
export const t = i18n.t.bind(i18n);

export { i18n };
