import { describe, expect, it } from "vitest";
import { buildImportPlans } from "./cdImport";
import { discOverridePatchFromTrackForm } from "./cdOverrideFromForm";
import { pendingTrackFromInput } from "./pendingImportTrack";
import { cdTrackListId } from "./cdTracks";
import type { CdDisc } from "../types/cd";
import type { Track } from "../types/track";
import type { TrackEditorForm } from "./trackMetadataForm";

function sampleDisc(): CdDisc {
  return {
    driveId: "drive-1",
    discId: "disc-abc",
    album: "Album",
    artist: "Artist",
    year: 2000,
    genre: "Jazz",
    tracks: [
      {
        number: 1,
        title: "One",
        artist: "Artist",
        durationSeconds: 100,
        rating: 204,
      },
      {
        number: 2,
        title: "Two",
        artist: "Artist",
        durationSeconds: 120,
        rating: 0,
      },
    ],
  };
}

describe("buildImportPlans", () => {
  it("threads disc year, genre, and track rating into plans", () => {
    const plans = buildImportPlans(sampleDisc(), null, [1, 2]);
    expect(plans).toHaveLength(2);
    expect(plans[0].metadata.year).toBe(2000);
    expect(plans[0].metadata.genre).toBe("Jazz");
    expect(plans[0].rating).toBe(204);
    expect(plans[1].rating).toBe(0);
    expect(plans[0].metadata.title).toBe("One");
  });
});

describe("pendingTrackFromInput", () => {
  it("uses TrackInput.rating when provided", () => {
    const pending = pendingTrackFromInput(-1, "/tmp/a.flac", {
      title: "T",
      artist: "A",
      album: "Al",
      albumArtist: "A",
      trackNumber: 1,
      totalTracks: 1,
      discNumber: 1,
      totalDiscs: 1,
      year: null,
      genre: null,
      durationSeconds: 1,
      sampleRate: null,
      bitrate: null,
      codec: null,
      filePath: "",
      artPath: null,
      rating: 180,
    });
    expect(pending.rating).toBe(180);
  });
});

describe("discOverridePatchFromTrackForm", () => {
  it("builds track and album fields from the editor form", () => {
    const tracks: Track[] = [
      {
        id: cdTrackListId(1),
        title: "Old",
        artist: "Artist",
        album: "Album",
        albumArtist: "Artist",
        trackNumber: 1,
        totalTracks: 2,
        discNumber: 1,
        totalDiscs: 1,
        year: null,
        genre: null,
        durationSeconds: 100,
        sampleRate: null,
        bitrate: null,
        codec: null,
        filePath: "",
        artPath: null,
        dateAdded: "",
        playCount: 0,
        lastPlayedAt: null,
        rating: 0,
      },
    ];
    const form: TrackEditorForm = {
      title: "New Title",
      artist: "New Artist",
      album: "New Album",
      albumArtist: "New AA",
      year: "1991",
      trackNumber: "1",
      totalTracks: "2",
      discNumber: "1",
      totalDiscs: "1",
      genre: "Rock",
      rating: 128,
      lyrics: "",
      lyricsSyncedLines: null,
      lyricsSource: null,
      lyricsInstrumental: false,
    };
    const patch = discOverridePatchFromTrackForm(
      tracks,
      form,
      "/art.png",
      true,
    );
    expect(patch.album).toBe("New Album");
    expect(patch.albumArtist).toBe("New AA");
    expect(patch.year).toBe(1991);
    expect(patch.genre).toBe("Rock");
    expect(patch.artPath).toBe("/art.png");
    expect(patch.tracks?.["1"]).toEqual({
      title: "New Title",
      artist: "New Artist",
      rating: 128,
    });
  });
});
