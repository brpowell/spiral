import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/scheduling", () => ({
  afterUiTransition: vi.fn().mockResolvedValue(undefined),
}));

import {
  applyBatchRule,
  useImportDedupeStore,
} from "./useImportDedupeStore";
import type { ImportDuplicateContext } from "../lib/trackDedupe";
import type { Track, TrackInput } from "../types/track";

function trackInput(overrides: Partial<TrackInput> = {}): TrackInput {
  return {
    title: overrides.title ?? "Airbag",
    artist: overrides.artist ?? "Radiohead",
    album: overrides.album ?? "OK Computer",
    albumArtist: overrides.albumArtist ?? "Radiohead",
    trackNumber: overrides.trackNumber ?? 1,
    totalTracks: null,
    discNumber: overrides.discNumber ?? 1,
    totalDiscs: null,
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
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 1997,
    genre: null,
    durationSeconds: 240,
    filePath: "/library/airbag.mp3",
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 2,
    lastPlayedAt: null,
    rating: 0,
  };
}

function duplicateContext(
  overrides: Partial<ImportDuplicateContext> = {},
): ImportDuplicateContext {
  return {
    incoming: trackInput(),
    existing: existingTrack(1),
    pendingId: -1,
    sourcePath: "/incoming/airbag.flac",
    remainingDuplicates: 2,
    hasLyricsConflict: false,
    ...overrides,
  };
}

describe("useImportDedupeStore", () => {
  beforeEach(() => {
    useImportDedupeStore.getState().resetImportDedupeSession();
  });

  it("resolves promptImportDedupe when batch rule is set", async () => {
    useImportDedupeStore.setState({ batchRule: { action: "skip" } });
    await expect(
      useImportDedupeStore.getState().promptImportDedupe(duplicateContext()),
    ).resolves.toEqual({ action: "skip" });
  });

  it("stores batch rule when applyToRemaining is true", async () => {
    const promptPromise = useImportDedupeStore
      .getState()
      .promptImportDedupe(duplicateContext());

    await useImportDedupeStore
      .getState()
      .resolveImportDedupe({ action: "skip" }, true);

    await expect(promptPromise).resolves.toEqual({ action: "skip" });
    expect(useImportDedupeStore.getState().batchRule).toEqual({
      action: "skip",
    });
  });

  it("does not store batch rule for import anyway", async () => {
    const promptPromise = useImportDedupeStore
      .getState()
      .promptImportDedupe(duplicateContext());

    await useImportDedupeStore
      .getState()
      .resolveImportDedupe({ action: "import" }, true);

    await expect(promptPromise).resolves.toEqual({ action: "import" });
    expect(useImportDedupeStore.getState().batchRule).toBeNull();
  });

  it("carries replaceLyrics in batch rule for later conflicts", async () => {
    const promptPromise = useImportDedupeStore
      .getState()
      .promptImportDedupe(duplicateContext({ hasLyricsConflict: true }));

    await useImportDedupeStore.getState().resolveImportDedupe(
      { action: "replace", replaceLyrics: false },
      true,
    );

    await expect(promptPromise).resolves.toEqual({
      action: "replace",
      replaceLyrics: false,
    });

    await expect(
      useImportDedupeStore
        .getState()
        .promptImportDedupe(duplicateContext({ hasLyricsConflict: true })),
    ).resolves.toEqual({ action: "replace", replaceLyrics: false });
  });
});

describe("applyBatchRule", () => {
  it("scopes replaceLyrics to tracks with a lyrics conflict", () => {
    expect(
      applyBatchRule(
        { action: "replace", replaceLyrics: false },
        duplicateContext({ hasLyricsConflict: false }),
      ),
    ).toEqual({ action: "replace" });

    expect(
      applyBatchRule(
        { action: "replace", replaceLyrics: true },
        duplicateContext({ hasLyricsConflict: true }),
      ),
    ).toEqual({ action: "replace", replaceLyrics: true });
  });
});
