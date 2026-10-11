import { describe, expect, it } from "vitest";
import {
  SKIN_PLAYLIST_SOURCE_ALL,
  SKIN_PLAYLIST_SOURCE_UP_NEXT,
  buildSkinPlaylistSourceOptions,
  playlistSourceIdForPlaylist,
  resolveIdlePlaybackTrackIds,
  resolveSkinPlaylistTrackIds,
} from "./skinPlaylist";
import type { Playlist } from "../types/playlist";
import type { Track } from "../types/track";

function track(id: number, title: string): Track {
  return {
    id,
    title,
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    filePath: `/music/${id}.mp3`,
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
  };
}

function playlist(id: number, title: string, trackIds: number[]): Playlist {
  return {
    id,
    title,
    description: null,
    dateCreated: "2024-01-01",
    lastUsedAt: "2024-01-01",
    trackIds,
    imageMode: "generated",
    customImagePath: null,
    coverBackground: null,
    coverBackgroundEnd: null,
    coverIcon: null,
  };
}

describe("buildSkinPlaylistSourceOptions", () => {
  it("includes All tracks, Up Next, and sorted user playlists", () => {
    const options = buildSkinPlaylistSourceOptions([
      playlist(2, "Zebra", []),
      playlist(1, "Alpha", []),
    ]);

    expect(options.map((option) => option.id)).toEqual([
      SKIN_PLAYLIST_SOURCE_ALL,
      SKIN_PLAYLIST_SOURCE_UP_NEXT,
      playlistSourceIdForPlaylist(1),
      playlistSourceIdForPlaylist(2),
    ]);
  });
});

describe("resolveSkinPlaylistTrackIds", () => {
  const library = [track(1, "B"), track(2, "A"), track(3, "C")];

  it("returns library tracks sorted by title for All tracks", () => {
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        library,
        playbackTracks: [],
        playContextIds: [],
        manualQueueIds: [],
        currentTrackId: null,
        playlists: [],
      }),
    ).toEqual([2, 1, 3]);
  });

  it("returns tracks after the current item for Up Next", () => {
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_UP_NEXT, {
        library,
        playbackTracks: [],
        playContextIds: [1, 2, 3],
        manualQueueIds: [],
        currentTrackId: 1,
        playlists: [],
      }),
    ).toEqual([2, 3]);
  });

  it("returns playlist track order for user playlists", () => {
    expect(
      resolveSkinPlaylistTrackIds(playlistSourceIdForPlaylist(9), {
        library,
        playbackTracks: [],
        playContextIds: [],
        manualQueueIds: [],
        currentTrackId: null,
        playlists: [playlist(9, "Mix", [3, 1])],
      }),
    ).toEqual([3, 1]);
  });

  it("filters All tracks by title, artist, album, and genre", () => {
    const catalog = [
      {
        ...track(1, "Paranoid Android"),
        artist: "Radiohead",
        album: "OK Computer",
        genre: "Rock",
      },
      {
        ...track(2, "Airbag"),
        artist: "Radiohead",
        album: "OK Computer",
      },
      {
        ...track(3, "Come As You Are"),
        artist: "Nirvana",
        album: "Nevermind",
        genre: "Grunge",
      },
    ];
    const ctx = {
      library: catalog,
      playbackTracks: [],
      playContextIds: [],
      manualQueueIds: [],
      currentTrackId: null,
      playlists: [],
    };

    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        ...ctx,
        filterQuery: "air",
      }),
    ).toEqual([2]);
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        ...ctx,
        filterQuery: "nirvana",
      }),
    ).toEqual([3]);
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        ...ctx,
        filterQuery: "ok computer",
      }),
    ).toEqual([2, 1]);
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        ...ctx,
        filterQuery: "grunge",
      }),
    ).toEqual([3]);
    expect(
      resolveSkinPlaylistTrackIds(SKIN_PLAYLIST_SOURCE_ALL, {
        ...ctx,
        filterQuery: "   ",
      }),
    ).toEqual([2, 3, 1]);
  });
});

describe("resolveIdlePlaybackTrackIds", () => {
  const library = [track(1, "B"), track(2, "A"), track(3, "C")];
  const emptyCtx = {
    library,
    playbackTracks: [],
    playContextIds: [] as number[],
    manualQueueIds: [] as number[],
    currentTrackId: null,
    playlists: [] as Playlist[],
  };

  it("uses the current playlist source when it has tracks", () => {
    expect(
      resolveIdlePlaybackTrackIds(playlistSourceIdForPlaylist(9), {
        ...emptyCtx,
        playlists: [playlist(9, "Mix", [3, 1])],
      }),
    ).toEqual([3, 1]);
  });

  it("falls back to all tracks when Up Next is empty", () => {
    expect(
      resolveIdlePlaybackTrackIds(SKIN_PLAYLIST_SOURCE_UP_NEXT, emptyCtx),
    ).toEqual([2, 1, 3]);
  });
});
