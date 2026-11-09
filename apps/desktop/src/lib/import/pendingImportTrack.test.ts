import { describe, expect, it } from "vitest";
import {
  allocPendingTrackId,
  isTrackConvertible,
  isTrackImporting,
  isTrackInteractive,
  pendingTrackFromInput,
  resetPendingTrackIds,
} from "./pendingImportTrack";

describe("pendingImportTrack", () => {
  it("allocates decreasing negative ids", () => {
    resetPendingTrackIds();
    expect(allocPendingTrackId()).toBe(-1);
    expect(allocPendingTrackId()).toBe(-2);
  });

  it("marks staged tracks as non-interactive", () => {
    const track = pendingTrackFromInput(-1, "/music/a.mp3", {
      title: "Song",
      artist: null,
      album: null,
      albumArtist: null,
      trackNumber: null,
      totalTracks: null,
      discNumber: null,
      totalDiscs: null,
      year: null,
      genre: null,
      durationSeconds: null,
      sampleRate: null,
      bitrate: null,
      codec: null,
      filePath: "/music/a.mp3",
      artPath: null,
    });

    expect(isTrackImporting(track)).toBe(true);
    expect(isTrackInteractive(track)).toBe(false);
    expect(isTrackConvertible(track)).toBe(false);
  });

  it("copies MusicBrainz IDs from TrackInput onto the pending row", () => {
    const track = pendingTrackFromInput(-1, "/music/a.mp3", {
      title: "Song",
      artist: null,
      album: null,
      albumArtist: null,
      trackNumber: null,
      totalTracks: null,
      discNumber: null,
      totalDiscs: null,
      year: null,
      genre: null,
      durationSeconds: null,
      sampleRate: null,
      bitrate: null,
      codec: null,
      filePath: "/music/a.mp3",
      artPath: null,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      artistMbids: ["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"],
      albumArtistMbids: ["89ad4ac3-39f7-470e-963a-56509c546377"],
    });

    expect(track.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(track.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(track.artistMbids).toEqual(["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"]);
    expect(track.albumArtistMbids).toEqual([
      "89ad4ac3-39f7-470e-963a-56509c546377",
    ]);
  });
});
