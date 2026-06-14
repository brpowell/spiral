import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";

export function showActivityLogCopiedToast(count: number): void {
  if (count <= 0) return;

  const showToast = useBackgroundTasksStore.getState().showToast;
  showToast({
    key: "activity-log-copied",
    label: count === 1 ? "Copied 1 line" : `Copied ${count} lines`,
  });
}
