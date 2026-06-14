import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdImportStore } from "../store/useCdImportStore";

const CD_IMPORT_TASK_KEY = "cd-import";

export function isCdImportRunning(): boolean {
  return useBackgroundTasksStore
    .getState()
    .tasks.some(
      (task) => task.key === CD_IMPORT_TASK_KEY && task.status === "running",
    );
}

export function cdImportDriveId(): string | null {
  return useCdImportStore.getState().importingDriveId;
}

/** True while a CD import is in progress for the given drive. */
export function isCdImportBlockingPlayback(driveId: string): boolean {
  if (!isCdImportRunning()) return false;
  return cdImportDriveId() === driveId;
}

export function isCdImportCancelRequested(): boolean {
  return useCdImportStore.getState().cancelRequested;
}
