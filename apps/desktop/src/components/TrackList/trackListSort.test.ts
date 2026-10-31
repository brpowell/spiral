import { describe, expect, it } from "vitest";
import type { Track } from "../../types/track";
import {
  compareTracks,
  filterTracksBySearch,
  nextSort,
  scoreTracksBySearch,
} from "./trackListSort";

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
    expect(compareTracks(lineSynced, wordSynced, "lyrics", "asc")).toBeLessThan(
      0,
    );
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
    expect(compareTracks(never, newer, "lastPlayedAt", "asc")).toBeGreaterThan(
      0,
    );
    expect(compareTracks(newer, never, "lastPlayedAt", "desc")).toBeLessThan(0);
    expect(compareTracks(never, newer, "lastPlayedAt", "desc")).toBeGreaterThan(
      0,
    );
  });
});

describe("filterTracksBySearch", () => {
  const tracks = [
    track({ id: 1, title: "Creep", artist: "Radiohead", album: "Pablo Honey" }),
    track({
      id: 2,
      title: "Windowlicker",
      artist: "Aphex Twin",
      albumArtist: "Richard D. James",
      genre: "Electronic",
    }),
  ];
  const ids = (q: string) => filterTracksBySearch(tracks, q).map((t) => t.id);

  it("searches title, artist, album and album artist with typo tolerance", () => {
    expect(ids("crep")).toEqual([1]);
    expect(ids("radiohed")).toEqual([1]);
    expect(ids("pablo hony")).toEqual([1]);
    expect(ids("richrd james")).toEqual([2]);
  });

  it("does not search genre", () => {
    expect(ids("electronic")).toEqual([]);
  });

  it("returns everything for an empty query, preserving order", () => {
    expect(ids("  ")).toEqual([1, 2]);
  });
});

describe("scoreTracksBySearch", () => {
  const tracks = [
    track({
      id: 1,
      title: "Song of Storms",
      artist: "Save Point",
      album: "Video Game Music",
    }),
    track({
      id: 2,
      title: "Zelda's Lullaby",
      artist: "Save Point",
      album: "Video of Zelda",
    }),
    track({
      id: 3,
      title: "tv off (feat. Lefty Gunplay)",
      artist: "Kendrick Lamar",
      album: "GNX",
    }),
  ];

  it("does not match short tokens across word boundaries", () => {
    expect(scoreTracksBySearch(tracks, "tv of").map((s) => s.item.id)).toEqual([
      3,
    ]);
  });

  it("scores the exact title match highest", () => {
    const best = scoreTracksBySearch(tracks, "of").sort(
      (a, b) => b.score - a.score,
    );
    expect(best[0].score).toBeGreaterThanOrEqual(best[best.length - 1].score);
    expect(scoreTracksBySearch(tracks, "tv off")[0].item.id).toBe(3);
  });
});

describe("track search field weighting", () => {
  const byTitle = track({
    id: 1,
    title: "Radiohead Medley",
    artist: "Cover Band",
    album: "Tribute",
  });
  const byArtist = track({
    id: 2,
    title: "Creep",
    artist: "Radiohead",
    album: "Pablo Honey",
  });
  const byAlbum = track({
    id: 3,
    title: "Creep",
    artist: "Other",
    album: "Radiohead",
  });
  const byAlbumArtist = track({
    id: 4,
    title: "Creep",
    artist: "Other",
    album: "Misc",
    albumArtist: "Radiohead",
  });
  const score = (t: Track) => scoreTracksBySearch([t], "radiohead")[0].score;

  it("ranks a title match above artist, album and album-artist matches", () => {
    expect(score(byTitle)).toBeGreaterThan(score(byArtist));
  });

  it("ties artist, album and album-artist matches", () => {
    expect(score(byArtist)).toBe(score(byAlbum));
    expect(score(byArtist)).toBe(score(byAlbumArtist));
  });

  it("lets tokens match in different fields", () => {
    expect(scoreTracksBySearch([byArtist], "radiohead creep")).toHaveLength(1);
  });
});

describe("nextSort", () => {
  it("cycles asc -> desc -> unsorted for the same column", () => {
    const asc = nextSort(null, "artist");
    expect(asc).toEqual({ field: "artist", dir: "asc" });
    const desc = nextSort(asc, "artist");
    expect(desc).toEqual({ field: "artist", dir: "desc" });
    expect(nextSort(desc, "artist")).toBeNull();
  });

  it("starts a different column at asc", () => {
    expect(nextSort({ field: "artist", dir: "desc" }, "album")).toEqual({
      field: "album",
      dir: "asc",
    });
  });
});

describe("compareTracks source", () => {
  it("puts the default source first, then added folders, then Other", () => {
    const tracks = [
      track({ id: 1, sourceId: 2 }),
      track({ id: 2, sourceId: 4 }),
      track({ id: 3, sourceId: 1 }),
      track({ id: 4, sourceId: 3 }),
    ];
    const asc = [...tracks].sort((a, b) =>
      compareTracks(a, b, "source", "asc"),
    );
    expect(asc.map((t) => t.sourceId)).toEqual([1, 3, 4, 2]);
    const desc = [...tracks].sort((a, b) =>
      compareTracks(a, b, "source", "desc"),
    );
    expect(desc.map((t) => t.sourceId)).toEqual([2, 4, 3, 1]);
  });
});
