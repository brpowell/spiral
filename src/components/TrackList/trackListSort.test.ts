import { describe, expect, it } from "vitest";
import type { Track } from "../../types/track";
import { compareTracks } from "./trackListSort";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: "Track",
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: null,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/music/track.mp3",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("compareTracks lyrics", () => {
  it("sorts lyrics formats ascending with missing lyrics last", () => {
    const plain = track({ id: 1, lyricsFormat: "plain" });
    const lineSynced = track({ id: 2, lyricsFormat: "line_synced" });
    const wordSynced = track({ id: 3, lyricsFormat: "word_synced" });
    const missing = track({ id: 4, lyricsFormat: null });

    expect(compareTracks(plain, lineSynced, "lyrics", "asc")).toBeLessThan(0);
    expect(compareTracks(lineSynced, wordSynced, "lyrics", "asc")).toBeLessThan(0);
    expect(compareTracks(wordSynced, missing, "lyrics", "asc")).toBeLessThan(0);
  });

  it("sorts lyrics formats descending with missing lyrics last", () => {
    const plain = track({ id: 1, lyricsFormat: "plain" });
    const lineSynced = track({ id: 2, lyricsFormat: "line_synced" });
    const missing = track({ id: 3, lyricsFormat: null });

    expect(compareTracks(lineSynced, plain, "lyrics", "desc")).toBeLessThan(0);
    expect(compareTracks(plain, missing, "lyrics", "desc")).toBeLessThan(0);
    expect(compareTracks(missing, plain, "lyrics", "desc")).toBeGreaterThan(0);
  });
});

describe("compareTracks lastPlayedAt", () => {
  it("sorts by timestamp and keeps never-played last in both directions", () => {
    const older = track({ id: 1, lastPlayedAt: "2026-01-01T00:00:00.000Z" });
    const newer = track({ id: 2, lastPlayedAt: "2026-06-01T00:00:00.000Z" });
    const never = track({ id: 3, lastPlayedAt: null });

    expect(compareTracks(older, newer, "lastPlayedAt", "asc")).toBeLessThan(0);
    expect(compareTracks(newer, older, "lastPlayedAt", "desc")).toBeLessThan(0);
    expect(compareTracks(newer, never, "lastPlayedAt", "asc")).toBeLessThan(0);
    expect(compareTracks(never, newer, "lastPlayedAt", "asc")).toBeGreaterThan(0);
    expect(compareTracks(newer, never, "lastPlayedAt", "desc")).toBeLessThan(0);
    expect(compareTracks(never, newer, "lastPlayedAt", "desc")).toBeGreaterThan(0);
  });
});
