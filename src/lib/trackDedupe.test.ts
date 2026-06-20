import { describe, expect, it } from "vitest";
import {
  countRemainingBatchDuplicates,
  findLibraryDuplicate,
  tracksAreMetadataDuplicates,
} from "./trackDedupe";
import type { Track, TrackInput } from "../types/track";

function input(overrides: Partial<TrackInput> = {}): TrackInput {
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
    playCount: overrides.playCount ?? 3,
  };
}

describe("tracksAreMetadataDuplicates", () => {
  it("matches the same album slot across formats", () => {
    expect(
      tracksAreMetadataDuplicates(
        input({ filePath: "/incoming/airbag.flac" }),
        libraryTrack({ id: 1, filePath: "/library/airbag.mp3" }),
      ),
    ).toBe(true);
  });

  it("does not match different titles", () => {
    expect(
      tracksAreMetadataDuplicates(
        input({ title: "Airbag" }),
        libraryTrack({ id: 1, title: "Paranoid Android" }),
      ),
    ).toBe(false);
  });

  it("does not match different track numbers", () => {
    expect(
      tracksAreMetadataDuplicates(
        input({ trackNumber: 1 }),
        libraryTrack({ id: 1, trackNumber: 2 }),
      ),
    ).toBe(false);
  });

  it("rejects matches when durations diverge by more than 2 seconds", () => {
    expect(
      tracksAreMetadataDuplicates(
        input({ durationSeconds: 240 }),
        libraryTrack({ id: 1, durationSeconds: 300 }),
      ),
    ).toBe(false);
  });

  it("allows matches when only one side has duration", () => {
    expect(
      tracksAreMetadataDuplicates(
        input({ durationSeconds: null }),
        libraryTrack({ id: 1, durationSeconds: 240 }),
      ),
    ).toBe(true);
  });
});

describe("findLibraryDuplicate", () => {
  it("returns a persisted library match", () => {
    const existing = libraryTrack({ id: 42 });
    const match = findLibraryDuplicate(input(), [existing]);
    expect(match?.id).toBe(42);
  });

  it("ignores pending tracks", () => {
    const pending = libraryTrack({ id: -1 });
    const match = findLibraryDuplicate(input(), [pending]);
    expect(match).toBeUndefined();
  });

  it("excludes the same source path", () => {
    const existing = libraryTrack({
      id: 1,
      filePath: "/music/airbag.mp3",
    });
    const match = findLibraryDuplicate(input({ filePath: "/music/airbag.mp3" }), [
      existing,
    ], { excludeSourcePath: "/music/airbag.mp3" });
    expect(match).toBeUndefined();
  });
});

describe("countRemainingBatchDuplicates", () => {
  it("counts only remaining duplicate entries in the batch", () => {
    const library = [libraryTrack({ id: 1 })];
    const entries = [
      { sourcePath: "/in/new.flac", metadata: input({ title: "New Song" }) },
      {
        sourcePath: "/in/airbag.flac",
        metadata: input({ filePath: "/in/airbag.flac" }),
      },
      { sourcePath: "/in/other.flac", metadata: input({ title: "Other" }) },
      {
        sourcePath: "/in/airbag-copy.flac",
        metadata: input({ filePath: "/in/airbag-copy.flac" }),
      },
    ];

    expect(countRemainingBatchDuplicates(entries, 1, library)).toBe(1);
  });

  it("includes within-batch dupes after earlier imports in the batch", () => {
    const shared = input({ title: "Shared", trackNumber: 1 });
    const library = [
      libraryTrack({
        id: 1,
        title: "Shared",
        trackNumber: 1,
        filePath: "/in/a.flac",
      }),
    ];
    const entries = [
      { sourcePath: "/in/a.flac", metadata: shared },
      { sourcePath: "/in/b.flac", metadata: shared },
      { sourcePath: "/in/c.flac", metadata: shared },
    ];

    expect(countRemainingBatchDuplicates(entries, 1, library)).toBe(1);
  });
});
