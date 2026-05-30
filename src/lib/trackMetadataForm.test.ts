import { describe, expect, it } from "vitest";
import type { Track } from "../types/track";
import { isTrackEditorFieldMixed, sharedArtistField } from "./trackMetadataForm";

function track(partial: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "T",
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    discNumber: null,
    year: null,
    genre: null,
    durationSeconds: null,
    filePath: "/a.mp3",
    artPath: null,
    dateAdded: "2020-01-01T00:00:00Z",
    playCount: 0,
    ...partial,
  };
}

describe("sharedArtistField", () => {
  it("treats equivalent delimiters as shared", () => {
    const tracks = [
      track({ id: 1, artist: "A / B" }),
      track({ id: 2, artist: "A; B" }),
    ];
    expect(sharedArtistField(tracks, (t) => t.artist)).toBe("A / B");
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
  it("artist not mixed when delimiters differ only", () => {
    const tracks = [
      track({ id: 1, artist: "A / B" }),
      track({ id: 2, artist: "A; B" }),
    ];
    expect(isTrackEditorFieldMixed(tracks, "artist")).toBe(false);
  });

  it("artist mixed when names differ", () => {
    const tracks = [
      track({ id: 1, artist: "A" }),
      track({ id: 2, artist: "B" }),
    ];
    expect(isTrackEditorFieldMixed(tracks, "artist")).toBe(true);
  });
});
