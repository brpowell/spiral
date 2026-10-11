import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { normalizeArtistName } from "./artistNames";
import {
  artistFormsEqual,
  artistMetadataSaveTargets,
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

  it("renames a matching Artist credit when discography Album Artist changes", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Kid A Choir",
      albumArtist: "Radiohead",
      artistMbids: [ARTIST_A, ARTIST_B],
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
    expect(metadata.artist).toBe("RH; Kid A Choir");
    expect(metadata.artistMbids).toEqual([ARTIST_A, ARTIST_B]);
    expect(metadata.albumArtistMbids).toEqual([ARTIST_A]);
  });

  it("does not rename a non-matching Artist credit in discography mode", () => {
    const editedTrack = track({
      id: 1,
      artist: "Thom Yorke",
      albumArtist: "Radiohead",
    });
    const initial: ArtistEditorForm = { name: "Radiohead", artistMbid: "" };
    const edited: ArtistEditorForm = { name: "RH", artistMbid: "" };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Radiohead",
      "discography",
    );

    expect(metadata.albumArtist).toBe("RH");
    expect(metadata.artist).toBe("Thom Yorke");
  });

  it("replaces Artist when it is the same multi-value string as Album Artist", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Thom Yorke",
      albumArtist: "Radiohead; Thom Yorke",
    });
    const initial: ArtistEditorForm = {
      name: "Radiohead; Thom Yorke",
      artistMbid: "",
    };
    const edited: ArtistEditorForm = { name: "RH", artistMbid: "" };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Radiohead; Thom Yorke",
      "discography",
    );

    expect(metadata.albumArtist).toBe("RH");
    expect(metadata.artist).toBe("RH");
  });

  it("renames a matching Album Artist credit when a performer name changes", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Thom Yorke",
      albumArtist: "Radiohead",
    });
    const key = normalizeArtistName("Radiohead");
    const initial: ArtistEditorForm = { name: "Radiohead", artistMbid: "" };
    const edited: ArtistEditorForm = { name: "RH", artistMbid: "" };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      key,
      "performers",
    );

    expect(metadata.artist).toBe("RH; Thom Yorke");
    expect(metadata.albumArtist).toBe("RH");
  });

  it("does not rename a non-matching Album Artist in performers mode", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Thom Yorke",
      albumArtist: "Various Artists",
    });
    const key = normalizeArtistName("Thom Yorke");
    const initial: ArtistEditorForm = { name: "Thom Yorke", artistMbid: "" };
    const edited: ArtistEditorForm = { name: "TY", artistMbid: "" };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      key,
      "performers",
    );

    expect(metadata.artist).toBe("Radiohead; TY");
    expect(metadata.albumArtist).toBe("Various Artists");
  });

  it("writes a matching Artist MBID when a discography ID changes", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Kid A Choir",
      albumArtist: "Radiohead",
      artistMbids: [ARTIST_C, ARTIST_B],
      albumArtistMbids: [ARTIST_C],
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
    expect(metadata.artistMbids).toEqual([ARTIST_A, ARTIST_B]);
    expect(metadata.artist).toBe("Radiohead; Kid A Choir");
    expect(metadata.albumArtist).toBe("Radiohead");
  });

  it("writes a matching Album Artist MBID when a performer ID changes", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead; Thom Yorke",
      albumArtist: "Radiohead",
      artistMbids: [ARTIST_C, ARTIST_B],
      albumArtistMbids: [ARTIST_C],
    });
    const key = normalizeArtistName("Radiohead");
    const initial: ArtistEditorForm = {
      name: "Radiohead",
      artistMbid: ARTIST_C,
    };
    const edited: ArtistEditorForm = {
      name: "Radiohead",
      artistMbid: ARTIST_A,
    };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      key,
      "performers",
    );

    expect(metadata.artistMbids).toEqual([ARTIST_A, ARTIST_B]);
    expect(metadata.albumArtistMbids).toEqual([ARTIST_A]);
  });

  it("clears a matching Artist MBID when a discography ID is cleared", () => {
    const editedTrack = track({
      id: 1,
      artist: "Radiohead",
      albumArtist: "Radiohead",
      artistMbids: [ARTIST_A],
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
    expect(metadata.artistMbids).toEqual([]);
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

  it("renames a featured Artist credit without changing another album's Album Artist", () => {
    const editedTrack = track({
      id: 2,
      title: "Like That",
      artist: "Future; Metro Boomin; Kendrick Lamar",
      albumArtist: "Future; Metro Boomin",
      artistMbids: [ARTIST_B, ARTIST_C, ARTIST_A],
    });
    const initial: ArtistEditorForm = {
      name: "Kendrick Lamar",
      artistMbid: ARTIST_A,
    };
    const edited: ArtistEditorForm = { name: "K-Dot", artistMbid: ARTIST_A };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Kendrick Lamar",
      "discography",
      "appearance",
    );

    expect(metadata.artist).toBe("Future; Metro Boomin; K-Dot");
    expect(metadata.albumArtist).toBe("Future; Metro Boomin");
    expect(metadata.artistMbids).toEqual([ARTIST_B, ARTIST_C, ARTIST_A]);
  });

  it("writes a featured Artist MBID without touching another album's Album Artist IDs", () => {
    const editedTrack = track({
      id: 2,
      artist: "Future; Metro Boomin; Kendrick Lamar",
      albumArtist: "Future; Metro Boomin",
      artistMbids: [ARTIST_B, ARTIST_C, ARTIST_C],
      albumArtistMbids: [ARTIST_B, ARTIST_C],
    });
    const initial: ArtistEditorForm = {
      name: "Kendrick Lamar",
      artistMbid: "",
    };
    const edited: ArtistEditorForm = {
      name: "Kendrick Lamar",
      artistMbid: ARTIST_A,
    };

    const metadata = buildTrackArtistMetadata(
      editedTrack,
      edited,
      initial,
      "Kendrick Lamar",
      "discography",
      "appearance",
    );

    expect(metadata.artistMbids).toEqual([ARTIST_B, ARTIST_C, ARTIST_A]);
    expect(metadata.albumArtistMbids).toEqual([ARTIST_B, ARTIST_C]);
    expect(metadata.albumArtist).toBe("Future; Metro Boomin");
  });
});

describe("artistMetadataSaveTargets", () => {
  it("includes featured credits that are not in the discography group", () => {
    const owned = track({
      id: 1,
      artist: "Kendrick Lamar",
      albumArtist: "Kendrick Lamar",
    });
    const feature = track({
      id: 2,
      title: "Like That",
      artist: "Future; Metro Boomin; Kendrick Lamar",
      albumArtist: "Future; Metro Boomin",
    });
    const unrelated = track({
      id: 3,
      artist: "Future",
      albumArtist: "Future",
    });

    expect(
      artistMetadataSaveTargets(
        [owned],
        [owned, feature, unrelated],
        "Kendrick Lamar",
      ).map((target) => ({ id: target.track.id, scope: target.scope })),
    ).toEqual([
      { id: 1, scope: "owned" },
      { id: 2, scope: "appearance" },
    ]);
  });
});
