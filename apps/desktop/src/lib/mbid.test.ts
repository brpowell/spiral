import { describe, expect, it } from "vitest";
import { isValidUuidMbid, normalizeMbid, parseUuidMbid } from "./mbid";
import {
  musicBrainzEntityUrl,
  musicBrainzHitFacts,
  musicBrainzHitTitle,
} from "./musicBrainzEntityDisplay";
import type { MusicBrainzEntityHit } from "../types/musicbrainz";

describe("mbid", () => {
  it("normalizes and validates hyphenated UUIDs", () => {
    expect(normalizeMbid("  ABC ")).toBe("abc");
    expect(normalizeMbid("")).toBeNull();
    expect(parseUuidMbid("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(parseUuidMbid("not-a-uuid")).toBeNull();
    expect(parseUuidMbid("550e8400e29b41d4a716446655440000")).toBeNull();
    expect(isValidUuidMbid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
});

describe("musicBrainzEntityDisplay", () => {
  const release: MusicBrainzEntityHit = {
    kind: "release",
    mbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    title: "OK Computer",
    artist: "Radiohead",
    disambiguation: "special edition",
    year: 1997,
    country: "GB",
    label: "Parlophone",
    trackCount: 12,
  };

  it("builds entity URLs", () => {
    expect(
      musicBrainzEntityUrl("recording", "550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(
      "https://musicbrainz.org/recording/550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("formats titles with disambiguation", () => {
    expect(musicBrainzHitTitle(release)).toBe("OK Computer (special edition)");
  });

  it("formats assigned-card facts with labels", () => {
    expect(musicBrainzHitFacts(release)).toEqual([
      { key: "year", label: "Year", value: "1997" },
      { key: "country", label: "Country", value: "🇬🇧 GB" },
      { key: "tracks", label: "Tracks", value: "12" },
      { key: "artist", label: "Artist", value: "Radiohead" },
      { key: "label", label: "Label", value: "Parlophone" },
    ]);
  });

  it("can omit facts shown elsewhere as a subtitle", () => {
    expect(musicBrainzHitFacts(release, { omit: ["artist"] })).toEqual([
      { key: "year", label: "Year", value: "1997" },
      { key: "country", label: "Country", value: "🇬🇧 GB" },
      { key: "tracks", label: "Tracks", value: "12" },
      { key: "label", label: "Label", value: "Parlophone" },
    ]);
  });

  it("omits empty assigned-card facts", () => {
    const recording: MusicBrainzEntityHit = {
      kind: "recording",
      mbid: "550e8400-e29b-41d4-a716-446655440000",
      title: "Paranoid Android",
      artist: "Radiohead",
    };
    expect(musicBrainzHitFacts(recording)).toEqual([
      { key: "artist", label: "Artist", value: "Radiohead" },
    ]);
  });

  it("formats artist facts with type and from", () => {
    const artist: MusicBrainzEntityHit = {
      kind: "artist",
      mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
      title: "Radiohead",
      entityType: "Group",
      area: "United Kingdom",
      country: "GB",
    };
    expect(musicBrainzHitFacts(artist)).toEqual([
      { key: "type", label: "Type", value: "Group" },
      { key: "from", label: "From", value: "🇬🇧 United Kingdom" },
    ]);
  });
});
