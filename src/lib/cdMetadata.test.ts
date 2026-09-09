import { describe, expect, it } from "vitest";
import {
  discMetadataOverrideHasEdits,
  discMetadataToEntityHit,
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

  it("copies release, recording, and artist MBIDs from MusicBrainz", () => {
    const remote: DiscMetadata = {
      discId: "disc-abc",
      album: "MB Album",
      albumArtist: "MB Artist",
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      albumArtistMbids: ["89ad4ac3-39f7-470e-963a-56509c546377"],
      tracks: [
        {
          number: 1,
          title: "MB One",
          recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
          artistMbids: ["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"],
        },
        { number: 2, title: "MB Two" },
      ],
    };
    const merged = mergeRemoteMetadataIntoDisc(sampleDisc(), remote);
    expect(merged.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(merged.albumArtistMbids).toEqual([
      "89ad4ac3-39f7-470e-963a-56509c546377",
    ]);
    expect(merged.tracks[0].recordingMbid).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(merged.tracks[0].artistMbids).toEqual([
      "a74b1b3a-d5ba-4d8a-b656-e59347b6780e",
    ]);
    expect(merged.tracks[1].recordingMbid).toBeNull();
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

  it("lets edited MusicBrainz IDs win over lookup, including clears", () => {
    const remote: DiscMetadata = {
      album: "MB Album",
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      tracks: [
        {
          number: 1,
          title: "MB One",
          recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
        },
        {
          number: 2,
          title: "MB Two",
          recordingMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
      ],
    };
    const withRemote = mergeRemoteMetadataIntoDisc(sampleDisc(), remote);
    const override: DiscMetadataOverride = {
      releaseMbid: "cccccccc-dddd-eeee-ffff-000000000000",
      tracks: {
        "1": { recordingMbid: "" },
      },
    };
    const merged = mergeOverridesIntoDisc(withRemote, override);
    expect(merged.releaseMbid).toBe("cccccccc-dddd-eeee-ffff-000000000000");
    expect(merged.tracks[0].recordingMbid).toBeNull();
    expect(merged.tracks[1].recordingMbid).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
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
    expect(discMetadataOverrideHasEdits({ releaseMbid: "" })).toBe(true);
    expect(
      discMetadataOverrideHasEdits({
        tracks: {
          "1": { recordingMbid: "550e8400-e29b-41d4-a716-446655440000" },
        },
      }),
    ).toBe(true);
  });
});

describe("discMetadataToEntityHit", () => {
  it("maps release fields onto a MusicBrainz entity hit", () => {
    const hit = discMetadataToEntityHit(
      {
        album: "Sketches of Brunswick East",
        albumArtist: "King Gizzard & the Lizard Wizard",
        year: 2017,
        country: "US",
        label: "ATO Records",
        releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
        tracks: [
          { number: 1, title: "Sketches" },
          { number: 2, title: "Countdown" },
        ],
      },
      "Unknown Album",
    );
    expect(hit).toEqual({
      kind: "release",
      mbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      title: "Sketches of Brunswick East",
      artist: "King Gizzard & the Lizard Wizard",
      year: 2017,
      country: "US",
      label: "ATO Records",
      trackCount: 2,
    });
  });

  it("uses the fallback title when the album is missing", () => {
    const hit = discMetadataToEntityHit({ tracks: [] }, "Unknown Album");
    expect(hit.kind).toBe("release");
    expect(hit.mbid).toBe("");
    expect(hit.title).toBe("Unknown Album");
    expect(hit.trackCount).toBe(0);
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
