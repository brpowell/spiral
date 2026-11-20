import { describe, expect, it } from "vitest";
import {
  removedFilesUnreachablePayload,
  sourceScanPayload,
} from "./toastPayloads";

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

describe("removedFilesUnreachablePayload", () => {
  it("says nothing when every file was handled", () => {
    expect(removedFilesUnreachablePayload(0)).toBeNull();
  });

  it("warns that files in an offline folder were left alone", () => {
    expect(removedFilesUnreachablePayload(1)).toMatchObject({
      label: "Couldn't send a file to the trash",
      status: "warning",
    });
    expect(removedFilesUnreachablePayload(3)?.label).toBe(
      "Couldn't send 3 files to the trash",
    );
  });
});
