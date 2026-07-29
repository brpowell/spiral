import { describe, expect, it } from "vitest";
import {
  firstImagePath,
  firstSpcardPath,
  isImagePath,
  isSpcardPath,
  routeDroppedPaths,
} from "./fileDropRouting";

describe("fileDropRouting", () => {
  it("detects common image extensions", () => {
    expect(isImagePath("/tmp/cover.PNG")).toBe(true);
    expect(isImagePath("/tmp/track.flac")).toBe(false);
  });

  it("detects Spiral Card extensions", () => {
    expect(isSpcardPath("/tmp/mine.spcard")).toBe(true);
    expect(isSpcardPath("/tmp/Mine.SPCARD")).toBe(true);
    expect(isSpcardPath("/tmp/track.flac")).toBe(false);
  });

  it("picks the first image path from a drop", () => {
    expect(
      firstImagePath(["/tmp/readme.txt", "/tmp/cover.jpg", "/tmp/other.png"]),
    ).toBe("/tmp/cover.jpg");
  });

  it("picks the first Spiral Card path from a drop", () => {
    expect(
      firstSpcardPath([
        "/tmp/song.flac",
        "/tmp/a.spcard",
        "/tmp/b.spcard",
      ]),
    ).toBe("/tmp/a.spcard");
  });

  it("routes library drops when not over an art zone", () => {
    expect(routeDroppedPaths(["/tmp/song.flac"])).toBe("library");
  });
});
