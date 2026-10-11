import { describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
const logActivity = vi.fn();

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({ showToast }),
  },
}));

vi.mock("./activityLog", () => ({
  createOperationId: () => "op-metadata-1",
  logActivity: (...args: unknown[]) => logActivity(...args),
}));

import { showBulkTrackMetadataSaveToast } from "./trackMetadataToast";

describe("showBulkTrackMetadataSaveToast", () => {
  it("partial save with one missing file → warning + inline detail", () => {
    showToast.mockClear();
    logActivity.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 3,
      updated: 2,
      errors: ["Gone: File not found"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "2 updated · 1 missing",
      detail: "Gone: File not found",
      status: "warning",
    });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("one missing file, no updates → error + inline detail", () => {
    showToast.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 1,
      updated: 0,
      errors: ["Track: File not found"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "Metadata: 1 missing",
      detail: "Track: File not found",
      status: "error",
    });
  });

  it("all files missing (2+) → error + View logs", () => {
    showToast.mockClear();
    logActivity.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 2,
      updated: 0,
      errors: ["A: File not found", "B: File not found"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "Metadata: 2 missing",
      status: "error",
      logLink: { operationId: "op-metadata-1" },
    });
    expect(logActivity).toHaveBeenCalled();
  });

  it("one true failure → error + inline detail", () => {
    showToast.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 1,
      updated: 0,
      errors: ["Track: Permission denied"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "Metadata: 1 failed",
      detail: "Track: Permission denied",
      status: "error",
    });
  });

  it("partial with one failure → warning + inline detail", () => {
    showToast.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 3,
      updated: 2,
      errors: ["Track: Permission denied"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "2 updated · 1 failed",
      detail: "Track: Permission denied",
      status: "warning",
    });
  });

  it("multiple true failures → error + View logs", () => {
    showToast.mockClear();
    logActivity.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 2,
      updated: 0,
      errors: ["A: Permission denied", "B: Disk full"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "Metadata: 2 failed",
      status: "error",
      logLink: { operationId: "op-metadata-1" },
    });
    expect(logActivity).toHaveBeenCalled();
  });

  it("mixed missing + failed (2 unresolved) → error + View logs", () => {
    showToast.mockClear();
    logActivity.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 3,
      updated: 1,
      errors: ["A: File not found", "B: Permission denied"],
    });
    expect(showToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "1 updated · 1 missing · 1 failed",
      status: "warning",
      logLink: { operationId: "op-metadata-1" },
    });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ missing: 1, failed: 1 }),
      }),
    );
  });
});
