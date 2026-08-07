import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { uniqueAlbumArtPaths } from "./playlistArt";

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
    sampleRate: overrides.sampleRate ?? null,
    bitrate: overrides.bitrate ?? null,
    codec: overrides.codec ?? null,
    artPath: overrides.artPath ?? null,
    filePath: overrides.filePath ?? `/music/${overrides.id}.mp3`,
    dateAdded: overrides.dateAdded ?? "2024-01-01",
    playCount: overrides.playCount ?? 0,
    lastPlayedAt: overrides.lastPlayedAt ?? null,
    rating: overrides.rating ?? 0,
  };
}

describe("uniqueAlbumArtPaths", () => {
  it("uses a single tile when multiple tracks share an album but different art paths", () => {
    const tracks = [
      track({
        id: 1,
        album: "OK Computer",
        albumArtist: "Radiohead",
        artPath: "/cache/art-a.png",
      }),
      track({
        id: 2,
        album: "OK Computer",
        albumArtist: "Radiohead",
        artPath: "/cache/art-b.png",
      }),
    ];

    expect(uniqueAlbumArtPaths(tracks)).toEqual(["/cache/art-a.png"]);
  });

  it("keeps playlist order across distinct albums", () => {
    const tracks = [
      track({
        id: 1,
        album: "Album A",
        albumArtist: "Artist",
        artPath: "/cache/a.png",
      }),
      track({
        id: 2,
        album: "Album A",
        albumArtist: "Artist",
        artPath: "/cache/a2.png",
      }),
      track({
        id: 3,
        album: "Album B",
        albumArtist: "Artist",
        artPath: "/cache/b.png",
      }),
    ];

    expect(uniqueAlbumArtPaths(tracks)).toEqual([
      "/cache/a.png",
      "/cache/b.png",
    ]);
  });

  it("skips tracks without art and still picks later art from that album", () => {
    const tracks = [
      track({
        id: 1,
        album: "Album A",
        albumArtist: "Artist",
        artPath: null,
      }),
      track({
        id: 2,
        album: "Album A",
        albumArtist: "Artist",
        artPath: "/cache/a.png",
      }),
    ];

    expect(uniqueAlbumArtPaths(tracks)).toEqual(["/cache/a.png"]);
  });

  it("limits to four unique albums", () => {
    const tracks = [
      track({ id: 1, album: "A", artPath: "/a.png" }),
      track({ id: 2, album: "B", artPath: "/b.png" }),
      track({ id: 3, album: "C", artPath: "/c.png" }),
      track({ id: 4, album: "D", artPath: "/d.png" }),
      track({ id: 5, album: "E", artPath: "/e.png" }),
    ];

    expect(uniqueAlbumArtPaths(tracks)).toEqual([
      "/a.png",
      "/b.png",
      "/c.png",
      "/d.png",
    ]);
  });

  it("treats different album artists as distinct albums", () => {
    const tracks = [
      track({
        id: 1,
        album: "Greatest Hits",
        albumArtist: "Artist A",
        artPath: "/a.png",
      }),
      track({
        id: 2,
        album: "Greatest Hits",
        albumArtist: "Artist B",
        artPath: "/b.png",
      }),
    ];

    expect(uniqueAlbumArtPaths(tracks)).toEqual(["/a.png", "/b.png"]);
  });
});
