// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  coverArtThumbSrc,
  isCoverArtThumbReady,
  preloadCoverArtThumbs,
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

  it("marks thumbs ready after preload", async () => {
    await preloadCoverArtThumbs([candidate("https://example/full.jpg")]);
    expect(isCoverArtThumbReady(PIXEL)).toBe(true);
  });
});
