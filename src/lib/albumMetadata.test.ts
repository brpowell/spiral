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
    };
    expect(albumFormsEqual(a, { ...a, genre: "Pop" })).toBe(false);
    expect(albumFormsEqual(a, { ...a, totalTracks: "11" })).toBe(false);
    expect(albumFormsEqual(a, { ...a, totalDiscs: "2" })).toBe(false);
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
});
