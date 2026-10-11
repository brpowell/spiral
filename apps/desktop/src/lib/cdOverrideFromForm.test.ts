import { describe, expect, it } from "vitest";
import { discOverridePatchFromAlbumForm } from "./cdOverrideFromForm";

describe("discOverridePatchFromAlbumForm", () => {
  it("stamps recording MBIDs from the release tracklist", () => {
    const patch = discOverridePatchFromAlbumForm({
      title: "Album",
      artist: "Artist",
      year: "1997",
      genre: "Rock",
      artPath: null,
      artChanged: false,
      releaseMbid: "1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b",
      trackNumbers: [1, 2],
      tracklist: [
        {
          discNumber: 1,
          trackNumber: 1,
          recordingMbid: "550e8400-e29b-41d4-a716-446655440000",
        },
        {
          discNumber: 1,
          trackNumber: 2,
          recordingMbid: "11111111-1111-1111-1111-111111111111",
        },
      ],
    });

    expect(patch.releaseMbid).toBe("1b3ea5f0-3c5a-4f0a-9c0e-0c1d2e3f4a5b");
    expect(patch.tracks?.["1"]?.recordingMbid).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(patch.tracks?.["2"]?.recordingMbid).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("clears recordings when the release is cleared", () => {
    const patch = discOverridePatchFromAlbumForm({
      title: "Album",
      artist: "Artist",
      year: "",
      genre: "",
      artPath: null,
      artChanged: false,
      releaseMbid: "",
      trackNumbers: [1],
      tracklist: null,
    });

    expect(patch.releaseMbid).toBe("");
    expect(patch.tracks?.["1"]?.recordingMbid).toBe("");
  });
});
