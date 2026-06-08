import { describe, expect, it } from "vitest";
import {
  allocPendingTrackId,
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
      discNumber: null,
      year: null,
      genre: null,
      durationSeconds: null,
      filePath: "/music/a.mp3",
      artPath: null,
    });

    expect(isTrackImporting(track)).toBe(true);
    expect(isTrackInteractive(track)).toBe(false);
  });
});
