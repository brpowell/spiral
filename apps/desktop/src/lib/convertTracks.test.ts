import { describe, expect, it } from "vitest";
import {
  convertTracksSettleOptions,
  filterConvertibleTrackIds,
} from "./convertTracks";
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

describe("convertTracksSettleOptions", () => {
  it("all succeeded → success title, no detail/log link", () => {
    expect(
      convertTracksSettleOptions({
        converted: 10,
        failed: 0,
        errors: [],
      }),
    ).toEqual({
      status: "success",
      label: "10 converted",
    });
  });

  it("all failed with one error → error + inline detail", () => {
    expect(
      convertTracksSettleOptions({
        converted: 0,
        failed: 1,
        errors: ["Song A: Encoder failed"],
      }),
    ).toEqual({
      status: "error",
      label: "Convert: 1 failed",
      detail: "Song A: Encoder failed",
    });
  });

  it("all failed with multiple errors → error + View logs", () => {
    expect(
      convertTracksSettleOptions({
        converted: 0,
        failed: 3,
        errors: ["a", "b", "c"],
      }),
    ).toEqual({
      status: "error",
      label: "Convert: 3 failed",
      logLink: true,
    });
  });

  it("partial with one failure → warning + inline detail", () => {
    expect(
      convertTracksSettleOptions({
        converted: 1,
        failed: 1,
        errors: ["Song B: Encoder failed"],
      }),
    ).toEqual({
      status: "warning",
      label: "1 converted · 1 failed",
      detail: "Song B: Encoder failed",
    });
  });

  it("partial with multiple failures → warning + View logs", () => {
    expect(
      convertTracksSettleOptions({
        converted: 8,
        failed: 2,
        errors: ["a", "b"],
      }),
    ).toEqual({
      status: "warning",
      label: "8 converted · 2 failed",
      logLink: true,
    });
  });
});
