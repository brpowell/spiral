import { describe, expect, it } from "vitest";
import { shortenHomePath } from "./homePath";

describe("shortenHomePath", () => {
  it("swaps the home folder for ~", () => {
    expect(shortenHomePath("/Users/me/Music/Spiral/Tracks", "/Users/me")).toBe(
      "~/Music/Spiral/Tracks",
    );
    expect(shortenHomePath("/Users/me/Music", "/Users/me/")).toBe("~/Music");
    expect(shortenHomePath("/Users/me", "/Users/me")).toBe("~");
  });

  it("leaves paths outside home alone", () => {
    expect(shortenHomePath("/Volumes/Music", "/Users/me")).toBe(
      "/Volumes/Music",
    );
    // A sibling that only shares the prefix isn't inside home.
    expect(shortenHomePath("/Users/meg/Music", "/Users/me")).toBe(
      "/Users/meg/Music",
    );
  });

  it("leaves paths alone without a home or on Windows", () => {
    expect(shortenHomePath("/Users/me/Music", null)).toBe("/Users/me/Music");
    expect(shortenHomePath("C:\\Users\\me\\Music", "C:\\Users\\me")).toBe(
      "C:\\Users\\me\\Music",
    );
  });
});
