import { describe, expect, it } from "vitest";
import { artistLinksForTrack } from "./trackNavigation";
import type { Track } from "../types/track";

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? "Song",
    artist: overrides.artist ?? null,
    album: overrides.album ?? "Album",
    albumArtist: overrides.albumArtist ?? null,
    trackNumber: overrides.trackNumber ?? null,
    totalTracks: null,
    discNumber: overrides.discNumber ?? null,
    totalDiscs: null,
    year: overrides.year ?? null,
    genre: overrides.genre ?? null,
    durationSeconds: overrides.durationSeconds ?? 180,
    artPath: overrides.artPath ?? null,
    filePath: overrides.filePath ?? `/music/${overrides.id}.mp3`,
    dateAdded: overrides.dateAdded ?? "2024-01-01",
    playCount: overrides.playCount ?? 0,
    rating: overrides.rating ?? 0,
  };
}

describe("artistLinksForTrack", () => {
  it("links each parsed performer separately", () => {
    const links = artistLinksForTrack(track({ id: 1, artist: "Alice; Bob" }));

    expect(links).toEqual([
      { name: "Alice", key: "Alice", linkable: true },
      { name: "Bob", key: "Bob", linkable: true },
    ]);
  });

  it("respects library membership", () => {
    const links = artistLinksForTrack(
      track({ id: 1, artist: "Alice; Bob" }),
      new Set(["Alice"]),
    );

    expect(links).toEqual([
      { name: "Alice", key: "Alice", linkable: true },
      { name: "Bob", key: "Bob", linkable: false },
    ]);
  });

  it("returns empty when track has no artist metadata", () => {
    expect(
      artistLinksForTrack(track({ id: 1, artist: null, albumArtist: null })),
    ).toEqual([]);
  });
});
