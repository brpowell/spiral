import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverArtCandidate } from "../types/coverArt";

const { fetchCoverArt, fetchCoverArtForRelease, cacheArtFromUrl } = vi.hoisted(
  () => ({
    fetchCoverArt: vi.fn(),
    fetchCoverArtForRelease: vi.fn(),
    cacheArtFromUrl: vi.fn(),
  }),
);

vi.mock("./tauri", () => ({
  cacheArtFromUrl,
  fetchCoverArt,
  fetchCoverArtForRelease,
  resolveCachedArtPath: vi.fn(),
}));

vi.mock("./network", () => ({
  isNetworkLikelyAvailable: () => true,
}));

vi.mock("./activityLog", () => ({
  logActivity: vi.fn(),
  withLogContext: (base: unknown, extra: unknown) => ({
    ...(typeof base === "object" && base != null ? base : {}),
    ...(typeof extra === "object" && extra != null ? extra : {}),
  }),
}));

import { logActivity } from "./activityLog";
import {
  fetchAlbumArtPreferringRelease,
  fetchCoverArtCandidates,
} from "./albumArtFetch";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

function candidate(
  url: string,
  extra?: Partial<CoverArtCandidate>,
): CoverArtCandidate {
  return {
    url,
    thumbnailUrl: null,
    fileSize: null,
    width: null,
    height: null,
    canonicalRank: 0,
    ...extra,
  };
}

const cdLogContext = {
  operationId: "op-1",
  driveId: "disk4",
  discId: "disc-1",
  artist: "Taylor Swift",
  album: "1989",
  releaseMbid: "release-mbid",
};

describe("fetchCoverArtCandidates", () => {
  beforeEach(() => {
    fetchCoverArt.mockReset();
    fetchCoverArtForRelease.mockReset();
  });

  it("uses release MBID when it returns candidates", async () => {
    const byRelease = [candidate("https://caa/release.jpg")];
    fetchCoverArtForRelease.mockResolvedValue(byRelease);

    const result = await fetchCoverArtCandidates({
      artist: "Artist",
      album: "Album",
      releaseMbid: "release-mbid",
    });

    expect(fetchCoverArtForRelease).toHaveBeenCalledWith(
      "release-mbid",
      undefined,
    );
    expect(fetchCoverArt).not.toHaveBeenCalled();
    expect(result).toEqual(byRelease);
  });

  it("falls back to artist/album search when MBID yields nothing", async () => {
    const bySearch = [candidate("https://caa/search.jpg")];
    fetchCoverArtForRelease.mockResolvedValue([]);
    fetchCoverArt.mockResolvedValue(bySearch);

    const result = await fetchCoverArtCandidates({
      artist: "Artist",
      album: "Album",
      releaseMbid: "release-mbid",
    });

    expect(fetchCoverArtForRelease).toHaveBeenCalled();
    expect(fetchCoverArt).toHaveBeenCalledWith("Artist", "Album", undefined);
    expect(result).toEqual(bySearch);
  });

  it("skips release lookup when MBID is missing", async () => {
    const bySearch = [candidate("https://caa/search.jpg")];
    fetchCoverArt.mockResolvedValue(bySearch);

    const result = await fetchCoverArtCandidates({
      artist: "Artist",
      album: "Album",
    });

    expect(fetchCoverArtForRelease).not.toHaveBeenCalled();
    expect(result).toEqual(bySearch);
  });
});

