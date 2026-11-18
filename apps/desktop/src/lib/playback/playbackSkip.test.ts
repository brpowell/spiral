import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/art/artPath", () => ({
  fileExists: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/tauri", () => ({
  getUnavailableSourceIds: vi.fn().mockResolvedValue([]),
}));

import { fileExists } from "@/lib/art/artPath";
import { getUnavailableSourceIds } from "@/lib/tauri";
import { cdTrackListId } from "@/lib/cd/cdTracks";
import {
  getNextSkippingKnownUnplayable,
  findNextPlayableInOrder,
  isPlaybackIdKnownUnplayable,
} from "./playbackSkip";
import { getAutoplayNextId, getManualPreviousId } from "./playbackQueue";
import type { Track } from "@/types/track";

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
  const library = [track(1), track(2, { missingFile: true }), track(3)];

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

  it("reports each track it passes over", () => {
    const skipped: number[] = [];
    getNextSkippingKnownUnplayable(
      [1, 2, 3],
      1,
      "off",
      library,
      getAutoplayNextId,
      (id) => skipped.push(id),
    );
    expect(skipped).toEqual([2]);
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
    vi.mocked(fileExists).mockImplementation(
      async (path) => !path.endsWith("/2.mp3"),
    );

    const library = [track(1), track(2), track(3)];
    const onDiscoveredMissing = vi.fn();

    await expect(
      findNextPlayableInOrder([1, 2, 3], 1, "off", library, getAutoplayNextId, {
        onDiscoveredMissing,
      }),
    ).resolves.toBe(3);
    expect(onDiscoveredMissing).toHaveBeenCalledWith(2);
  });

  it("walks backward through missing tracks", async () => {
    const library = [track(1), track(2, { missingFile: true }), track(3)];

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
      findNextPlayableInOrder([cd1, cd2], cd1, "off", [], getAutoplayNextId),
    ).resolves.toBe(cd2);
  });
});

describe("findNextPlayableInOrder with an offline source", () => {
  beforeEach(() => {
    vi.mocked(fileExists).mockReset().mockResolvedValue(true);
    vi.mocked(getUnavailableSourceIds).mockReset().mockResolvedValue([]);
  });

  const library = [
    track(1, { sourceId: 1 }),
    track(2, { sourceId: 2 }),
    track(3, { sourceId: 2 }),
    track(4, { sourceId: 1 }),
    track(5, { sourceId: 2 }),
  ];

  it("passes over the whole source without trying its files", async () => {
    vi.mocked(getUnavailableSourceIds).mockResolvedValue([2]);
    const onSourceUnavailable = vi.fn();
    const onSkippedMissing = vi.fn();

    await expect(
      findNextPlayableInOrder(
        [1, 2, 3, 4, 5],
        1,
        "off",
        library,
        getAutoplayNextId,
        { onSourceUnavailable, onSkippedMissing },
      ),
    ).resolves.toBe(4);

    // Told once, at the first track reached; the rest are only passed over.
    expect(onSourceUnavailable).toHaveBeenCalledTimes(1);
    expect(onSourceUnavailable).toHaveBeenCalledWith(2, 2);
    expect(onSkippedMissing).toHaveBeenCalledWith(3);
    expect(fileExists).not.toHaveBeenCalledWith("/music/2.mp3");
    expect(fileExists).not.toHaveBeenCalledWith("/music/3.mp3");
    expect(getUnavailableSourceIds).toHaveBeenCalledTimes(1);
  });

  it("ends the walk when every track is offline", async () => {
    vi.mocked(getUnavailableSourceIds).mockResolvedValue([1, 2]);
    await expect(
      findNextPlayableInOrder([1, 2, 3], 1, "off", library, getAutoplayNextId),
    ).resolves.toBeNull();
    expect(fileExists).not.toHaveBeenCalled();
  });

  it("just tries each file when every source is reachable", async () => {
    vi.mocked(fileExists).mockImplementation(
      async (path) => !path.endsWith("/2.mp3"),
    );
    const onSourceUnavailable = vi.fn();
    const onDiscoveredMissing = vi.fn();

    await expect(
      findNextPlayableInOrder([1, 2, 3], 1, "off", library, getAutoplayNextId, {
        onSourceUnavailable,
        onDiscoveredMissing,
      }),
    ).resolves.toBe(3);
    expect(onSourceUnavailable).not.toHaveBeenCalled();
    expect(onDiscoveredMissing).toHaveBeenCalledWith(2);
  });

  it("falls back to trying files when the check fails", async () => {
    vi.mocked(getUnavailableSourceIds).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      findNextPlayableInOrder([1, 2], 1, "off", library, getAutoplayNextId),
    ).resolves.toBe(2);
  });
});

describe("tracks a scan marked missing", () => {
  const library = [
    track(1),
    track(2, { missingSince: "2026-10-01T12:00:00Z" }),
    track(3),
  ];

  it("are known unplayable", () => {
    expect(isPlaybackIdKnownUnplayable(2, library)).toBe(true);
    expect(isPlaybackIdKnownUnplayable(3, library)).toBe(false);
  });

  it("are skipped when advancing the queue", () => {
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

  it("are skipped without touching the disk on auto-advance", async () => {
    vi.mocked(fileExists).mockClear();
    await expect(
      findNextPlayableInOrder([1, 2, 3], 1, "off", library, getAutoplayNextId),
    ).resolves.toBe(3);
    expect(fileExists).not.toHaveBeenCalledWith("/music/2.mp3");
  });
});
