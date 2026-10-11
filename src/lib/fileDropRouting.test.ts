import { describe, expect, it } from "vitest";
import {
  firstImagePath,
  isImagePath,
  routeDroppedPaths,
} from "./fileDropRouting";

describe("fileDropRouting", () => {
  it("detects common image extensions", () => {
    expect(isImagePath("/tmp/cover.PNG")).toBe(true);
    expect(isImagePath("/tmp/track.flac")).toBe(false);
  });

  it("picks the first image path from a drop", () => {
    expect(
      firstImagePath(["/tmp/readme.txt", "/tmp/cover.jpg", "/tmp/other.png"]),
    ).toBe("/tmp/cover.jpg");
  });

  it("routes library drops when not over an art zone", () => {
    expect(routeDroppedPaths(["/tmp/song.flac"])).toBe("library");
  });
});