describe("fetchAlbumArtPreferringRelease", () => {
  beforeEach(() => {
    fetchCoverArt.mockReset();
    fetchCoverArtForRelease.mockReset();
    cacheArtFromUrl.mockReset();
    vi.mocked(logActivity).mockClear();
  });

  it("caches release art when MBID hits", async () => {
    fetchCoverArtForRelease.mockResolvedValue([
      candidate("https://caa/release.jpg"),
    ]);
    cacheArtFromUrl.mockResolvedValue({
      path: "/tmp/art.jpg",
      byteCount: 100,
    });

    const artPath = await fetchAlbumArtPreferringRelease({
      artist: "Artist",
      album: "Album",
      releaseMbid: "release-mbid",
      cacheLabel: "Artist - Album",
    });

    expect(fetchCoverArtForRelease).toHaveBeenCalledWith(
      "release-mbid",
      undefined,
    );
    expect(fetchCoverArt).not.toHaveBeenCalled();
    expect(artPath).toBe("/tmp/art.jpg");
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("falls back to search when release art is empty", async () => {
    fetchCoverArtForRelease.mockResolvedValue([]);
    fetchCoverArt.mockResolvedValue([candidate("https://caa/search.jpg")]);
    cacheArtFromUrl.mockResolvedValue({
      path: "/tmp/search.jpg",
      byteCount: 200,
    });

    const artPath = await fetchAlbumArtPreferringRelease({
      artist: "Artist",
      album: "Album",
      releaseMbid: "release-mbid",
      cacheLabel: "Artist - Album",
    });

    expect(fetchCoverArt).toHaveBeenCalledWith("Artist", "Album", undefined);
    expect(artPath).toBe("/tmp/search.jpg");
  });

  it("logs start and selected-candidate completion for CD auto-fetch", async () => {
    const selected = candidate("https://caa/1989.jpg", {
      width: 500,
      height: 500,
      canonicalRank: 0,
    });
    fetchCoverArtForRelease.mockResolvedValue([
      selected,
      candidate("https://caa/other.jpg", { canonicalRank: 100 }),
    ]);
    cacheArtFromUrl.mockResolvedValue({
      path: "/tmp/1989.jpg",
      byteCount: 89878,
    });

    const artPath = await fetchAlbumArtPreferringRelease({
      artist: "Taylor Swift",
      album: "1989",
      releaseMbid: "release-mbid",
      cacheLabel: "Taylor Swift - 1989",
      logContext: cdLogContext,
    });

    expect(artPath).toBe("/tmp/1989.jpg");
    expect(logActivity).toHaveBeenCalledTimes(2);
    expect(logActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "Fetching cover art for CD '1989'",
        operationId: "op-1",
        details: {
          releaseMbid: "release-mbid",
          queryUrl: "https://coverartarchive.org/release/release-mbid",
          driveId: "disk4",
          discId: "disc-1",
        },
      }),
    );
    expect(logActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "Cover art fetched for '1989'",
        operationId: "op-1",
        details: {
          byteCount: 89878,
          imageUrl: "https://caa/1989.jpg",
          cachePath: "/tmp/1989.jpg",
          candidateCount: 2,
          canonicalRank: 0,
          width: 500,
          height: 500,
        },
      }),
    );
  });

  it("logs a MusicBrainz search URL when CD auto-fetch has no release MBID", async () => {
    fetchCoverArt.mockResolvedValue([candidate("https://caa/search.jpg")]);
    cacheArtFromUrl.mockResolvedValue({
      path: "/tmp/search.jpg",
      byteCount: 200,
    });

    await fetchAlbumArtPreferringRelease({
      artist: "Joy Division",
      album: "Unknown Pleasures",
      cacheLabel: "Joy Division - Unknown Pleasures",
      logContext: {
        driveId: "disk4",
        discId: "disc-1",
        artist: "Joy Division",
        album: "Unknown Pleasures",
      },
    });

    expect(logActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Fetching cover art for CD 'Unknown Pleasures'",
        details: expect.objectContaining({
          queryUrl: expect.stringContaining(
            "https://musicbrainz.org/ws/2/release?query=",
          ),
          driveId: "disk4",
          discId: "disc-1",
        }),
      }),
    );
    expect(vi.mocked(logActivity).mock.calls[0][0].details).not.toHaveProperty(
      "releaseMbid",
    );
  });
});
