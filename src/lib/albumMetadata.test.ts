import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import {
  albumFormsEqual,
  albumMixedFieldPlaceholder,
  albumToForm,
  buildTrackAlbumMetadata,
  type AlbumEditorForm,
} from "./albumMetadata";

function track(partial: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "T",
    artist: null,
    album: "Album",
    albumArtist: "Artist",
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

function album(tracks: Track[], year: number | null = 1999) {
  return {
    title: "Album",
    artist: "Artist",
    year,
    tracks,
  };
}

describe("albumToForm", () => {
  it("uses shared genre, total tracks, and total discs", () => {
    const form = albumToForm(
      album([
        track({
          id: 1,
          genre: "Rock",
          totalTracks: 10,
          totalDiscs: 2,
        }),
        track({
          id: 2,
          genre: "Rock",
          totalTracks: 10,
          totalDiscs: 2,
        }),
      ]),
    );

    expect(form.genre).toBe("Rock");
    expect(form.totalTracks).toBe("10");
    expect(form.totalDiscs).toBe("2");
  });

  it("leaves mixed genre and totals empty", () => {
    const form = albumToForm(
      album([
        track({ id: 1, genre: "Rock", totalTracks: 10, totalDiscs: 1 }),
        track({ id: 2, genre: "Pop", totalTracks: 12, totalDiscs: 2 }),
      ]),
    );

    expect(form.genre).toBe("");
    expect(form.totalTracks).toBe("");
    expect(form.totalDiscs).toBe("");
  });

  it("uses a shared release MBID", () => {
    const form = albumToForm(
      album([
        track({ id: 1, releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b" }),
        track({ id: 2, releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b" }),
      ]),
    );
    expect(form.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
  });

  it("leaves mixed release MBIDs empty", () => {
    const form = albumToForm(
      album([
        track({ id: 1, releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b" }),
        track({ id: 2, releaseMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
      ]),
    );
    expect(form.releaseMbid).toBe("");
  });
});

describe("albumMixedFieldPlaceholder", () => {
  it("shows mixed-values placeholder when the field is empty and mixed", () => {
    const tracks = [
      track({ id: 1, genre: "Rock" }),
      track({ id: 2, genre: "Pop" }),
    ];
    const form = albumToForm(album(tracks));
    expect(albumMixedFieldPlaceholder(tracks, "genre", form)).toBe(
      "Multiple values",
    );
  });

  it("shows mixed-values placeholder for mixed release MBIDs", () => {
    const tracks = [
      track({ id: 1, releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b" }),
      track({ id: 2, releaseMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    ];
    const form = albumToForm(album(tracks));
    expect(albumMixedFieldPlaceholder(tracks, "releaseMbid", form)).toBe(
      "Multiple values",
    );
  });
});

describe("albumFormsEqual", () => {
  it("includes genre and totals", () => {
    const a: AlbumEditorForm = {
      title: "Album",
      artist: "Artist",
      year: "1999",
      genre: "Rock",
      totalTracks: "10",
      totalDiscs: "1",
      releaseMbid: "",
    };
    expect(albumFormsEqual(a, { ...a, genre: "Pop" })).toBe(false);
    expect(albumFormsEqual(a, { ...a, totalTracks: "11" })).toBe(false);
    expect(albumFormsEqual(a, { ...a, totalDiscs: "2" })).toBe(false);
    expect(
      albumFormsEqual(a, {
        ...a,
        releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      }),
    ).toBe(false);
    expect(albumFormsEqual(a, { ...a })).toBe(true);
  });
});

describe("buildTrackAlbumMetadata", () => {
  it("writes genre and totals when changed", () => {
    const editedTrack = track({
      id: 1,
      title: "Song",
      genre: "Rock",
      totalTracks: 10,
      totalDiscs: 1,
      trackNumber: 3,
      discNumber: 1,
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = {
      ...initial,
      genre: "Jazz",
      totalTracks: "12",
      totalDiscs: "2",
    };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.genre).toBe("Jazz");
    expect(metadata.totalTracks).toBe(12);
    expect(metadata.totalDiscs).toBe(2);
    expect(metadata.trackNumber).toBe(3);
    expect(metadata.discNumber).toBe(1);
  });

  it("preserves per-track genre and totals when those fields are unchanged", () => {
    const editedTrack = track({
      id: 1,
      title: "Song",
      genre: "Pop",
      totalTracks: 8,
      totalDiscs: 3,
    });
    const initial = albumToForm(
      album([
        track({ id: 1, genre: "Rock", totalTracks: 10, totalDiscs: 1 }),
        track({ id: 2, genre: "Jazz", totalTracks: 12, totalDiscs: 2 }),
      ]),
    );
    const edited = { ...initial, title: "New Title" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.album).toBe("New Title");
    expect(metadata.genre).toBe("Pop");
    expect(metadata.totalTracks).toBe(8);
    expect(metadata.totalDiscs).toBe(3);
  });

  it("clears genre and totals when the form fields are emptied", () => {
    const editedTrack = track({
      id: 1,
      genre: "Rock",
      totalTracks: 10,
      totalDiscs: 2,
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = {
      ...initial,
      genre: "",
      totalTracks: "",
      totalDiscs: "",
    };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.genre).toBeNull();
    expect(metadata.totalTracks).toBeNull();
    expect(metadata.totalDiscs).toBeNull();
  });

  it("fans out a release MBID and stamps the matched recording", () => {
    const editedTrack = track({
      id: 1,
      trackNumber: 1,
      discNumber: 1,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
      releaseMbid: null,
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = {
      ...initial,
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
      {
        releaseChanged: true,
        tracklist: [
          {
            discNumber: 1,
            trackNumber: 1,
            recordingMbid: "11111111-1111-1111-1111-111111111111",
          },
        ],
      },
    );

    expect(metadata.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(metadata.recordingMbid).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("clears recordings when the release MBID is cleared", () => {
    const editedTrack = track({
      id: 1,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = { ...initial, releaseMbid: "" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
      { releaseChanged: true, tracklist: null },
    );

    expect(metadata.releaseMbid).toBeNull();
    expect(metadata.recordingMbid).toBeNull();
  });

  it("preserves recordings when the release MBID is unchanged", () => {
    const editedTrack = track({
      id: 1,
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = { ...initial, genre: "Jazz" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(metadata.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("backfills recordings when caller rematches an unchanged release", () => {
    const editedTrack = track({
      id: 1,
      trackNumber: 1,
      discNumber: 1,
      recordingMbid: null,
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = { ...initial, genre: "Jazz" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
      {
        releaseChanged: true,
        tracklist: [
          {
            discNumber: 1,
            trackNumber: 1,
            recordingMbid: "11111111-1111-1111-1111-111111111111",
          },
        ],
      },
    );

    expect(metadata.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(metadata.recordingMbid).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("preserves per-track release MBIDs when the field is unchanged", () => {
    const editedTrack = track({
      id: 1,
      releaseMbid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    const initial = albumToForm(
      album([
        track({ id: 1, releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b" }),
        track({ id: 2, releaseMbid: "cccccccc-dddd-eeee-ffff-000000000000" }),
      ]),
    );
    const edited = { ...initial, title: "New Title" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.album).toBe("New Title");
    expect(metadata.releaseMbid).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("clears the release MBID when the form field is emptied", () => {
    const editedTrack = track({
      id: 1,
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    });
    const initial = albumToForm(album([editedTrack]));
    const edited = { ...initial, releaseMbid: "" };

    const metadata = buildTrackAlbumMetadata(
      editedTrack,
      edited,
      initial,
      null,
      false,
    );

    expect(metadata.releaseMbid).toBeNull();
  });
});
