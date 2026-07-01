import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./scheduling", () => ({
  yieldForInteraction: vi.fn().mockResolvedValue(undefined),
  afterUiTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

import {
  formatImportSummary,
  resolveImportDuplicates,
} from "./import";
import { fileExists } from "./artPath";
import { useImportDedupeStore } from "../store/useImportDedupeStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, TrackInput } from "../types/track";

function trackInput(overrides: Partial<TrackInput> = {}): TrackInput {
  return {
    title: overrides.title ?? "Airbag",
    artist: overrides.artist ?? "Radiohead",
    album: overrides.album ?? "OK Computer",
    albumArtist: overrides.albumArtist ?? "Radiohead",
    trackNumber: overrides.trackNumber ?? 1,
    discNumber: overrides.discNumber ?? 1,
    year: overrides.year ?? 1997,
    genre: overrides.genre ?? null,
    durationSeconds: overrides.durationSeconds ?? 240,
    filePath: overrides.filePath ?? "",
    artPath: overrides.artPath ?? null,
  };
}

function libraryTrack(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? "Airbag",
    artist: overrides.artist ?? "Radiohead",
    album: overrides.album ?? "OK Computer",
    albumArtist: overrides.albumArtist ?? "Radiohead",
    trackNumber: overrides.trackNumber ?? 1,
    discNumber: overrides.discNumber ?? 1,
    year: overrides.year ?? 1997,
    genre: overrides.genre ?? null,
    durationSeconds: overrides.durationSeconds ?? 240,
    filePath: overrides.filePath ?? "/library/airbag.mp3",
    artPath: overrides.artPath ?? null,
    dateAdded: overrides.dateAdded ?? "2024-01-01",
    playCount: overrides.playCount ?? 2,
    rating: overrides.rating ?? 0,
    ...overrides,
  };
}

describe("formatImportSummary", () => {
  it("includes imported, replaced, and skipped counts", () => {
    expect(
      formatImportSummary({ imported: 2, replaced: 1, skipped: 3 }),
    ).toBe("Imported 2 tracks, Replaced 1 track, Skipped 3 duplicates");
  });
});

describe("resolveImportDuplicates", () => {
  beforeEach(() => {
    useImportDedupeStore.getState().resetImportDedupeSession();
    usePlayerStore.setState({ library: [libraryTrack({ id: 1 })] });
    vi.mocked(fileExists).mockResolvedValue(true);
  });

  it("marks skipped pending ids when user chooses skip", async () => {
    const resolutionPromise = resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    await vi.waitFor(() => {
      expect(useImportDedupeStore.getState().prompt).not.toBeNull();
    });
    await useImportDedupeStore.getState().resolveImportDedupe("skip", false);

    const result = await resolutionPromise;
    expect(result.skippedPendingIds).toEqual(new Set([10]));
    expect(result.duplicateActions.get(10)).toBe("skip");
  });

  it("uses batch rule without prompting", async () => {
    useImportDedupeStore.setState({ batchRule: "replace" });

    const result = await resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.get(10)).toBe("replace");
  });

  it("auto-replaces when the library file is missing on disk", async () => {
    vi.mocked(fileExists).mockResolvedValue(false);

    const result = await resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.get(10)).toBe("replace");
  });

  it("auto-replaces when the library track is flagged missing", async () => {
    usePlayerStore.setState({
      library: [libraryTrack({ id: 1, missingFile: true })],
    });

    const result = await resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.get(10)).toBe("replace");
  });

  it("returns empty resolutions when there are no duplicates", async () => {
    const result = await resolveImportDuplicates(
      [
        {
          sourcePath: "",
          metadata: trackInput({ title: "Paranoid Android", trackNumber: 2 }),
          pendingId: 11,
        },
      ],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.size).toBe(0);
  });
});
