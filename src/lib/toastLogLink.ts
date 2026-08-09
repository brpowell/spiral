import type { BackgroundTaskAction } from "../store/useBackgroundTasksStore";
import {
  openActivityLogsWindow,
  type ActivityLogRevealTarget,
} from "./activityLogsWindow";
import { t } from "./i18n";

function viewLogsAction(
  logLink: ActivityLogRevealTarget,
  variant: "primary" | "secondary" | "ghost" = "primary",
): BackgroundTaskAction {
  return {
    id: "view-logs",
    label: t("toasts:actions.viewLogs"),
    variant,
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
  // Alongside another action (e.g. Review), View logs is the secondary control.
  const variant = actions && actions.length > 0 ? "secondary" : "primary";
  return [...(actions ?? []), viewLogsAction(logLink, variant)];
}
