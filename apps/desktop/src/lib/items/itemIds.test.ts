import { describe, expect, it } from "vitest";
import { isPublisherId, isSemver, isSlug, slugifyId } from "./itemIds";

describe("item id helpers", () => {
  it("accepts kebab-case slugs only", () => {
    for (const ok of ["midnight-drive", "t3", "a", "a-b-c"]) {
      expect(isSlug(ok), ok).toBe(true);
    }
    for (const bad of ["", "-a", "a-", "a--b", "A", "a_b", "a b", "a.b"]) {
      expect(isSlug(bad), bad).toBe(false);
    }
    expect(isPublisherId("jane-doe")).toBe(true);
    expect(isPublisherId("Jane")).toBe(false);
  });

  it("accepts MAJOR.MINOR.PATCH with an optional suffix", () => {
    for (const ok of ["1.0.0", "10.20.30", "1.2.3-beta.1", "1.2.3+build.5"]) {
      expect(isSemver(ok), ok).toBe(true);
    }
    for (const bad of ["", "1.2", "v1.2.3", "1.2.3.", "1.2.3-"]) {
      expect(isSemver(bad), bad).toBe(false);
    }
  });

  it("slugifies free text", () => {
    expect(slugifyId("T3: Skynet Media Player")).toBe("t3-skynet-media-player");
    expect(slugifyId("  ")).toBe("untitled");
    expect(slugifyId("Bryan H")).toBe("bryan-h");
  });
});
