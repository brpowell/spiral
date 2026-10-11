import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { DEFAULT_LIBRARY_ICON_ID, resolveIconId } from "./iconLibrary";
import {
  resolvePlaylistDesignFields,
  uniqueAlbumArtPaths,
} from "./playlistArt";
import {
  defaultPlaylistDesignCover,
  playlistDesignBackgroundStyle,
  randomPlaylistCoverColors,
} from "./playlistCoverPresets";

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

describe("playlist design covers", () => {
  it("randomizes a solid color without adding a second stop", () => {
    const colors = randomPlaylistCoverColors(false);
    expect(colors.coverBackground).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.coverBackgroundEnd).toBeNull();
  });

  it("randomizes both stops when a gradient is already set", () => {
    const colors = randomPlaylistCoverColors(true);
    expect(colors.coverBackground).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.coverBackgroundEnd).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("builds a solid background style", () => {
    expect(playlistDesignBackgroundStyle("#4f46e5", null)).toEqual({
      background: "#4f46e5",
    });
  });

  it("builds a 135deg gradient when an end color is set", () => {
    expect(playlistDesignBackgroundStyle("#f97316", "#db2777")).toEqual({
      background: "linear-gradient(135deg, #f97316, #db2777)",
    });
  });

  it("falls back to the default solid when the start color is empty", () => {
    const defaults = defaultPlaylistDesignCover();
    expect(playlistDesignBackgroundStyle("  ", null)).toEqual({
      background: defaults.coverBackground,
    });
  });

  it("fills design defaults when mode is design", () => {
    expect(resolvePlaylistDesignFields("design", null, null, null)).toEqual(
      defaultPlaylistDesignCover(),
    );
  });

  it("preserves design fields for non-design modes", () => {
    expect(
      resolvePlaylistDesignFields("generated", "#111111", "#222222", "heart"),
    ).toEqual({
      coverBackground: "#111111",
      coverBackgroundEnd: "#222222",
      coverIcon: "heart",
    });
  });

  it("resolves cover icons through the shared library", () => {
    expect(resolveIconId("not-a-real-icon")).toBe(DEFAULT_LIBRARY_ICON_ID);
    expect(resolveIconId("headphones")).toBe("headphones");
    expect(defaultPlaylistDesignCover().coverIcon).toBe(
      DEFAULT_LIBRARY_ICON_ID,
    );
  });
});
