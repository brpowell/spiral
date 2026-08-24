import { describe, expect, it } from "vitest";
import {
  discMetadataOverrideHasEdits,
  mergeDiscDisplayLayers,
  mergeOverridesIntoDisc,
  mergeRemoteMetadataIntoDisc,
  selectedDiscFromLookup,
} from "./cdMetadata";
import type { CdDisc, DiscMetadata, DiscMetadataOverride } from "../types/cd";

function sampleDisc(overrides: Partial<CdDisc> = {}): CdDisc {
  return {
    driveId: "drive-1",
    discId: "disc-abc",
    album: "Raw Album",
    artist: "Raw Artist",
    tracks: [
      { number: 1, title: "Track 1", artist: null, durationSeconds: 100 },
      { number: 2, title: "Track 2", artist: null, durationSeconds: 120 },
    ],
    ...overrides,
  };
}

describe("mergeRemoteMetadataIntoDisc", () => {
  it("overlays album and track titles from MusicBrainz", () => {
    const remote: DiscMetadata = {
      discId: "disc-abc",
      album: "MB Album",
      albumArtist: "MB Artist",
      year: 1999,
      genre: "Rock",
      tracks: [
        { number: 1, title: "MB One", artist: "Solo" },
        { number: 2, title: "MB Two" },
      ],
    };
    const merged = mergeRemoteMetadataIntoDisc(sampleDisc(), remote);
    expect(merged.album).toBe("MB Album");
    expect(merged.artist).toBe("MB Artist");
    expect(merged.year).toBe(1999);
    expect(merged.genre).toBe("Rock");
    expect(merged.tracks[0].title).toBe("MB One");
    expect(merged.tracks[0].artist).toBe("Solo");
    expect(merged.tracks[1].title).toBe("MB Two");
  });

  it("keeps existing disc genre when MusicBrainz has none", () => {
    const remote: DiscMetadata = {
      album: "MB Album",
      albumArtist: "MB Artist",
      tracks: [{ number: 1, title: "MB One" }],
    };
    const merged = mergeRemoteMetadataIntoDisc(
      sampleDisc({ genre: "Jazz" }),
      remote,
    );
    expect(merged.genre).toBe("Jazz");
  });
});

describe("mergeOverridesIntoDisc", () => {
  it("applies user overrides above remote metadata", () => {
    const remote: DiscMetadata = {
      album: "MB Album",
      albumArtist: "MB Artist",
      year: 1999,
      tracks: [
        { number: 1, title: "MB One" },
        { number: 2, title: "MB Two" },
      ],
    };
    const withRemote = mergeRemoteMetadataIntoDisc(sampleDisc(), remote);
    const override: DiscMetadataOverride = {
      album: "Edited Album",
      year: 2001,
      genre: "Rock",
      tracks: {
        "1": { title: "Edited One", rating: 204 },
      },
    };
    const merged = mergeOverridesIntoDisc(withRemote, override);
    expect(merged.album).toBe("Edited Album");
    expect(merged.artist).toBe("MB Artist");
    expect(merged.year).toBe(2001);
    expect(merged.genre).toBe("Rock");
    expect(merged.tracks[0].title).toBe("Edited One");
    expect(merged.tracks[0].rating).toBe(204);
    expect(merged.tracks[1].title).toBe("MB Two");
  });

  it("is a no-op for empty overrides", () => {
    const disc = sampleDisc();
    expect(mergeOverridesIntoDisc(disc, {})).toBe(disc);
    expect(mergeOverridesIntoDisc(disc, null)).toBe(disc);
  });
});

describe("mergeDiscDisplayLayers", () => {
  it("stacks remote then overrides", () => {
    const remote: DiscMetadata = {
      album: "MB Album",
      albumArtist: "MB Artist",
      year: 1999,
      tracks: [
        { number: 1, title: "MB One" },
        { number: 2, title: "MB Two" },
      ],
    };
    const override: DiscMetadataOverride = {
      album: "Edited",
      tracks: { "1": { title: "Edited One" } },
    };
    const merged = mergeDiscDisplayLayers(sampleDisc(), remote, override);
    expect(merged.album).toBe("Edited");
    expect(merged.artist).toBe("MB Artist");
    expect(merged.year).toBe(1999);
    expect(merged.tracks[0].title).toBe("Edited One");
    expect(merged.tracks[1].title).toBe("MB Two");
  });
});

describe("discMetadataOverrideHasEdits", () => {
  it("detects album and track edits", () => {
    expect(discMetadataOverrideHasEdits(undefined)).toBe(false);
    expect(discMetadataOverrideHasEdits({})).toBe(false);
    expect(discMetadataOverrideHasEdits({ album: "X" })).toBe(true);
    expect(
      discMetadataOverrideHasEdits({
        tracks: { "1": { title: "T" } },
      }),
    ).toBe(true);
    expect(
      discMetadataOverrideHasEdits({
        tracks: { "1": { rating: 128 } },
      }),
    ).toBe(true);
  });
});

describe("selectedDiscFromLookup", () => {
  const album = (releaseMbid: string): DiscMetadata => ({
    discId: "disc-abc",
    album: releaseMbid,
    tracks: [],
    releaseMbid,
  });

  it("prefers a saved release, then a lone candidate", () => {
    const only = album("only");
    expect(
      selectedDiscFromLookup({ candidates: [only], preferred: only })
        ?.releaseMbid,
    ).toBe("only");

    expect(selectedDiscFromLookup({ candidates: [only] })?.releaseMbid).toBe(
      "only",
    );

    expect(
      selectedDiscFromLookup({
        candidates: [album("a"), album("b")],
      }),
    ).toBeUndefined();
  });
});
