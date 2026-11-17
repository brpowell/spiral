import { describe, expect, it } from "vitest";
import type { Track } from "@/types/track";
import { buildTrackGenreMetadata } from "./genreMetadata";

const track = {
  id: 1,
  title: "Song",
  artist: "Artist",
  album: "Album",
  albumArtist: "Artist",
  trackNumber: 3,
  totalTracks: 10,
  discNumber: 1,
  totalDiscs: 1,
  year: 1999,
  genre: "rock",
  artPath: "art/x.jpg",
  artistMbids: ["a-1"],
} as Track;

describe("buildTrackGenreMetadata", () => {
  it("changes only the genre and keeps other fields", () => {
    const meta = buildTrackGenreMetadata(track, "  Rock  ");
    expect(meta).toMatchObject({
      title: "Song",
      artist: "Artist",
      album: "Album",
      year: 1999,
      trackNumber: 3,
      genre: "Rock",
      artPath: "art/x.jpg",
      artChanged: false,
      lyricsChanged: false,
      artistMbids: ["a-1"],
    });
  });

  it("clears the genre when the name is blank", () => {
    expect(buildTrackGenreMetadata(track, "   ").genre).toBeNull();
  });
});
