import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

import { fileExists } from "./artPath";
import { cdTrackListId } from "./cdTracks";
import {
  getNextSkippingKnownUnplayable,
  findNextPlayableInOrder,
  isPlaybackIdKnownUnplayable,
} from "./playbackSkip";
import { getAutoplayNextId, getManualPreviousId } from "./playbackQueue";
import type { Track } from "../types/track";

function track(id: number, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: id,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/music/${id}.mp3`,
    artPath: null,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

describe("getNextSkippingKnownUnplayable", () => {
  const library = [
    track(1),
    track(2, { missingFile: true }),
    track(3),
  ];

  it("skips tracks flagged missing", () => {
    expect(
      getNextSkippingKnownUnplayable(
        [1, 2, 3],
        1,
        "off",
        library,
        getAutoplayNextId,
      ),
    ).toBe(3);
  });

  it("returns null when only missing tracks remain", () => {
    expect(
      getNextSkippingKnownUnplayable(
        [1, 2],
        1,
        "off",
        [track(1), track(2, { missingFile: true })],
        getAutoplayNextId,
      ),
    ).toBeNull();
  });

  it("skips known missing tracks when going backward", () => {
    const library = [track(1), track(2, { missingFile: true }), track(3)];
    expect(
      getNextSkippingKnownUnplayable(
        [1, 2, 3],
        3,
        "off",
        library,
        getManualPreviousId,
      ),
    ).toBe(1);
  });

  it("advances to CD list ids that are not in the library", () => {
    const cd1 = cdTrackListId(1);
    const cd2 = cdTrackListId(2);
    expect(
      getNextSkippingKnownUnplayable(
        [cd1, cd2],
        cd1,
        "off",
        [],
        getAutoplayNextId,
      ),
    ).toBe(cd2);
  });
});

describe("isPlaybackIdKnownUnplayable", () => {
  it("treats CD list ids as playable", () => {
    expect(isPlaybackIdKnownUnplayable(cdTrackListId(3), [])).toBe(false);
  });

  it("flags missing library tracks as unplayable", () => {
    expect(
      isPlaybackIdKnownUnplayable(2, [track(2, { missingFile: true })]),
    ).toBe(true);
  });
});

describe("findNextPlayableInOrder", () => {
  beforeEach(() => {
    vi.mocked(fileExists).mockResolvedValue(true);
  });

  it("skips tracks that fail the on-disk check", async () => {
    vi.mocked(fileExists).mockImplementation(async (path) => !path.endsWith("/2.mp3"));

    const library = [track(1), track(2), track(3)];
    const onDiscoveredMissing = vi.fn();

    await expect(
      findNextPlayableInOrder(
        [1, 2, 3],
        1,
        "off",
        library,
        getAutoplayNextId,
        { onDiscoveredMissing },
      ),
    ).resolves.toBe(3);
    expect(onDiscoveredMissing).toHaveBeenCalledWith(2);
  });

  it("walks backward through missing tracks", async () => {
    const library = [
      track(1),
      track(2, { missingFile: true }),
      track(3),
    ];

    await expect(
      findNextPlayableInOrder(
        [1, 2, 3],
        3,
        "off",
        library,
        getManualPreviousId,
      ),
    ).resolves.toBe(1);
  });

  it("advances to CD list ids that are not in the library", async () => {
    const cd1 = cdTrackListId(1);
    const cd2 = cdTrackListId(2);
    await expect(
      findNextPlayableInOrder(
        [cd1, cd2],
        cd1,
        "off",
        [],
        getAutoplayNextId,
      ),
    ).resolves.toBe(cd2);
  });
});
