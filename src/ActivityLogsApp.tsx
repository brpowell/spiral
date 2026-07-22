import { useEffect } from "react";
import { BackgroundTasksIndicator } from "./components/BackgroundTasks/BackgroundTasksIndicator";
import { ActivityLogsPanel } from "./components/ActivityLogs/ActivityLogsPanel";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useActivityLogsWindowClose } from "./hooks/useActivityLogsWindowClose";
import { initActivityLogBridge } from "./lib/activityLogBridge";
import "./ActivityLogsApp.css";

export function ActivityLogsApp() {
  useActivityLogsWindowClose();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void initActivityLogBridge()
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to init activity log bridge:", err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <CustomWindowFrame title="Activity Logs" className="activity-logs-app">
      <main className="activity-logs-app__main">
        <ActivityLogsPanel />
      </main>
      <BackgroundTasksIndicator />
    </CustomWindowFrame>
  );
}
