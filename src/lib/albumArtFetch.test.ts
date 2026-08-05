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
  withLogContext: (_base: unknown, extra: unknown) => extra,
}));

import {
  fetchAlbumArtPreferringRelease,
  fetchCoverArtCandidates,
} from "./albumArtFetch";

function candidate(url: string): CoverArtCandidate {
  return {
    url,
    thumbnailUrl: null,
    fileSize: null,
    width: null,
    height: null,
    canonicalRank: 0,
  };
}

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
  });

  it("caches release art when MBID hits", async () => {
    fetchCoverArtForRelease.mockResolvedValue([
      candidate("https://caa/release.jpg"),
    ]);
    cacheArtFromUrl.mockResolvedValue("/tmp/art.jpg");

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
  });

  it("falls back to search when release art is empty", async () => {
    fetchCoverArtForRelease.mockResolvedValue([]);
    fetchCoverArt.mockResolvedValue([candidate("https://caa/search.jpg")]);
    cacheArtFromUrl.mockResolvedValue("/tmp/search.jpg");

    const artPath = await fetchAlbumArtPreferringRelease({
      artist: "Artist",
      album: "Album",
      releaseMbid: "release-mbid",
      cacheLabel: "Artist - Album",
    });

    expect(fetchCoverArt).toHaveBeenCalledWith("Artist", "Album", undefined);
    expect(artPath).toBe("/tmp/search.jpg");
  });
});
