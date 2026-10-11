import type { BackgroundTaskAction } from "../store/useBackgroundTasksStore";
import {
  openActivityLogsWindow,
  type ActivityLogRevealTarget,
} from "./activityLogsWindow";
import { t } from "./i18n";

function viewLogsAction(
  logLink: ActivityLogRevealTarget,
): BackgroundTaskAction {
  return {
    id: "view-logs",
    label: t("toasts:actions.viewLogs"),
    variant: "secondary",
    dismissOnClick: false,
    onClick: () => {
      void openActivityLogsWindow(logLink);
    },
  };
}

/** Merge an explicit actions list with a synthesized View logs action. */
export function withLogLinkAction(
  actions: BackgroundTaskAction[] | undefined,
  logLink: ActivityLogRevealTarget | undefined,
): BackgroundTaskAction[] | undefined {
  if (!logLink?.entryId && !logLink?.operationId) return actions;
  if (actions?.some((action) => action.id === "view-logs")) return actions;
  return [...(actions ?? []), viewLogsAction(logLink)];
}
