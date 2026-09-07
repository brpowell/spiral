import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { normalizeArtistName } from "./artistNames";
import {
  artistFormsEqual,
  artistMbidPlaceholder,
  artistToForm,
  buildTrackArtistMetadata,
  type ArtistEditorForm,
} from "./artistMetadata";

const ARTIST_A = "a74b1b3a-d5ba-4d8a-b656-e59347b6780e";
const ARTIST_B = "89ad4ac3-39f7-470e-963a-56509c546377";
const ARTIST_C = "550e8400-e29b-41d4-a716-446655440000";

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

describe("artistToForm", () => {
  it("reads a shared discography album-artist MBID", () => {
    const form = artistToForm(
      {
        key: "Radiohead",
        name: "Radiohead",
        tracks: [
          track({
            id: 1,
            albumArtist: "Radiohead",
            albumArtistMbids: [ARTIST_A],
          }),
          track({
            id: 2,
            albumArtist: "Radiohead",
            albumArtistMbids: [ARTIST_A],
          }),
        ],
      },
      "discography",
    );
    expect(form.artistMbid).toBe(ARTIST_A);
  });

  it("reads the matching performer slot", () => {
    const form = artistToForm(
      {
        key: normalizeArtistName("Thom Yorke"),
        name: "Thom Yorke",
        tracks: [
          track({
            id: 1,
            artist: "Radiohead; Thom Yorke",
            artistMbids: [ARTIST_A, ARTIST_B],
          }),
        ],
      },
      "performers",
    );
    expect(form.artistMbid).toBe(ARTIST_B);
  });

  it("leaves mixed artist MBIDs empty", () => {
    const form = artistToForm(
      {
        key: "Radiohead",
        name: "Radiohead",
        tracks: [
          track({
            id: 1,
            albumArtist: "Radiohead",
            albumArtistMbids: [ARTIST_A],
          }),
          track({
            id: 2,
            albumArtist: "Radiohead",
            albumArtistMbids: [ARTIST_B],
          }),
        ],
      },
      "discography",
    );
    expect(form.artistMbid).toBe("");
  });
});

describe("artistMbidPlaceholder", () => {
  it("shows mixed-values when discography IDs differ", () => {
    const tracks = [
      track({
        id: 1,
        albumArtist: "Radiohead",
        albumArtistMbids: [ARTIST_A],
      }),
      track({
        id: 2,
        albumArtist: "Radiohead",
        albumArtistMbids: [ARTIST_B],
      }),
    ];
    const form: ArtistEditorForm = { name: "Radiohead", artistMbid: "" };
    expect(
      artistMbidPlaceholder(tracks, "Radiohead", "discography", form),
    ).toBe("Multiple values");
    expect(
      artistMbidPlaceholder([tracks[0]], "Radiohead", "discography", form),
    ).toBeUndefined();
  });
});

describe("artistFormsEqual", () => {
  it("includes artist MBID", () => {
    const a: ArtistEditorForm = { name: "Radiohead", artistMbid: ARTIST_A };
    expect(artistFormsEqual(a, { ...a })).toBe(true);
    expect(artistFormsEqual(a, { ...a, artistMbid: ARTIST_B })).toBe(false);
    expect(artistFormsEqual(a, { ...a, name: "Other" })).toBe(false);
  });
});

describe("buildTrackArtistMetadata", () => {
  it("writes a single discography ID onto albumArtistMbids", () => {
    const editedTrack = track({
      id: 1,
      albumArtist: "Radiohead",
      artistMbids: [ARTIST_C],
      recordingMbid: ARTIST_C,
    });
    const initial: ArtistEditorForm = { name: "Radiohead", artistMbid: "" };
    const edited: ArtistEditorForm = {
      name: "Radiohead",
      artistMbid: ARTIST_A,
    };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Radiohead",
      "discography",
    );

    expect(metadata.albumArtistMbids).toEqual([ARTIST_A]);
    expect(metadata.artistMbids).toEqual([ARTIST_C]);
    expect(metadata.recordingMbid).toBe(ARTIST_C);
    expect(metadata.albumArtist).toBe("Radiohead");
  });

  it("replaces the matching performer slot and leaves other IDs", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Thom Yorke",
      artistMbids: [ARTIST_A, ARTIST_B],
    });
    const key = normalizeArtistName("Thom Yorke");
    const initial: ArtistEditorForm = {
      name: "Thom Yorke",
      artistMbid: ARTIST_B,
    };
    const edited: ArtistEditorForm = {
      name: "Thom Yorke",
      artistMbid: ARTIST_C,
    };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      key,
      "performers",
    );

    expect(metadata.artistMbids).toEqual([ARTIST_A, ARTIST_C]);
    expect(metadata.artist).toBe("Radiohead; Thom Yorke");
  });

  it("preserves MBIDs when only the name changes", () => {
    const editedTrack = track({
      id: 1,
      albumArtist: "Radiohead",
      albumArtistMbids: [ARTIST_A],
    });
    const initial: ArtistEditorForm = {
      name: "Radiohead",
      artistMbid: ARTIST_A,
    };
    const edited: ArtistEditorForm = { name: "RH", artistMbid: ARTIST_A };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Radiohead",
      "discography",
    );

    expect(metadata.albumArtist).toBe("RH");
    expect(metadata.albumArtistMbids).toEqual([ARTIST_A]);
  });

  it("clears a single discography ID", () => {
    const editedTrack = track({
      id: 1,
      albumArtist: "Radiohead",
      albumArtistMbids: [ARTIST_A],
    });
    const initial: ArtistEditorForm = {
      name: "Radiohead",
      artistMbid: ARTIST_A,
    };
    const edited: ArtistEditorForm = { name: "Radiohead", artistMbid: "" };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Radiohead",
      "discography",
    );

    expect(metadata.albumArtistMbids).toEqual([]);
  });
});
