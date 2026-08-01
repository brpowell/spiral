import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdImportStore } from "../store/useCdImportStore";

/** Reactive wrapper around `isCdImportBlockingPlayback` in `cdImportGuard`. */
export function useCdImportBlockingPlayback(driveId: string): boolean {
  const importingDriveId = useCdImportStore((s) => s.importingDriveId);
  const cdImportRunning = useBackgroundTasksStore((s) =>
    s.tasks.some((task) => task.key === "cd-import" && task.status === "running"),
  );
  return cdImportRunning && importingDriveId === driveId;
}
