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
    expect(plans[0].metadata.recordingMbid).toBeNull();
    expect(plans[0].metadata.releaseMbid).toBeNull();
    expect(plans[0].metadata.artistMbids).toEqual([]);
    expect(plans[0].metadata.albumArtistMbids).toEqual([]);
  });

  it("copies MusicBrainz IDs from the merged disc into rip metadata", () => {
    const disc = sampleDisc();
    disc.releaseMbid = "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b";
    disc.albumArtistMbids = ["89ad4ac3-39f7-470e-963a-56509c546377"];
    disc.tracks[0].recordingMbid = "550e8400-e29b-41d4-a716-446655440000";
    disc.tracks[0].artistMbids = ["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"];
    const [plan] = buildImportPlans(disc, null, [1]);
    expect(plan.metadata.releaseMbid).toBe(
      "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
    );
    expect(plan.metadata.albumArtistMbids).toEqual([
      "89ad4ac3-39f7-470e-963a-56509c546377",
    ]);
    expect(plan.metadata.recordingMbid).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(plan.metadata.artistMbids).toEqual([
      "a74b1b3a-d5ba-4d8a-b656-e59347b6780e",
    ]);
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
      recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
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
