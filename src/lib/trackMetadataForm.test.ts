import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import {
  buildLyricsOnlyMetadataUpdate,
  buildTrackMetadataFromForm,
  isTrackEditorFieldMixed,
  sharedArtistField,
  trackToForm,
} from "./trackMetadataForm";

function track(partial: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "T",
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
    filePath: "/a.mp3",
    artPath: null,
    dateAdded: "2020-01-01T00:00:00Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...partial,
  };
}

describe("sharedArtistField", () => {
  it("returns shared semicolon-joined artist field", () => {
    const tracks = [
      track({ id: 1, artist: "A; B" }),
      track({ id: 2, artist: "A; B" }),
    ];
    expect(sharedArtistField(tracks, (t) => t.artist)).toBe("A; B");
  });

  it("returns empty when artist sets differ", () => {
    const tracks = [
      track({ id: 1, artist: "A" }),
      track({ id: 2, artist: "B" }),
    ];
    expect(sharedArtistField(tracks, (t) => t.artist)).toBe("");
  });
});

describe("isTrackEditorFieldMixed", () => {
  it("artist mixed when delimiter conventions differ", () => {
    const tracks = [
      track({ id: 1, artist: "A / B" }),
      track({ id: 2, artist: "A; B" }),
    ];
    expect(isTrackEditorFieldMixed(tracks, "artist")).toBe(true);
  });

  it("artist mixed when names differ", () => {
    const tracks = [
      track({ id: 1, artist: "A" }),
      track({ id: 2, artist: "B" }),
    ];
    expect(isTrackEditorFieldMixed(tracks, "artist")).toBe(true);
  });
});

describe("buildTrackMetadataFromForm", () => {
  it("writes total tracks and discs when changed", () => {
    const editedTrack = track({
      id: 1,
      title: "Song",
      trackNumber: 3,
      totalTracks: 10,
      discNumber: 1,
      totalDiscs: 2,
    });
    const initial = trackToForm(editedTrack);
    const edited = { ...initial, totalTracks: "12", totalDiscs: "3" };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.trackNumber).toBe(3);
    expect(metadata.totalTracks).toBe(12);
    expect(metadata.discNumber).toBe(1);
    expect(metadata.totalDiscs).toBe(3);
  });

  it("includes lyrics payload when lyrics changed", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = trackToForm(editedTrack);
    const edited = { ...initial, lyrics: "Line one\nLine two" };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyricsChanged).toBe(true);
    expect(metadata.lyrics).toMatchObject({
      format: "plain",
      source: "manual",
      plainText: "Line one\nLine two",
    });
  });

  it("includes line-synced lyrics payload when pasted LRC changes", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = trackToForm(editedTrack);
    const syncedLines = [{ text: "Synced line", startMs: 12_500 }];
    const edited = {
      ...initial,
      lyrics: "Synced line",
      lyricsSyncedLines: syncedLines,
    };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyricsChanged).toBe(true);
    expect(metadata.lyrics).toMatchObject({
      format: "line_synced",
      source: "manual",
      plainText: "Synced line",
      lines: syncedLines,
    });
  });

  it("preserves line-synced lyrics when LRC has repeated lines", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = trackToForm(editedTrack);
    const syncedLines = [
      { text: "Bob your head, rag top", startMs: 205_540 },
      { text: "Bob your head, rag top", startMs: 206_960 },
      { text: "Bob your head, rag top", startMs: 208_520 },
    ];
    const edited = {
      ...initial,
      lyrics: "Bob your head, rag top",
      lyricsSyncedLines: syncedLines,
    };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyrics).toMatchObject({
      format: "line_synced",
      plainText: "Bob your head, rag top",
      lines: syncedLines,
    });
  });

  it("detects pasted LRC text on save without stored synced lines", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = trackToForm(editedTrack);
    const edited = {
      ...initial,
      lyrics: "[00:12.50] Synced line",
      lyricsSyncedLines: null,
    };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyrics).toMatchObject({
      format: "line_synced",
      plainText: "Synced line",
      lines: [{ text: "Synced line", startMs: 12_500 }],
    });
  });

  it("clears lyrics when edited to empty", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = {
      ...trackToForm(editedTrack),
      lyrics: "Old lyrics",
      lyricsSyncedLines: null,
    };
    const edited = { ...initial, lyrics: "   ", lyricsSyncedLines: null };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyricsChanged).toBe(true);
    expect(metadata.lyrics).toBeNull();
  });

  it("marks instrumental when toggled on", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = {
      ...trackToForm(editedTrack),
      lyrics: "Old lyrics",
    };
    const edited = {
      ...initial,
      lyrics: "",
      lyricsSyncedLines: null,
      lyricsInstrumental: true,
      lyricsSource: "manual" as const,
    };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyricsChanged).toBe(true);
    expect(metadata.lyrics).toEqual({
      format: "instrumental",
      source: "manual",
      lines: [],
      plainText: "",
    });
  });

  it("clears instrumental mark when toggled off", () => {
    const editedTrack = track({ id: 1, title: "Song", lyricsFormat: "instrumental" });
    const initial = {
      ...trackToForm(editedTrack),
      lyricsInstrumental: true,
      lyricsSource: "lrclib" as const,
    };
    const edited = {
      ...initial,
      lyricsInstrumental: false,
      lyricsSource: "manual" as const,
    };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.lyricsChanged).toBe(true);
    expect(metadata.lyrics).toBeNull();
  });
});

describe("buildLyricsOnlyMetadataUpdate", () => {
  it("writes only lyrics while preserving other track metadata", () => {
    const editedTrack = track({
      id: 7,
      title: "Song",
      artist: "Artist",
      album: "Album",
      year: 1999,
    });

    const metadata = buildLyricsOnlyMetadataUpdate(editedTrack, {
      text: "Fetched line",
      syncedLines: null,
      source: "lrclib",
    });

    expect(metadata).toMatchObject({
      title: "Song",
      artist: "Artist",
      album: "Album",
      year: 1999,
      artChanged: false,
      lyricsChanged: true,
      lyrics: {
        format: "plain",
        source: "lrclib",
        plainText: "Fetched line",
      },
    });
  });
});
