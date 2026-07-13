import { describe, expect, it, beforeEach } from "vitest";
import { discFromActivePlayback } from "./cdActivePlaybackDisc";
import { cdTrackListId } from "./cdTracks";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

function cdTrack(number: number): Track {
  return {
    id: cdTrackListId(number),
    title: `Song ${number}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: number,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    filePath: "",
    artPath: null,
    dateAdded: "",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
  };
}

describe("discFromActivePlayback", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      cdDriveId: null,
      playbackTracks: [],
      cdQueueContext: null,
      playbackState: "stopped",
      currentPlayable: null,
    });
  });

  it("builds a disc snapshot from active playback tracks", () => {
    const tracks = [cdTrack(1), cdTrack(2)];
    usePlayerStore.setState({
      cdDriveId: "drive-a",
      playbackTracks: tracks,
      playbackState: "playing",
      currentPlayable: { type: "cd", driveId: "drive-a", trackNumber: 1 },
    });

    expect(discFromActivePlayback("drive-a")).toEqual({
      driveId: "drive-a",
      discId: null,
      album: "Album",
      artist: "Artist",
      tracks: [
        {
          number: 1,
          title: "Song 1",
          artist: "Artist",
          durationSeconds: 180,
        },
        {
          number: 2,
          title: "Song 2",
          artist: "Artist",
          durationSeconds: 180,
        },
      ],
    });
  });

  it("returns null when no playback context exists for the drive", () => {
    expect(discFromActivePlayback("drive-a")).toBeNull();
  });
});
