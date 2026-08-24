import { describe, expect, it } from "vitest";
import { entryToLogLine } from "./activityLogLine";
import type { ActivityLogEntry } from "../types/activityLog";

function entry(
  partial: Partial<ActivityLogEntry> = {},
): ActivityLogEntry {
  return {
    id: "1",
    timestampMs: 1,
    level: "info",
    domain: "metadata.musicbrainz",
    message: "Cache peek hit for disc abc",
    ...partial,
  };
}

describe("entryToLogLine", () => {
  it("folds driveId and discId into details instead of top-level fields", () => {
    const line = entryToLogLine(
      entry({
        context: { driveId: "disk4", discId: "abc" },
        details: {
          cacheKind: "hit",
          candidateCount: 16,
          discId: "abc",
          trackCount: 13,
        },
      }),
    );

    expect(line).not.toHaveProperty("driveId");
    expect(line).not.toHaveProperty("discId");
    expect(line.details).toEqual({
      driveId: "disk4",
      discId: "abc",
      cacheKind: "hit",
      candidateCount: 16,
      trackCount: 13,
    });
  });

  it("adds driveId and discId to details when the entry had none", () => {
    expect(
      entryToLogLine(
        entry({
          context: { driveId: "disk4", discId: "abc" },
        }),
      ).details,
    ).toEqual({
      driveId: "disk4",
      discId: "abc",
    });
  });
});
