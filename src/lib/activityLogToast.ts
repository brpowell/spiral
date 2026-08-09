import { activityLogCopiedPayload } from "./toastPayloads";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";

export function showActivityLogCopiedToast(count: number): void {
  const payload = activityLogCopiedPayload(count);
  if (!payload) return;
  useBackgroundTasksStore.getState().showToast(payload);
}
