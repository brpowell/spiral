import { describe, expect, it } from "vitest";
import { filterConvertibleTrackIds } from "./convertTracks";
import type { Track } from "../types/track";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 42,
    title: "Track One",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 2020,
    genre: null,
    durationSeconds: 180,
    filePath: "/music/track.flac",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("filterConvertibleTrackIds", () => {
  it("includes saved library tracks", () => {
    const library = [makeTrack({ id: 1 }), makeTrack({ id: 2 })];
    expect(filterConvertibleTrackIds([1, 2], library)).toEqual([1, 2]);
  });

  it("excludes importing and pending tracks", () => {
    const library = [
      makeTrack({ id: 1 }),
      makeTrack({ id: -1, importStatus: "importing" }),
      makeTrack({ id: 2, importStatus: "importing" }),
    ];
    expect(filterConvertibleTrackIds([1, -1, 2], library)).toEqual([1]);
  });

  it("excludes tracks flagged missing on disk", () => {
    const library = [
      makeTrack({ id: 1 }),
      makeTrack({ id: 2, missingFile: true }),
    ];
    expect(filterConvertibleTrackIds([1, 2], library)).toEqual([1]);
  });

  it("deduplicates track ids", () => {
    const library = [makeTrack({ id: 1 })];
    expect(filterConvertibleTrackIds([1, 1, 1], library)).toEqual([1]);
  });
});
