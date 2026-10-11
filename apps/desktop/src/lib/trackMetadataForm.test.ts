import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import {
  buildLyricsOnlyMetadataUpdate,
  buildTrackMetadataFromForm,
  isLyricsInstrumentalMixed,
  isTrackEditorFieldMixed,
  mixedFieldPlaceholder,
  sharedArtistField,
  trackEditorFormsEqual,
  trackToForm,
  tracksToForm,
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

  it("recording MBID mixed when values differ", () => {
    const tracks = [
      track({ id: 1, recordingMbid: "550e8400-e29b-41d4-a716-446655440000" }),
      track({ id: 2, recordingMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    ];
    expect(isTrackEditorFieldMixed(tracks, "recordingMbid")).toBe(true);
    const form = tracksToForm(tracks);
    expect(form.recordingMbid).toBe("");
    expect(mixedFieldPlaceholder(tracks, "recordingMbid", form)).toBe(
      "Multiple values",
    );
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
    const lyrics = syncedLines.map((line) => line.text).join("\n");
    const edited = {
      ...initial,
      lyrics,
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
      plainText: lyrics,
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
    const editedTrack = track({
      id: 1,
      title: "Song",
      lyricsFormat: "instrumental",
    });
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

describe("recording MBID form", () => {
  it("loads a shared recording MBID", () => {
    const form = tracksToForm([
      track({ id: 1, recordingMbid: "550e8400-e29b-41d4-a716-446655440000" }),
      track({ id: 2, recordingMbid: "550e8400-e29b-41d4-a716-446655440000" }),
    ]);
    expect(form.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("applies a recording MBID override from release rematch", () => {
    const editedTrack = track({ id: 1, title: "Song" });
    const initial = trackToForm(editedTrack);
    const edited = { ...initial };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(metadata.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("preserves per-track recording MBIDs when the bulk field is unchanged", () => {
    const editedTrack = track({
      id: 1,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
    });
    const initial = tracksToForm([
      editedTrack,
      track({ id: 2, recordingMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    ]);
    const edited = { ...initial, title: "New Title" };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.title).toBe("New Title");
    expect(metadata.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("clears the recording MBID when rematch returns null", () => {
    const editedTrack = track({
      id: 1,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
    });
    const initial = trackToForm(editedTrack);
    const edited = { ...initial };

    const metadata = buildTrackMetadataFromForm(
      editedTrack,
      edited,
      initial,
      null,
      false,
      null,
    );

    expect(metadata.recordingMbid).toBeNull();
  });

  it("treats recording MBID as a form equality field", () => {
    const a = trackToForm(track({ id: 1 }));
    expect(trackEditorFormsEqual(a, { ...a })).toBe(true);
    expect(
      trackEditorFormsEqual(a, {
        ...a,
        recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe(false);
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

describe("tracksToForm lyrics instrumental", () => {
  it("marks instrumental when every track is instrumental", () => {
    const form = tracksToForm([
      track({ id: 1, lyricsFormat: "instrumental" }),
      track({ id: 2, lyricsFormat: "instrumental" }),
    ]);
    expect(form.lyricsInstrumental).toBe(true);
  });

  it("leaves instrumental off when any track is not", () => {
    const tracks = [
      track({ id: 1, lyricsFormat: "instrumental" }),
      track({ id: 2, lyricsFormat: "plain" }),
    ];
    expect(tracksToForm(tracks).lyricsInstrumental).toBe(false);
    expect(isLyricsInstrumentalMixed(tracks)).toBe(true);
  });

  it("leaves instrumental off when none are instrumental", () => {
    const tracks = [track({ id: 1, lyricsFormat: "plain" }), track({ id: 2 })];
    expect(tracksToForm(tracks).lyricsInstrumental).toBe(false);
    expect(isLyricsInstrumentalMixed(tracks)).toBe(false);
  });
});
