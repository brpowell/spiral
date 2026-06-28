import { describe, expect, it } from "vitest";
import { cdTrackListId } from "../cdTracks";
import { isPendingTrackId } from "../pendingImportTrack";
import type { Track } from "../../types/track";
import {
  playableRefFromTrackListId,
  resolvePlaybackSource,
  trackListIdForPlayable,
} from "./playable";

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
  rating: 0,
};

describe("trackListIdForPlayable", () => {
  it("maps library and CD playables to list ids", () => {
    expect(trackListIdForPlayable({ type: "library", trackId: 42 })).toBe(42);
    expect(
      trackListIdForPlayable({
        type: "cd",
        driveId: "drive-a",
        trackNumber: 3,
      }),
    ).toBe(cdTrackListId(3));
  });

  it("keeps CD list ids disjoint from pending-import ids", () => {
    expect(isPendingTrackId(cdTrackListId(1))).toBe(false);
    expect(isPendingTrackId(-1)).toBe(true);
  });
});

describe("playableRefFromTrackListId", () => {
  it("returns CD playable for CD list ids when drive is set", () => {
    expect(playableRefFromTrackListId(cdTrackListId(2), "drive-a")).toEqual({
      type: "cd",
      driveId: "drive-a",
      trackNumber: 2,
    });
  });

  it("returns null for CD ids without drive context", () => {
    expect(playableRefFromTrackListId(cdTrackListId(2), null)).toBeNull();
  });

  it("treats small negative (pending-import) ids as library refs", () => {
    expect(playableRefFromTrackListId(-2, "drive-a")).toEqual({
      type: "library",
      trackId: -2,
    });
  });

  it("returns library playable for positive ids", () => {
    expect(playableRefFromTrackListId(5, null)).toEqual({
      type: "library",
      trackId: 5,
    });
  });
});

describe("resolvePlaybackSource", () => {
  it("resolves library tracks to file sources", () => {
    expect(
      resolvePlaybackSource({ type: "library", trackId: 1 }, [libraryTrack]),
    ).toEqual({ kind: "file", path: "/music/song.mp3" });
  });

  it("resolves CD playables to cd sources", () => {
    expect(
      resolvePlaybackSource(
        { type: "cd", driveId: "drive-a", trackNumber: 4 },
        [],
      ),
    ).toEqual({ kind: "cd", driveId: "drive-a", trackNumber: 4 });
  });
});
