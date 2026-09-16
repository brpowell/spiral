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
import { spiralCardInstallErrorPayload } from "./toastPayloads";
import { parseUserErrorCode, translateUserError } from "./userError";

async function restoreEnglish(): Promise<void> {
  await setAppLocale(DEFAULT_APP_LOCALE);
}

afterEach(async () => {
  await restoreEnglish();
});

describe("i18n Phase 7 catalogs and switching", () => {
  it("resolves license error codes from the errors namespace", () => {
    expect(t("errors:license.installing.not_found")).toBe(
      "That Spiral Card file couldn't be found.",
    );
    expect(t("errors:license.installing.unreadable.title")).toBe(
      "Couldn't read that Spiral Card",
    );
    expect(t("errors:license.installed.unreadable.title")).toBe(
      "Couldn't read that Spiral Card",
    );
    expect(t("errors:license.installed.unverified.title")).toBe(
      "This Spiral Card couldn't be verified",
    );
    expect(t("errors:license.installed.legacy_format")).toContain(
      "older format",
    );
  });

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

describe("Rust user-error codes", () => {
  it("parses license codes and ignores raw English", () => {
    expect(parseUserErrorCode("license.installing.not_found")).toBe(
      "license.installing.not_found",
    );
    expect(parseUserErrorCode(new Error("license.installing.unreadable"))).toBe(
      "license.installing.unreadable",
    );
    expect(parseUserErrorCode("Couldn't read that file")).toBeNull();
    expect(parseUserErrorCode("license.handoff.expired")).toBe(
      "license.handoff.expired",
    );
  });

  it("translates codes and ignores raw English", async () => {
    expect(translateUserError("license.installing.not_found")).toBe(
      "That Spiral Card file couldn't be found.",
    );
    expect(translateUserError("Decoder error: unsupported codec")).toBeNull();
    await setAppLocale("de");
    expect(translateUserError("license.installing.not_found")).toBe(
      "Diese Spiral-Card-Datei wurde nicht gefunden.",
    );
  });

  it("uses translated copy on the Spiral Card install toast", () => {
    expect(
      spiralCardInstallErrorPayload("license.installing.not_found").label,
    ).toBe("That Spiral Card file couldn't be found.");
    expect(
      spiralCardInstallErrorPayload(new Error("raw encoder failure")).label,
    ).toBe("Failed to install Spiral Card");
    expect(
      spiralCardInstallErrorPayload("license.handoff.network"),
    ).toMatchObject({
      label: "Something went wrong",
      detail: "Check your connection and try adding your Spiral Card again.",
    });
    expect(
      spiralCardInstallErrorPayload("license.handoff.expired"),
    ).toMatchObject({
      label: "Something went wrong",
      detail: "Try adding your Spiral Card again.",
    });
    expect(
      spiralCardInstallErrorPayload("license.installing.expired"),
    ).toMatchObject({
      label: "This Spiral Card copy is no longer valid",
      detail: "Grab a fresh one from the member portal and add it.",
    });
    expect(
      spiralCardInstallErrorPayload("license.installing.unverified"),
    ).toMatchObject({
      label: "This Spiral Card couldn't be verified",
      detail: "Head to the member portal to grab a fresh copy",
    });
    expect(
      spiralCardInstallErrorPayload("license.installing.unreadable")
        .actions?.[0]?.label,
    ).toBe("Go to member portal");
    expect(
      spiralCardInstallErrorPayload("license.handoff.invalid"),
    ).toMatchObject({
      label: "Something went wrong",
      detail: "Try adding your Spiral Card again.",
    });
  });
});
