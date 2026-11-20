import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("bundled flag font", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("declares the face for regional indicators and ships the file", () => {
    const css = read("src/styles/fonts.css");
    expect(css).toContain('font-family: "Twemoji Country Flags"');
    expect(css).toContain("U+1F1E6-1F1FF");
    expect(
      existsSync(
        join(process.cwd(), "src/assets/fonts/twemoji-country-flags.woff2"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), "src/assets/fonts/CC-BY-Twemoji-Country-Flags.txt"),
      ),
    ).toBe(true);
  });

  it("is applied where flags are rendered", () => {
    const css = read(
      "src/components/MusicBrainzEditorTab/MusicBrainzEntityCard.css",
    );
    expect(css).toMatch(
      /\.musicbrainz-entity-facts__value\s*\{[^}]*Twemoji Country Flags/,
    );
  });
});
