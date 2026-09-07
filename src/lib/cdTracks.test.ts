import { describe, expect, it } from "vitest";
import { cdDiscTitle, cdTracksForList } from "./cdTracks";
import type { CdDisc } from "../types/cd";

function disc(partial: Partial<CdDisc> = {}): CdDisc {
  return {
    driveId: "drive-1",
    album: null,
    artist: null,
    tracks: [
      {
        number: 1,
        title: "Track 1",
        artist: null,
        durationSeconds: 180,
      },
    ],
    ...partial,
  };
}

describe("cdDiscTitle", () => {
  it("uses Unknown Disc when album and artist are missing", () => {
    expect(cdDiscTitle(disc())).toBe("Unknown Disc");
  });

  it("prefers album title over artist", () => {
    expect(
      cdDiscTitle(
        disc({
          album: "CALL ME IF YOU GET LOST",
          artist: "Tyler, The Creator",
        }),
      ),
    ).toBe("CALL ME IF YOU GET LOST");
  });

  it("falls back to artist when album is missing", () => {
    expect(cdDiscTitle(disc({ artist: "Tyler, The Creator" }))).toBe(
      "Tyler, The Creator",
    );
  });
});

describe("cdTracksForList", () => {
  it("uses Unknown Artist when track and disc artists are missing", () => {
    const [row] = cdTracksForList(disc());
    expect(row.artist).toBe("Unknown Artist");
    expect(row.albumArtist).toBe("Unknown Artist");
  });

  it("prefers track artist over disc artist", () => {
    const [row] = cdTracksForList(
      disc({
        artist: "Album Artist",
        tracks: [
          {
            number: 1,
            title: "Track 1",
            artist: "Featured",
            durationSeconds: 180,
          },
        ],
      }),
    );
    expect(row.artist).toBe("Featured");
  });

  it("copies MusicBrainz IDs onto synthetic list rows", () => {
    const [row] = cdTracksForList(
      disc({
        releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
        albumArtistMbids: ["89ad4ac3-39f7-470e-963a-56509c546377"],
        tracks: [
          {
            number: 1,
            title: "Track 1",
            artist: "Featured",
            durationSeconds: 180,
            recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
            artistMbids: ["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"],
          },
        ],
      }),
    );
    expect(row.recordingMbid).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(row.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(row.artistMbids).toEqual(["a74b1b3a-d5ba-4d8a-b656-e59347b6780e"]);
    expect(row.albumArtistMbids).toEqual([
      "89ad4ac3-39f7-470e-963a-56509c546377",
    ]);
  });
});
