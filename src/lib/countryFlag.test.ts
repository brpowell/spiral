import { describe, expect, it } from "vitest";
import { countryFlagEmoji, formatCountryDisplay } from "./countryFlag";

describe("countryFlagEmoji", () => {
  it("renders ISO alpha-2 codes as regional indicator flags", () => {
    expect(countryFlagEmoji("gb")).toBe("🇬🇧");
    expect(countryFlagEmoji("US")).toBe("🇺🇸");
  });

  it("maps MusicBrainz special area codes", () => {
    expect(countryFlagEmoji("XE")).toBe("🇪🇺");
    expect(countryFlagEmoji("XW")).toBe("🌐");
  });

  it("returns null for unknown or invalid codes", () => {
    expect(countryFlagEmoji("XU")).toBeNull();
    expect(countryFlagEmoji("")).toBeNull();
    expect(countryFlagEmoji("USA")).toBeNull();
  });
});

describe("formatCountryDisplay", () => {
  it("prefixes the code with a flag when available", () => {
    expect(formatCountryDisplay("gb")).toBe("🇬🇧 GB");
  });

  it("falls back to the bare code when no flag exists", () => {
    expect(formatCountryDisplay("XU")).toBe("XU");
  });
});
