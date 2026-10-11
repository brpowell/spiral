import { describe, expect, it } from "vitest";
import {
  entryVisibleWithFilters,
  resolveActivityLogRevealEntry,
} from "./activityLogsReveal";
import type { ActivityLogEntry } from "../types/activityLog";

function entry(
  partial: Partial<ActivityLogEntry> & Pick<ActivityLogEntry, "id" | "level">,
): ActivityLogEntry {
  return {
    timestampMs: 1,
    domain: "lyrics.fetch",
    message: "test",
    ...partial,
  };
}

describe("resolveActivityLogRevealEntry", () => {
  it("prefers entryId when present", () => {
    const entries = [
      entry({ id: "a", level: "info", operationId: "op-1" }),
      entry({ id: "b", level: "error", operationId: "op-1" }),
    ];
    expect(
      resolveActivityLogRevealEntry(entries, {
        entryId: "a",
        operationId: "op-1",
      })?.id,
    ).toBe("a");
  });

  it("picks highest-severity match for operationId", () => {
    const entries = [
      entry({ id: "a", level: "info", operationId: "op-1", timestampMs: 1 }),
      entry({ id: "b", level: "warn", operationId: "op-1", timestampMs: 2 }),
      entry({ id: "c", level: "info", operationId: "op-1", timestampMs: 3 }),
    ];
    expect(
      resolveActivityLogRevealEntry(entries, { operationId: "op-1" })?.id,
    ).toBe("b");
  });

  it("breaks severity ties with newest timestamp", () => {
    const entries = [
      entry({ id: "a", level: "warn", operationId: "op-1", timestampMs: 1 }),
      entry({ id: "b", level: "warn", operationId: "op-1", timestampMs: 5 }),
    ];
    expect(
      resolveActivityLogRevealEntry(entries, { operationId: "op-1" })?.id,
    ).toBe("b");
  });

  it("returns null when nothing matches", () => {
    expect(
      resolveActivityLogRevealEntry(
        [entry({ id: "a", level: "info", operationId: "other" })],
        { operationId: "missing" },
      ),
    ).toBeNull();
  });
});

describe("entryVisibleWithFilters", () => {
  it("respects min level and domain filters", () => {
    const e = entry({ id: "a", level: "warn", domain: "lyrics.fetch" });
    expect(entryVisibleWithFilters(e, [], "info")).toBe(true);
    expect(entryVisibleWithFilters(e, [], "error")).toBe(false);
    expect(entryVisibleWithFilters(e, ["lyrics.fetch"], "info")).toBe(true);
    expect(entryVisibleWithFilters(e, ["library.convert"], "info")).toBe(
      false,
    );
  });
});
