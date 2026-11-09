import { describe, expect, it } from "vitest";
import type { Source } from "@/types/source";
import {
  canDeleteFromDisk,
  countTracksBySource,
  describeSourceError,
  sourceDisplayName,
  sourceErrorCode,
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
const rock = source({ id: 3, name: "Rock", rootPath: "/Music/Rock" });

describe("canDeleteFromDisk", () => {
  it("allows deleting a present track's file", () => {
    expect(canDeleteFromDisk({})).toBe(true);
    expect(canDeleteFromDisk({ missingSince: null })).toBe(true);
  });

  it("never deletes a missing track's file", () => {
    expect(canDeleteFromDisk({ missingSince: "then" })).toBe(false);
  });
});

describe("source error mapping", () => {
  it("recognizes coded errors by prefix", () => {
    expect(sourceErrorCode("source_read_only: gone")).toBeNull();
    expect(sourceErrorCode(new Error("source_overlap: /a overlaps /b"))).toBe(
      "source_overlap",
    );
    expect(sourceErrorCode("source_spiral_data: /x")).toBe(
      "source_spiral_data",
    );
    expect(sourceErrorCode("no_source: nowhere to copy")).toBe("no_source");
    expect(sourceErrorCode("source_unavailable: /x")).toBe(
      "source_unavailable",
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
    expect(describeSourceError("source_spiral_data: /x")).toMatch(
      /is the Spiral folder/,
    );
    expect(describeSourceError("no_source: nowhere")).toMatch(
      /Add a folder first/,
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

  it("uses the stored name for every folder", () => {
    expect(sourceDisplayName(managed)).toBe("Tracks");
    expect(sourceDisplayName({ ...managed, name: "Music" })).toBe("Music");
    expect(sourceDisplayName(rock)).toBe("Rock");
  });

  it("sorts folders in the order added", () => {
    expect(sourceSortRank(undefined)).toBeLessThan(sourceSortRank(1));
    expect(sourceSortRank(1)).toBeLessThan(sourceSortRank(2));
    expect(sourceSortRank(2)).toBeLessThan(sourceSortRank(3));
  });
});
