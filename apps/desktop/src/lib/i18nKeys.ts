import { i18nResources } from "./i18nCatalogs";

type EnResources = (typeof i18nResources)["en"];

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

type StripPluralSuffix<K extends string> =
  K extends `${infer Base}_${PluralSuffix}` ? Base : K;

type NestedKeyOf<T> =
  T extends Record<string, unknown>
    ? {
        [K in keyof T & string]: T[K] extends Record<string, unknown>
          ? `${K}.${NestedKeyOf<T[K]>}`
          : StripPluralSuffix<K> | K;
      }[keyof T & string]
    : never;

/** `ns:dotted.path` union generated from `src/locales/en/*.json`. */
export type TranslationKey = {
  [N in keyof EnResources]: `${N & string}:${NestedKeyOf<EnResources[N]>}`;
}[keyof EnResources];
