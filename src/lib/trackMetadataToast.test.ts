import { describe, expect, it, vi } from "vitest";

const showErrorToast = vi.fn();

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({ showErrorToast }),
  },
}));

import { showBulkTrackMetadataSaveToast } from "./trackMetadataToast";

describe("showBulkTrackMetadataSaveToast", () => {
  it("summarizes partial success with per-track detail", () => {
    showErrorToast.mockClear();
    showBulkTrackMetadataSaveToast({
      total: 3,
      updated: 2,
      errors: ["Gone: File not found"],
    });
    expect(showErrorToast).toHaveBeenCalledWith({
      key: "track-metadata-save",
      label: "Updated 2 of 3 tracks",
      detail: "Gone: File not found",
    });
  });
});
