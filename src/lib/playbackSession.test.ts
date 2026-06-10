import { describe, expect, it } from "vitest";
import {
  parseRepeatMode,
  prunePlaybackSession,
  sessionHasContent,
} from "./playbackSession";
import type { PlaybackSession } from "../types/playbackSession";
import type { Track } from "../types/track";

const libraryTrack: Track = {
  id: 1,
  title: "Song",
  artist: "Artist",
  album: "Album",
  albumArtist: "Artist",
  trackNumber: 1,
  discNumber: 1,
  year: 2020,
  genre: null,
  durationSeconds: 180,
  filePath: "/music/song.mp3",
  artPath: null,
  dateAdded: "2026-01-01",
  playCount: 0,
};

describe("parseRepeatMode", () => {
  it("falls back to off for invalid values", () => {
    expect(parseRepeatMode("bogus")).toBe("off");
    expect(parseRepeatMode("one")).toBe("one");
  });
});

describe("sessionHasContent", () => {
  it("treats queue, manual queue, or current track as content", () => {
    const session: PlaybackSession = {
      playContextIds: [1],
      manualQueueIds: [],
      currentTrackId: null,
      positionSeconds: 0,
      shuffle: false,
      repeatMode: "off",
    };
    expect(sessionHasContent(session)).toBe(true);
    expect(
      sessionHasContent({
        ...session,
        playContextIds: [],
      }),
    ).toBe(false);
  });
});

describe("prunePlaybackSession", () => {
  it("prunes library ids against the loaded library", () => {
    const pruned = prunePlaybackSession(
      {
        playContextIds: [1, 99],
        manualQueueIds: [1],
        currentTrackId: 1,
        positionSeconds: 10,
        shuffle: true,
        repeatMode: "all",
      },
      [libraryTrack],
    );

    expect(pruned).toEqual({
      playContextIds: [1],
      manualQueueIds: [1],
      currentTrackId: 1,
      positionSeconds: 10,
      shuffle: true,
      repeatMode: "all",
    });
  });

  it("drops non-library ids such as CD list ids and pending imports", () => {
    const pruned = prunePlaybackSession(
      {
        playContextIds: [-1_000_000_001, 1],
        manualQueueIds: [-1],
        currentTrackId: -1_000_000_002,
        positionSeconds: 5,
        shuffle: false,
        repeatMode: "off",
      },
      [libraryTrack],
    );

    expect(pruned).toEqual({
      playContextIds: [1],
      manualQueueIds: [],
      currentTrackId: null,
      positionSeconds: 5,
      shuffle: false,
      repeatMode: "off",
    });
  });
});
