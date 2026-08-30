import i18n, { type TOptions } from "i18next";
import { initReactI18next } from "react-i18next";

import {
  type AppLocale,
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  isAppLocale,
  persistAppLocale,
  readStoredAppLocale,
  syncAppLocale,
} from "./appLocale";
import {
  DEFAULT_I18N_NAMESPACE,
  I18N_NAMESPACES,
  i18nResources,
} from "./i18nCatalogs";
import type { TranslationKey } from "./i18nKeys";

const initialLocale = readStoredAppLocale();
syncAppLocale(initialLocale);

const reportMissingKeys =
  import.meta.env.DEV && import.meta.env.MODE !== "test";

function applyDocumentLang(locale: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

void i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: initialLocale,
  fallbackLng: DEFAULT_APP_LOCALE,
  supportedLngs: [...APP_LOCALES],
  ns: [...I18N_NAMESPACES],
  defaultNS: DEFAULT_I18N_NAMESPACE,
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: reportMissingKeys,
  missingKeyHandler: reportMissingKeys
    ? (_lngs, ns, key) => {
        console.error(`[i18n] Missing key: ${ns}:${key}`);
      }
    : undefined,
});

i18n.on("languageChanged", (lng) => {
  const locale = isAppLocale(lng) ? lng : DEFAULT_APP_LOCALE;
  syncAppLocale(locale);
  applyDocumentLang(locale);
});

applyDocumentLang(initialLocale);

/** Imperative translator for non-React modules (toasts, menus, lib helpers). */
export function t(key: TranslationKey, options?: TOptions): string {
  return i18n.t(key, options);
}

/** Dynamic / interpolated keys that cannot be named in the generated union. */
export function tUnchecked(key: string, options?: TOptions): string {
  return i18n.t(key, options);
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  persistAppLocale(locale);
  syncAppLocale(locale);
  applyDocumentLang(locale);
  await i18n.changeLanguage(locale);
}

export { i18n };
export type { TranslationKey };
