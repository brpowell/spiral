import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./scheduling", () => ({
  yieldForInteraction: vi.fn().mockResolvedValue(undefined),
  afterUiTransition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

vi.mock("./tauri", () => ({
  prepareImportFile: vi.fn().mockResolvedValue("/library/imported.mp3"),
  saveTrack: vi.fn(),
  replaceTrackFromImport: vi.fn(),
  getTrackLyrics: vi.fn().mockResolvedValue(null),
}));

import {
  commitImportEntries,
  formatImportLyricsDetail,
  formatImportSummary,
  resolveImportDuplicates,
} from "./import";
import { fileExists } from "./artPath";
import {
  getTrackLyrics,
  prepareImportFile,
  replaceTrackFromImport,
  saveTrack,
} from "./tauri";
import { useImportDedupeStore } from "../store/useImportDedupeStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, TrackInput } from "../types/track";
import type { TrackLyrics, TrackLyricsInput } from "../types/lyrics";

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
    lyrics: overrides.lyrics,
  };
}

function embeddedLyrics(plainText: string): TrackLyricsInput {
  return {
    format: "plain",
    source: "embedded",
    plainText,
    lines: plainText.split("\n").map((text) => ({ text })),
  };
}

function libraryLyrics(
  trackId: number,
  plainText: string,
): TrackLyrics {
  return {
    trackId,
    format: "plain",
    source: "manual",
    plainText,
    lines: plainText.split("\n").map((text) => ({ text })),
    updatedAt: "2024-01-01T00:00:00Z",
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

describe("formatImportLyricsDetail", () => {
  it("returns null when no tracks were tallied", () => {
    expect(
      formatImportLyricsDetail({
        lyricsFromTags: 0,
        lyricsFromSidecar: 0,
        lyricsNone: 0,
      }),
    ).toBeNull();
  });

  it("formats tags, sidecar, and none counts", () => {
    expect(
      formatImportLyricsDetail({
        lyricsFromTags: 310,
        lyricsFromSidecar: 482,
        lyricsNone: 412,
      }),
    ).toBe("Lyrics: 310 from tags, 482 from .lrc, 412 none");
  });

  it("omits zero buckets", () => {
    expect(
      formatImportLyricsDetail({
        lyricsFromTags: 0,
        lyricsFromSidecar: 5,
        lyricsNone: 0,
      }),
    ).toBe("Lyrics: 5 from .lrc");
  });
});

describe("resolveImportDuplicates", () => {
  beforeEach(() => {
    useImportDedupeStore.getState().resetImportDedupeSession();
    usePlayerStore.setState({ library: [libraryTrack({ id: 1 })] });
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.mocked(getTrackLyrics).mockResolvedValue(null);
  });

  it("marks skipped pending ids when user chooses skip", async () => {
    const resolutionPromise = resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    await vi.waitFor(() => {
      expect(useImportDedupeStore.getState().prompt).not.toBeNull();
    });
    await useImportDedupeStore
      .getState()
      .resolveImportDedupe({ action: "skip" }, false);

    const result = await resolutionPromise;
    expect(result.skippedPendingIds).toEqual(new Set([10]));
    expect(result.duplicateActions.get(10)).toEqual({ action: "skip" });
  });

  it("uses batch rule without prompting", async () => {
    useImportDedupeStore.setState({ batchRule: { action: "replace" } });

    const result = await resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.get(10)).toEqual({ action: "replace" });
  });

  it("auto-replaces when the library file is missing on disk", async () => {
    vi.mocked(fileExists).mockResolvedValue(false);

    const result = await resolveImportDuplicates(
      [{ sourcePath: "", metadata: trackInput(), pendingId: 10 }],
      { incomingPendingRip: true },
    );

    expect(result.skippedPendingIds.size).toBe(0);
    expect(result.duplicateActions.get(10)).toEqual({ action: "replace" });
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
    expect(result.duplicateActions.get(10)).toEqual({ action: "replace" });
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

  it("flags lyrics conflict on the prompt context", async () => {
    usePlayerStore.setState({
      library: [libraryTrack({ id: 1, lyricsFormat: "plain" })],
    });
    vi.mocked(getTrackLyrics).mockResolvedValue(
      libraryLyrics(1, "Library lyrics"),
    );

    const resolutionPromise = resolveImportDuplicates(
      [
        {
          sourcePath: "",
          metadata: trackInput({ lyrics: embeddedLyrics("Incoming lyrics") }),
          pendingId: 10,
        },
      ],
      { incomingPendingRip: true },
    );

    await vi.waitFor(() => {
      expect(useImportDedupeStore.getState().prompt).not.toBeNull();
    });
    expect(useImportDedupeStore.getState().prompt?.context.hasLyricsConflict).toBe(
      true,
    );

    await useImportDedupeStore.getState().resolveImportDedupe(
      { action: "replace", replaceLyrics: false },
      false,
    );

    const result = await resolutionPromise;
    expect(result.duplicateActions.get(10)).toEqual({
      action: "replace",
      replaceLyrics: false,
    });
  });
});

describe("commitImportEntries", () => {
  beforeEach(() => {
    useImportDedupeStore.getState().resetImportDedupeSession();
    usePlayerStore.setState({ library: [] });
    vi.mocked(prepareImportFile).mockResolvedValue("/library/imported.mp3");
    vi.mocked(saveTrack).mockResolvedValue(
      libraryTrack({ id: 42, filePath: "/library/imported.mp3" }),
    );
    vi.mocked(replaceTrackFromImport).mockResolvedValue(
      libraryTrack({ id: 1, filePath: "/library/airbag.mp3" }),
    );
    vi.mocked(getTrackLyrics).mockResolvedValue(null);
  });

  it("passes embedded lyrics to saveTrack when importing new tracks", async () => {
    const metadata = trackInput({
      lyrics: embeddedLyrics("Line one\nLine two"),
    });

    const result = await commitImportEntries(
      [{ sourcePath: "/incoming/song.mp3", metadata, pendingId: 1 }],
      { mode: "copy" },
    );

    expect(result.imported).toBe(1);
    expect(prepareImportFile).toHaveBeenCalledWith("/incoming/song.mp3", "copy");
    expect(saveTrack).toHaveBeenCalledWith({
      ...metadata,
      filePath: "/library/imported.mp3",
    });
    expect(vi.mocked(saveTrack).mock.calls[0]?.[0].lyrics).toEqual(metadata.lyrics);
    expect(result.lyricsFromTags).toBe(1);
    expect(result.lyricsFromSidecar).toBe(0);
    expect(result.lyricsNone).toBe(0);
  });

  it("tallies sidecar lyrics and none on new imports", async () => {
    const withSidecar = trackInput({
      title: "Sidecar Song",
      lyrics: {
        format: "line_synced",
        source: "sidecar",
        plainText: "Hello",
        lines: [{ text: "Hello", startMs: 1000 }],
      },
    });
    const without = trackInput({
      title: "No Lyrics",
      trackNumber: 2,
      lyrics: null,
    });

    const result = await commitImportEntries(
      [
        { sourcePath: "/a.mp3", metadata: withSidecar, pendingId: 1 },
        { sourcePath: "/b.mp3", metadata: without, pendingId: 2 },
      ],
      { mode: "copy" },
    );

    expect(result.imported).toBe(2);
    expect(result.lyricsFromSidecar).toBe(1);
    expect(result.lyricsNone).toBe(1);
    expect(result.lyricsFromTags).toBe(0);
  });

  it("strips incoming lyrics on replace when replaceLyrics is false", async () => {
    usePlayerStore.setState({
      library: [libraryTrack({ id: 1, lyricsFormat: "plain" })],
    });
    const metadata = trackInput({
      lyrics: embeddedLyrics("Incoming lyrics"),
    });

    const result = await commitImportEntries(
      [{ sourcePath: "/incoming/airbag.flac", metadata, pendingId: 10 }],
      {
        mode: "copy",
        duplicateActions: new Map([
          [10, { action: "replace", replaceLyrics: false }],
        ]),
      },
    );

    expect(result.replaced).toBe(1);
    expect(result.lyricsFromTags).toBe(0);
    expect(replaceTrackFromImport).toHaveBeenCalledWith({
      trackId: 1,
      sourcePath: "/incoming/airbag.flac",
      mode: "copy",
      track: { ...metadata, lyrics: null },
    });
  });

  it("passes incoming lyrics on replace when replaceLyrics is true", async () => {
    usePlayerStore.setState({
      library: [libraryTrack({ id: 1, lyricsFormat: "plain" })],
    });
    const metadata = trackInput({
      lyrics: embeddedLyrics("Incoming lyrics"),
    });

    const result = await commitImportEntries(
      [{ sourcePath: "/incoming/airbag.flac", metadata, pendingId: 10 }],
      {
        mode: "copy",
        duplicateActions: new Map([
          [10, { action: "replace", replaceLyrics: true }],
        ]),
      },
    );

    expect(result.replaced).toBe(1);
    expect(result.lyricsFromTags).toBe(1);
    expect(replaceTrackFromImport).toHaveBeenCalledWith({
      trackId: 1,
      sourcePath: "/incoming/airbag.flac",
      mode: "copy",
      track: metadata,
    });
  });
});
