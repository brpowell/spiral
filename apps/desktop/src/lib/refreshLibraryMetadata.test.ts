import { describe, expect, it } from "vitest";
import { libraryRefreshSettleOptions } from "./refreshLibraryMetadata";

describe("libraryRefreshSettleOptions", () => {
  it("all updated → success title only", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 10,
        missing: 0,
        failed: 0,
        errors: [],
      }),
    ).toEqual({
      status: "success",
      label: "10 updated",
    });
  });

  it("updated + one missing → warning + inline detail", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 10,
        missing: 1,
        failed: 0,
        errors: ["Track X: File not found"],
      }),
    ).toEqual({
      status: "warning",
      label: "10 updated · 1 missing",
      detail: "Track X: File not found",
    });
  });

  it("one missing, no updates → error + inline detail", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 0,
        missing: 1,
        failed: 0,
        errors: ["Track X: File not found"],
      }),
    ).toEqual({
      status: "error",
      label: "Refresh: 1 missing",
      detail: "Track X: File not found",
    });
  });

  it("multiple missing (2+), no updates → error + View logs", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 0,
        missing: 3,
        failed: 0,
        errors: ["A: File not found", "B: File not found", "C: File not found"],
      }),
    ).toEqual({
      status: "error",
      label: "Refresh: 3 missing",
      logLink: true,
    });
  });

  it("one true failure with updates → warning + inline detail", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 10,
        missing: 0,
        failed: 1,
        errors: ["Track X: Permission denied"],
      }),
    ).toEqual({
      status: "warning",
      label: "10 updated · 1 failed",
      detail: "Track X: Permission denied",
    });
  });

  it("mixed missing + failed (2+ unresolved) → warning + View logs", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 10,
        missing: 2,
        failed: 1,
        errors: [
          "A: File not found",
          "B: File not found",
          "Track X: Permission denied",
        ],
      }),
    ).toEqual({
      status: "warning",
      label: "10 updated · 2 missing · 1 failed",
      logLink: true,
    });
  });

  it("all failed (2+), no updates → error + View logs", () => {
    expect(
      libraryRefreshSettleOptions({
        updated: 0,
        missing: 0,
        failed: 3,
        errors: ["a", "b", "c"],
      }),
    ).toEqual({
      status: "error",
      label: "Refresh: 3 failed",
      logLink: true,
    });
  });
});
