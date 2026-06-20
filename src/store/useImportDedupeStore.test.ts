import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/scheduling", () => ({
  afterUiTransition: vi.fn().mockResolvedValue(undefined),
}));

import { useImportDedupeStore } from "./useImportDedupeStore";
import type { ImportDuplicateContext } from "../lib/trackDedupe";
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
    filePath: overrides.filePath ?? "/incoming/airbag.flac",
    artPath: overrides.artPath ?? null,
  };
}

function existingTrack(id: number): Track {
  return {
    id,
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    albumArtist: "Radiohead",
    trackNumber: 1,
    discNumber: 1,
    year: 1997,
    genre: null,
    durationSeconds: 240,
    filePath: "/library/airbag.mp3",
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 2,
  };
}

function duplicateContext(): ImportDuplicateContext {
  return {
    incoming: trackInput(),
    existing: existingTrack(1),
    pendingId: -1,
    sourcePath: "/incoming/airbag.flac",
    remainingDuplicates: 2,
  };
}

describe("useImportDedupeStore", () => {
  beforeEach(() => {
    useImportDedupeStore.getState().resetImportDedupeSession();
  });

  it("resolves promptImportDedupe when batch rule is set", async () => {
    useImportDedupeStore.setState({ batchRule: "skip" });
    await expect(
      useImportDedupeStore.getState().promptImportDedupe(duplicateContext()),
    ).resolves.toBe("skip");
  });

  it("stores batch rule when applyToRemaining is true", async () => {
    const promptPromise = useImportDedupeStore
      .getState()
      .promptImportDedupe(duplicateContext());

    await useImportDedupeStore.getState().resolveImportDedupe("skip", true);

    await expect(promptPromise).resolves.toBe("skip");
    expect(useImportDedupeStore.getState().batchRule).toBe("skip");
  });

  it("does not store batch rule for import anyway", async () => {
    const promptPromise = useImportDedupeStore
      .getState()
      .promptImportDedupe(duplicateContext());

    await useImportDedupeStore.getState().resolveImportDedupe("import", true);

    await expect(promptPromise).resolves.toBe("import");
    expect(useImportDedupeStore.getState().batchRule).toBeNull();
  });
});
