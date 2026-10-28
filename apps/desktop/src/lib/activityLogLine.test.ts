import { afterEach, describe, expect, it, vi } from "vitest";
import {
  entryToLogLine,
  formatActivityLogDisplayLine,
  formatActivityLogDisplayList,
} from "./activityLogLine";
import type { ActivityLogEntry } from "../types/activityLog";

function entry(partial: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: "1",
    timestampMs: 1,
    level: "info",
    domain: "metadata",
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

describe("formatActivityLogDisplayList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats visible rows as time, level, and message — not JSON", () => {
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("11:13:54");

    const first = entry({
      id: "1",
      timestampMs: 1_700_000_000_000,
      level: "info",
      message: "Cache peek hit for disc abc",
    });
    const second = entry({
      id: "2",
      timestampMs: 1_700_000_001_000,
      level: "error",
      message: "Couldn't download Xbox",
    });

    expect(formatActivityLogDisplayLine(first)).toBe(
      "11:13:54  info  Cache peek hit for disc abc",
    );
    expect(formatActivityLogDisplayList([first, second])).toBe(
      "11:13:54  info  Cache peek hit for disc abc\n11:13:54  error  Couldn't download Xbox",
    );
    expect(formatActivityLogDisplayList([first, second])).not.toMatch(/^\s*\{/);
  });
});
