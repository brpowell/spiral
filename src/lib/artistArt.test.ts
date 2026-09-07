import { describe, expect, it } from "vitest";
import { isAlbumArtOverride, artistArtCacheKey } from "./artistArt";
import { pickArtPath } from "./albums";
import type { Track } from "../types/track";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: null,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "/lib/Tracks/a.mp3",
    artPath: null,
    dateAdded: "",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    recordingMbid: null,
    releaseMbid: null,
    artistMbids: [],
    albumArtistMbids: [],
    ...overrides,
  };
}

describe("isAlbumArtOverride", () => {
  it("treats front.* as canonical", () => {
    expect(isAlbumArtOverride("/lib/Artwork/albums/A/B/front.jpg")).toBe(false);
  });

  it("treats typed track files as overrides", () => {
    expect(
      isAlbumArtOverride("/lib/Artwork/albums/A/B/03 - Song - front.jpg"),
    ).toBe(true);
  });
});

describe("pickArtPath", () => {
  it("prefers canonical front over overrides", () => {
    const tracks = [
      track({
        id: 1,
        artPath: "/lib/Artwork/albums/A/B/03 - Song - front.jpg",
      }),
      track({
        id: 2,
        artPath: "/lib/Artwork/albums/A/B/front.jpg",
      }),
    ];
    expect(pickArtPath(tracks)).toBe("/lib/Artwork/albums/A/B/front.jpg");
  });
});

describe("artistArtCacheKey", () => {
  it("prefixes artist keys", () => {
    expect(artistArtCacheKey("Daft Punk")).toBe("artist:Daft Punk");
  });
});
