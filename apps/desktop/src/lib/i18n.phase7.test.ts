import { afterEach, describe, expect, it } from "vitest";
import {
  compareLocalized,
  DEFAULT_APP_LOCALE,
  getAppLocale,
  getIntlLocale,
  STUB_APP_LOCALE,
} from "./appLocale";
import { formatDateAdded } from "./format";
import { i18n, setAppLocale, t } from "./i18n";

async function restoreEnglish(): Promise<void> {
  await setAppLocale(DEFAULT_APP_LOCALE);
}

afterEach(async () => {
  await restoreEnglish();
});

describe("i18n Phase 7 catalogs and switching", () => {
  it("switches the stub locale and falls back to English for missing keys", async () => {
    expect(t("common:unknownArtist")).toBe("Unknown Artist");
    await setAppLocale(STUB_APP_LOCALE);
    expect(getAppLocale()).toBe("de");
    expect(i18n.language).toBe("de");
    expect(t("common:unknownArtist")).toBe("Unbekannter Interpret");
    expect(t("common:unknownAlbum")).toBe("Unbekanntes Album");
    expect(t("library:views.tracks.title")).toBe("Tracks");
  });
});

describe("locale-aware formatters", () => {
  const iso = "2024-01-15T12:00:00.000Z";

  it("formats dates with the app locale", async () => {
    await setAppLocale("en");
    const english = formatDateAdded(iso);
    await setAppLocale("de");
    const german = formatDateAdded(iso);
    expect(english).not.toBe(german);
    expect(english).toMatch(/Jan/);
    expect(german).toMatch(/Jan/);
    expect(getIntlLocale()).toBe("de");
  });

  it("sorts with the app locale collator", async () => {
    await setAppLocale("en");
    expect(compareLocalized("Alpha", "Beta")).toBeLessThan(0);
    await setAppLocale("de");
    expect(compareLocalized("Alpha", "Beta")).toBeLessThan(0);
    expect(getIntlLocale()).toBe("de");
  });
});
