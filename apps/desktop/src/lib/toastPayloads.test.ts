import { describe, expect, it } from "vitest";
import { sourceScanPayload } from "./toastPayloads";

const none = {
  added: 0,
  updated: 0,
  moved: 0,
  missing: 0,
  restored: 0,
  failed: 0,
};

describe("sourceScanPayload", () => {
  it("lists only what changed", () => {
    expect(
      sourceScanPayload("Music", { ...none, added: 4, missing: 2 }),
    ).toMatchObject({
      label: "“Music” scanned",
      detail: "4 added, 2 missing",
      status: "success",
    });
  });

  it("says so when nothing changed", () => {
    expect(sourceScanPayload("Music", none).detail).toBe("No changes");
  });

  it("warns when files couldn't be read", () => {
    expect(
      sourceScanPayload("Music", { ...none, restored: 3, failed: 1 }),
    ).toMatchObject({ detail: "3 found again, 1 failed", status: "warning" });
  });
});
