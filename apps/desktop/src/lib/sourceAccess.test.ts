import { describe, expect, it } from "vitest";
import type { Source } from "../types/source";
import {
  countTracksBySource,
  describeSourceError,
  isSourceReadOnlyError,
  readOnlyReason,
  sourceDisplayName,
  sourceErrorCode,
  sourceRole,
  sourceSortRank,
  trackAccess,
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
const jazz = source({ id: 4, name: "Jazz", rootPath: "/Music/Jazz" });
const sourcesById = new Map(
  [managed, external, rock, jazz].map((s) => [s.id, s]),
);

describe("trackAccess", () => {
  it("lets Spiral write and manage its own tracks and ones still importing", () => {
    expect(trackAccess({ sourceId: 1 }, sourcesById)).toMatchObject({
      writable: true,
      managed: true,
    });
    expect(trackAccess({}, sourcesById)).toMatchObject({
      writable: true,
      managed: true,
    });
  });

  it("writes the files of folders the user added, but doesn't manage them", () => {
    expect(trackAccess({ sourceId: 3 }, sourcesById)).toMatchObject({
      writable: true,
      managed: false,
      source: rock,
    });
  });

  it("never writes Other's loose files", () => {
    expect(trackAccess({ sourceId: 2 }, sourcesById).writable).toBe(false);
    expect(trackAccess({ sourceId: 2 }, new Map()).writable).toBe(false);
  });

  it("decides by id before the sources list loads", () => {
    expect(trackAccess({ sourceId: 9 }, new Map())).toMatchObject({
      writable: true,
      managed: false,
      source: null,
    });
    expect(trackAccess({ sourceId: 1 }, new Map()).managed).toBe(true);
  });
});

describe("readOnlyReason", () => {
  it("is null when every track can be written", () => {
    expect(
      readOnlyReason([{ sourceId: 1 }, { sourceId: 4 }], sourcesById),
    ).toBeNull();
  });

  it("says when only some of a selection is read-only", () => {
    const some = readOnlyReason(
      [{ sourceId: 1 }, { sourceId: 2 }],
      sourcesById,
    );
    const all = readOnlyReason([{ sourceId: 2 }], sourcesById);
    expect(some?.message).not.toBe(all?.message);
    expect(some?.message).toMatch(/^Some/);
  });

  it("explains external files without a toggle to point at", () => {
    const reason = readOnlyReason([{ sourceId: 2 }], sourcesById);
    expect(reason?.watched).toBe(false);
    expect(reason?.message).toMatch(/outside the Spiral library/);
  });
});

describe("source error mapping", () => {
  it("recognizes coded errors by prefix", () => {
    expect(
      sourceErrorCode(
        "source_read_only: tag edit is not allowed because this file is not in the Spiral library",
      ),
    ).toBe("source_read_only");
    expect(sourceErrorCode(new Error("source_overlap: /a overlaps /b"))).toBe(
      "source_overlap",
    );
    expect(sourceErrorCode("source_inside_library: /x")).toBe(
      "source_inside_library",
    );
    expect(sourceErrorCode("source_not_folder: /x")).toBe("source_not_folder");
    expect(sourceErrorCode("disk full")).toBeNull();
    // Only a prefix counts.
    expect(sourceErrorCode("failed: source_read_only")).toBeNull();
  });

  it("localizes coded errors and passes others through", () => {
    expect(isSourceReadOnlyError("source_read_only: nope")).toBe(true);
    expect(describeSourceError("source_read_only: nope")).toMatch(
      /^Spiral can't change this file/,
    );
    expect(describeSourceError("source_overlap: /a overlaps /b")).toMatch(
      /overlaps a folder Spiral already watches/,
    );
    expect(describeSourceError("source_inside_library: /x")).toMatch(
      /inside the Spiral library/,
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

  it("names the seeded sources and uses folder names for watched ones", () => {
    expect(sourceDisplayName(managed)).toBe("Spiral library");
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
