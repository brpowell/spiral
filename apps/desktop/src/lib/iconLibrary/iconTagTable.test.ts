import { describe, expect, it } from "vitest";
import {
  applyIconTagUpdate,
  countIconTags,
  isValidIconId,
  normalizeIconTag,
  normalizeIconTags,
  parseIconTagUpdate,
} from "./iconTagTable";

describe("iconTagTable", () => {
  it("normalizes a tag to lowercase with dashes for spaces", () => {
    expect(normalizeIconTag("  Now  Playing ")).toBe("now-playing");
    expect(normalizeIconTag("   ")).toBe("");
  });

  it("drops blanks and duplicates but keeps first-seen order", () => {
    expect(
      normalizeIconTags(["Music", "", " cover ", "music", "Cover"]),
    ).toEqual(["music", "cover"]);
  });

  it("only accepts camelCase-style ids", () => {
    expect(isValidIconId("setList")).toBe(true);
    expect(isValidIconId("disc2")).toBe(true);
    expect(isValidIconId("../etc")).toBe(false);
    expect(isValidIconId("has space")).toBe(false);
    expect(isValidIconId("")).toBe(false);
    expect(isValidIconId(3)).toBe(false);
  });

  it("parses a valid update and normalizes its tags", () => {
    expect(
      parseIconTagUpdate({ id: "play", tags: ["Music ", "music"] }),
    ).toEqual({ id: "play", tags: ["music"] });
  });

  it.each([
    null,
    "play",
    {},
    { id: "play" },
    { id: "play", tags: "music" },
    { id: "play", tags: [1] },
    { id: "bad id", tags: [] },
  ])("rejects a malformed update %#", (body) => {
    expect(parseIconTagUpdate(body)).toBeNull();
  });

  it("applies an update, keeps empty lists and sorts by id", () => {
    const next = applyIconTagUpdate(
      { b: ["x"], c: ["y"] },
      { id: "a", tags: [] },
    );
    expect(Object.keys(next)).toEqual(["a", "b", "c"]);
    expect(next.a).toEqual([]);
    expect(applyIconTagUpdate(next, { id: "b", tags: ["z"] }).b).toEqual(["z"]);
  });

  it("counts tags, most used first then alphabetical", () => {
    expect(
      countIconTags([
        { tags: ["music", "ui"] },
        { tags: ["music"] },
        { tags: ["ui", "audio"] },
        { tags: [] },
      ]),
    ).toEqual([
      { tag: "music", count: 2 },
      { tag: "ui", count: 2 },
      { tag: "audio", count: 1 },
    ]);
  });
});
