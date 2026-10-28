import type { BackgroundTaskAction } from "../store/useBackgroundTasksStore";
import { openActivityLogsWindow } from "./activityLogsWindow";
import { t } from "./i18n";

function viewLogsAction(): BackgroundTaskAction {
  return {
    id: "view-logs",
    label: t("toasts:actions.viewLogs"),
    variant: "secondary",
    dismissOnClick: false,
    onClick: () => {
      void openActivityLogsWindow();
    },
  };
}

/** Merge an explicit actions list with a synthesized View logs action. */
export function withLogLinkAction(
  actions: BackgroundTaskAction[] | undefined,
  logLink: boolean | undefined,
): BackgroundTaskAction[] | undefined {
  if (!logLink) return actions;
  if (actions?.some((action) => action.id === "view-logs")) return actions;
  return [...(actions ?? []), viewLogsAction()];
}
