import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  CdImportCancelledError,
  isCdImportCancelledError,
} from "./cdImport";
import { isCdImportCancelRequested } from "./cdImportGuard";
import { useCdImportStore } from "../store/useCdImportStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 42,
    title: "Track One",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 2020,
    genre: null,
    durationSeconds: 180,
    filePath: "/music/track.flac",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    rating: 0,
    ...overrides,
  };
}

describe("CdImportCancelledError", () => {
  it("is detected by isCdImportCancelledError", () => {
    expect(isCdImportCancelledError(new CdImportCancelledError())).toBe(true);
    expect(isCdImportCancelledError(new Error("Import cancelled"))).toBe(false);
  });
});

describe("cd import cancel store", () => {
  beforeEach(() => {
    useCdImportStore.setState({
      progress: null,
      importingDriveId: null,
      completedDisplayByDriveId: {},
      cancelRequested: false,
      cancelPrompt: null,
    });
  });

  it("reports cancel request via cdImportGuard", () => {
    useCdImportStore.getState().requestCancelImport();
    expect(isCdImportCancelRequested()).toBe(true);
  });

  it("starts a new session and clears an existing cancel prompt", () => {
    useCdImportStore.setState({
      cancelPrompt: {
        driveId: "drive-a",
        tracks: [makeTrack()],
      },
    });

    useCdImportStore.getState().startImport("drive-b", [1, 2]);

    const state = useCdImportStore.getState();
    expect(state.cancelPrompt).toBeNull();
    expect(state.cancelRequested).toBe(false);
    expect(state.importingDriveId).toBe("drive-b");
  });

  it("does not preserve completed display when finishImport is told to skip it", () => {
    useCdImportStore.getState().startImport("drive-a", [1, 2]);
    useCdImportStore.getState().completeTrack(1);
    useCdImportStore.getState().finishImport({ preserveCompletedDisplay: false });

    expect(useCdImportStore.getState().completedDisplayByDriveId).toEqual({});
  });

  it("keeps imported tracks and sets checkmarks when resolving keep", async () => {
    const loadLibrary = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ loadLibrary });

    useCdImportStore.getState().startImport("drive-a", [1, 2]);
    useCdImportStore.getState().setCancelPrompt({
      driveId: "drive-a",
      tracks: [makeTrack({ id: 10, trackNumber: 1 }), makeTrack({ id: 11, trackNumber: 2 })],
    });
    useCdImportStore.getState().finishImport({ preserveCompletedDisplay: false });

    await useCdImportStore.getState().resolveCancelPrompt("keep");

    expect(loadLibrary).toHaveBeenCalledOnce();
    expect(useCdImportStore.getState().cancelPrompt).toBeNull();
    expect(useCdImportStore.getState().completedDisplayByDriveId).toEqual({
      "drive-a": [1, 2],
    });
  });

  it("deletes imported tracks and files when resolving delete", async () => {
    const removeTracksFromLibrary = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ removeTracksFromLibrary });

    useCdImportStore.getState().startImport("drive-a", [1]);
    useCdImportStore.getState().setCancelPrompt({
      driveId: "drive-a",
      tracks: [makeTrack({ id: 99 })],
    });

    await useCdImportStore.getState().resolveCancelPrompt("delete");

    expect(removeTracksFromLibrary).toHaveBeenCalledWith([99], true);
    expect(useCdImportStore.getState().cancelPrompt).toBeNull();
  });

  it("ignores resolve when cancel prompt was cleared by a new import", async () => {
    const removeTracksFromLibrary = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ removeTracksFromLibrary });

    useCdImportStore.getState().setCancelPrompt({
      driveId: "drive-a",
      tracks: [makeTrack({ id: 5 })],
    });
    useCdImportStore.getState().startImport("drive-b", [1]);

    await useCdImportStore.getState().resolveCancelPrompt("delete");

    expect(removeTracksFromLibrary).not.toHaveBeenCalled();
  });
});
