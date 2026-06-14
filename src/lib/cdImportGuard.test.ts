import { describe, expect, it, beforeEach } from "vitest";
import {
  cdImportDriveId,
  isCdImportBlockingPlayback,
  isCdImportCancelRequested,
  isCdImportRunning,
} from "./cdImportGuard";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdImportStore } from "../store/useCdImportStore";

describe("cdImportGuard", () => {
  beforeEach(() => {
    useBackgroundTasksStore.setState({ tasks: [] });
    useCdImportStore.setState({
      progress: null,
      importingDriveId: null,
      completedDisplayByDriveId: {},
      cancelRequested: false,
      cancelPrompt: null,
    });
  });

  it("blocks playback only for the drive being imported", () => {
    useCdImportStore.getState().startImport("drive-a", [1, 2]);
    useBackgroundTasksStore.setState({
      tasks: [
        {
          id: "task-1",
          key: "cd-import",
          label: "Importing CD",
          status: "running",
          createdAt: Date.now(),
        },
      ],
    });

    expect(isCdImportRunning()).toBe(true);
    expect(cdImportDriveId()).toBe("drive-a");
    expect(isCdImportBlockingPlayback("drive-a")).toBe(true);
    expect(isCdImportBlockingPlayback("drive-b")).toBe(false);
  });

  it("does not block when the import task is not running", () => {
    useCdImportStore.getState().startImport("drive-a", [1]);

    expect(isCdImportBlockingPlayback("drive-a")).toBe(false);
  });

  it("reports when cancel has been requested", () => {
    useCdImportStore.getState().startImport("drive-a", [1]);
    expect(isCdImportCancelRequested()).toBe(false);

    useCdImportStore.getState().requestCancelImport();
    expect(isCdImportCancelRequested()).toBe(true);
  });
});
