import { describe, expect, it } from "vitest";
import {
  albumArtistKey,
  albumsForArtist,
  groupTracksIntoArtists,
  performerKeysForTrack,
} from "./artists";
import { groupTracksIntoAlbums } from "./albums";
import type { Track } from "../types/track";

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? "Song",
    artist: overrides.artist ?? null,
    album: overrides.album ?? "Album",
    albumArtist: overrides.albumArtist ?? null,
    trackNumber: overrides.trackNumber ?? null,
    discNumber: overrides.discNumber ?? null,
    year: overrides.year ?? null,
    genre: overrides.genre ?? null,
    durationSeconds: overrides.durationSeconds ?? 180,
    artPath: overrides.artPath ?? null,
    filePath: overrides.filePath ?? `/music/${overrides.id}.mp3`,
    dateAdded: overrides.dateAdded ?? "2024-01-01",
    playCount: overrides.playCount ?? 0,
  };
}

describe("albumArtistKey", () => {
  it("prefers album artist over track artist", () => {
    expect(
      albumArtistKey(
        track({ id: 1, artist: "Performer", albumArtist: "Band" }),
      ),
    ).toBe("Band");
  });
});

describe("performerKeysForTrack", () => {
  it("splits multi-artist track fields", () => {
    expect(
      performerKeysForTrack(
        track({ id: 1, artist: "Alice / Bob", albumArtist: "Various" }),
      ),
    ).toEqual(["Alice", "Bob"]);
  });

  it("falls back to album artist when track artist is empty", () => {
    expect(
      performerKeysForTrack(
        track({ id: 1, artist: null, albumArtist: "Band" }),
      ),
    ).toEqual(["Band"]);
  });
});

describe("groupTracksIntoArtists", () => {
  it("groups discography by album artist", () => {
    const library = [
      track({
        id: 1,
        album: "Comp",
        artist: "Alice",
        albumArtist: "Various Artists",
      }),
      track({
        id: 2,
        album: "Studio",
        artist: "Alice",
        albumArtist: "Alice",
      }),
    ];
    const artists = groupTracksIntoArtists(library, "discography");
    expect(artists.map((a) => a.name).sort()).toEqual([
      "Alice",
      "Various Artists",
    ]);
    expect(artists.find((a) => a.name === "Alice")?.tracks).toHaveLength(1);
  });

  it("groups performers by parsed track artist", () => {
    const library = [
      track({
        id: 1,
        album: "Comp",
        artist: "Alice",
        albumArtist: "Various Artists",
      }),
      track({
        id: 2,
        album: "Studio",
        artist: "Alice",
        albumArtist: "Alice",
      }),
    ];
    const artists = groupTracksIntoArtists(library, "performers");
    expect(artists).toHaveLength(1);
    expect(artists[0]?.name).toBe("Alice");
    expect(artists[0]?.tracks).toHaveLength(2);
  });
});

describe("albumsForArtist", () => {
  it("links performer albums by track credit", () => {
    const library = [
      track({
        id: 1,
        album: "Comp",
        artist: "Alice",
        albumArtist: "Various Artists",
      }),
    ];
    const albums = groupTracksIntoAlbums(library);
    const performers = groupTracksIntoArtists(library, "performers");
    const alice = performers[0];
    expect(alice).toBeDefined();
    expect(albumsForArtist(albums, alice!, "performers")).toHaveLength(1);
  });
});
