export const APP_LOCALES = ["en", "de"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "en";

/** Stub locale used to prove catalog + Intl switching. Not a product language. */
export const STUB_APP_LOCALE: AppLocale = "de";

const STORAGE_KEY = "spiral.locale";

let currentLocale: AppLocale = DEFAULT_APP_LOCALE;

export function isAppLocale(
  value: string | null | undefined,
): value is AppLocale {
  return value != null && (APP_LOCALES as readonly string[]).includes(value);
}

export function readStoredAppLocale(): AppLocale {
  if (typeof localStorage === "undefined") return DEFAULT_APP_LOCALE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isAppLocale(stored) ? stored : DEFAULT_APP_LOCALE;
  } catch {
    return DEFAULT_APP_LOCALE;
  }
}

/** DEV-only menu label. Reloads after persist so module-level `t()` picks up the catalog. */
export function stubLocaleMenuLabel(): string {
  return currentLocale === STUB_APP_LOCALE
    ? "Language: English"
    : "Language: German (stub)";
}

export function toggleStubLocaleAndReload(): void {
  const next =
    currentLocale === STUB_APP_LOCALE ? DEFAULT_APP_LOCALE : STUB_APP_LOCALE;
  persistAppLocale(next);
  syncAppLocale(next);
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export function persistAppLocale(locale: AppLocale): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore quota / privacy mode — in-memory locale still applies.
  }
}

/** Keep formatters/sorts in sync with i18n without importing the i18n module. */
export function syncAppLocale(locale: AppLocale): void {
  currentLocale = locale;
}

export function getAppLocale(): AppLocale {
  return currentLocale;
}

/** BCP 47 tag for `Intl` / `localeCompare`. */
export function getIntlLocale(): string {
  return currentLocale;
}

export function compareLocalized(
  a: string,
  b: string,
  options?: Intl.CollatorOptions,
): number {
  return a.localeCompare(b, getIntlLocale(), {
    sensitivity: "base",
    ...options,
  });
}
