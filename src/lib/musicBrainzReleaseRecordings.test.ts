import { describe, expect, it } from "vitest";
import { matchRecordingMbid } from "./musicBrainzReleaseRecordings";
import type { MusicBrainzTrackSlot } from "../types/musicbrainz";

const slots: MusicBrainzTrackSlot[] = [
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
  {
    discNumber: 2,
    trackNumber: 1,
    recordingMbid: "22222222-2222-2222-2222-222222222222",
  },
];

describe("matchRecordingMbid", () => {
  it("matches disc and track position", () => {
    expect(matchRecordingMbid({ discNumber: 1, trackNumber: 2 }, slots)).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(matchRecordingMbid({ discNumber: 2, trackNumber: 1 }, slots)).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("treats missing discNumber as 1", () => {
    expect(matchRecordingMbid({ trackNumber: 1 }, slots)).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("returns null when trackNumber is missing", () => {
    expect(matchRecordingMbid({ discNumber: 1 }, slots)).toBeNull();
  });

  it("returns null when the slot is missing", () => {
    expect(
      matchRecordingMbid({ discNumber: 1, trackNumber: 99 }, slots),
    ).toBeNull();
  });

  it("returns null when the slot is ambiguous", () => {
    const duped: MusicBrainzTrackSlot[] = [
      ...slots,
      {
        discNumber: 1,
        trackNumber: 1,
        recordingMbid: "33333333-3333-3333-3333-333333333333",
      },
    ];
    expect(
      matchRecordingMbid({ discNumber: 1, trackNumber: 1 }, duped),
    ).toBeNull();
  });

  it("returns null when the matched slot has no recording", () => {
    expect(
      matchRecordingMbid({ discNumber: 1, trackNumber: 1 }, [
        { discNumber: 1, trackNumber: 1, recordingMbid: null },
      ]),
    ).toBeNull();
  });
});
