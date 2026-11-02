import { describe, expect, it } from "vitest";
import type { Source } from "../types/source";
import {
  canDeleteFromDisk,
  countTracksBySource,
  describeSourceError,
  sourceDisplayName,
  sourceErrorCode,
  sourceRole,
  sourceSortRank,
} from "./sourceAccess";

function source(patch: Partial<Source> & Pick<Source, "id">): Source {
  return {
    rootPath: null,
    name: `Source ${patch.id}`,
    autoOrganize: false,
    pathFormat: null,
    importTarget: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

const managed = source({
  id: 1,
  name: "Tracks",
  rootPath: "/Music/Spiral Library/Tracks",
  autoOrganize: true,
  importTarget: true,
});
const external = source({ id: 2 });
const rock = source({ id: 3, name: "Rock", rootPath: "/Music/Rock" });

describe("canDeleteFromDisk", () => {
  it("allows deleting files in every source with a folder", () => {
    expect(canDeleteFromDisk({ sourceId: 1 })).toBe(true);
    expect(canDeleteFromDisk({ sourceId: 3 })).toBe(true);
    expect(canDeleteFromDisk({ sourceId: 9 })).toBe(true);
    expect(canDeleteFromDisk({})).toBe(true);
  });

  it("keeps Other's loose files on disk", () => {
    expect(canDeleteFromDisk({ sourceId: 2 })).toBe(false);
  });
});

describe("source error mapping", () => {
  it("recognizes coded errors by prefix", () => {
    expect(sourceErrorCode("source_read_only: gone")).toBeNull();
    expect(sourceErrorCode(new Error("source_overlap: /a overlaps /b"))).toBe(
      "source_overlap",
    );
    expect(sourceErrorCode("source_inside_library: /x")).toBe(
      "source_inside_library",
    );
    expect(sourceErrorCode("source_not_folder: /x")).toBe("source_not_folder");
    expect(sourceErrorCode("disk full")).toBeNull();
    // Only a prefix counts.
    expect(sourceErrorCode("failed: source_overlap")).toBeNull();
  });

  it("localizes coded errors and passes others through", () => {
    expect(describeSourceError("source_overlap: /a overlaps /b")).toMatch(
      /overlaps one of your sources/,
    );
    expect(describeSourceError("source_inside_library: /x")).toMatch(
      /inside the Spiral folder/,
    );
    expect(describeSourceError(new Error("disk full"))).toBe("disk full");
  });
});

describe("source helpers", () => {
  it("counts tracks and missing tracks per source", () => {
    const counts = countTracksBySource([
      { sourceId: 1, missingSince: null },
      { sourceId: 3, missingSince: "2026-10-01T00:00:00Z" },
      { sourceId: 3, missingSince: null },
      { missingSince: null },
    ]);
    expect(counts.get(1)).toEqual({ total: 1, missing: 0 });
    expect(counts.get(3)).toEqual({ total: 2, missing: 1 });
    expect(counts.size).toBe(2);
  });

  it("names the built-in sources and uses folder names for added ones", () => {
    expect(sourceDisplayName(managed)).toBe("Tracks");
    expect(sourceDisplayName(external)).toBe("Other files");
    expect(sourceDisplayName(rock)).toBe("Rock");
  });

  it("tells the built-in sources from the user's folders", () => {
    expect(sourceRole(managed)).toBe("default");
    expect(sourceRole(external)).toBe("other");
    expect(sourceRole(rock)).toBe("user");
  });

  it("sorts the library first and other files last", () => {
    expect(sourceSortRank(undefined)).toBe(sourceSortRank(1));
    expect(sourceSortRank(1)).toBeLessThan(sourceSortRank(3));
    expect(sourceSortRank(3)).toBeLessThan(sourceSortRank(4));
    expect(sourceSortRank(4)).toBeLessThan(sourceSortRank(2));
  });
});
