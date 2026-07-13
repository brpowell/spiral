import { describe, expect, it } from "vitest";
import {
  albumImportMetadata,
  albumKey,
  findMatchingLibraryAlbum,
  groupAlbumTracksByDisc,
  groupTracksIntoAlbums,
} from "./albums";
import type { CdDisc } from "../types/cd";
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
    lastPlayedAt: overrides.lastPlayedAt ?? null,
    rating: overrides.rating ?? 0,
  };
}

function disc(overrides: Partial<CdDisc> = {}): CdDisc {
  return {
    discId: null,
    album: "OK Computer",
    artist: "Radiohead",
    tracks: [
      {
        number: 1,
        title: "Airbag",
        artist: null,
        durationSeconds: 240,
      },
      {
        number: 2,
        title: "Paranoid Android",
        artist: null,
        durationSeconds: 380,
      },
    ],
    ...overrides,
  };
}

describe("groupAlbumTracksByDisc", () => {
  it("returns a single group when all tracks share one disc", () => {
    const tracks = [
      track({ id: 1, discNumber: 1, trackNumber: 1 }),
      track({ id: 2, discNumber: null, trackNumber: 2 }),
    ];
    expect(groupAlbumTracksByDisc(tracks)).toEqual([
      { discNumber: 1, tracks },
    ]);
  });

  it("splits tracks into ordered disc groups", () => {
    const disc1 = track({ id: 1, discNumber: 1, trackNumber: 1 });
    const disc2a = track({ id: 2, discNumber: 2, trackNumber: 1 });
    const disc2b = track({ id: 3, discNumber: 2, trackNumber: 2 });
    const tracks = [disc1, disc2a, disc2b];

    expect(groupAlbumTracksByDisc(tracks)).toEqual([
      { discNumber: 1, tracks: [disc1] },
      { discNumber: 2, tracks: [disc2a, disc2b] },
    ]);
  });
});

describe("findMatchingLibraryAlbum", () => {
  it("matches an existing album by exact album key", () => {
    const library = [
      track({
        id: 1,
        album: "OK Computer",
        albumArtist: "Radiohead",
        artist: "Radiohead",
        trackNumber: 1,
        title: "Airbag",
      }),
    ];
    const albums = groupTracksIntoAlbums(library);
    expect(findMatchingLibraryAlbum(albums, disc())).toBe(albums[0]);
  });

  it("matches case-insensitively when disc metadata differs in casing", () => {
    const library = [
      track({
        id: 1,
        album: "OK Computer",
        albumArtist: "Radiohead",
        artist: "Radiohead",
        trackNumber: 1,
        title: "Airbag",
      }),
    ];
    const albums = groupTracksIntoAlbums(library);
    const match = findMatchingLibraryAlbum(
      albums,
      disc({ album: "ok computer", artist: "RADIOHEAD" }),
    );
    expect(match).toBe(albums[0]);
  });

  it("matches a partial import when disc artist metadata is missing", () => {
    const library = [
      track({
        id: 1,
        album: "OK Computer",
        albumArtist: "Radiohead",
        artist: "Radiohead",
        trackNumber: 1,
        title: "Airbag",
      }),
    ];
    const albums = groupTracksIntoAlbums(library);
    const match = findMatchingLibraryAlbum(
      albums,
      disc({ artist: null, tracks: disc().tracks }),
    );
    expect(match).toBe(albums[0]);
  });

  it("reuses album artist metadata when library tracks only have track artist", () => {
    const library = [
      track({
        id: 1,
        album: "OK Computer",
        albumArtist: null,
        artist: "Radiohead",
        trackNumber: 1,
        title: "Airbag",
      }),
    ];
    const albums = groupTracksIntoAlbums(library);
    const metadata = albumImportMetadata(albums[0]!);
    expect(metadata.albumArtist).toBeNull();
    expect(metadata.defaultTrackArtist).toBe("Radiohead");
    expect(
      albumKey(
        track({
          id: 2,
          album: metadata.album,
          albumArtist: metadata.albumArtist,
          artist: metadata.defaultTrackArtist,
        }),
      ),
    ).toBe(albums[0]!.key);
  });
});
