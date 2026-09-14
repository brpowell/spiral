// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  coverArtThumbSrc,
  coverOptionMetaText,
  isCoverArtThumbReady,
  preloadCoverArtThumbs,
  previewSrcForFetchedCover,
} from "./coverArtThumbs";
import type { CoverArtCandidate } from "../types/coverArt";

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function candidate(url: string): CoverArtCandidate {
  return {
    url,
    thumbnailUrl: PIXEL,
    fileSize: 12,
    width: 1,
    height: 1,
    canonicalRank: 0,
  };
}

describe("coverArtThumbs", () => {
  it("uses thumbnailUrl when present", () => {
    expect(coverArtThumbSrc(candidate("https://example/full.jpg"))).toBe(PIXEL);
  });

  it("uses the candidate thumb for a picked remote URL", () => {
    expect(
      previewSrcForFetchedCover("https://example/full.jpg", [
        candidate("https://example/full.jpg"),
      ]),
    ).toBe(PIXEL);
  });

  it("formats candidate size and dimensions", () => {
    expect(coverOptionMetaText(candidate("https://example/full.jpg"))).toBe(
      "12 B · 1×1",
    );
    expect(
      coverOptionMetaText({
        url: "https://example/full.jpg",
        thumbnailUrl: null,
        fileSize: null,
        width: null,
        height: null,
        canonicalRank: 0,
      }),
    ).toBeNull();
  });

  it("marks thumbs ready after preload", async () => {
    await preloadCoverArtThumbs([candidate("https://example/full.jpg")]);
    expect(isCoverArtThumbReady(PIXEL)).toBe(true);
  });
});
