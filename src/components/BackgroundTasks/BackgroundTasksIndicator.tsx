import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Button } from "../common/Button/Button";
import { IconCancel, IconCheck, IconClose, IconRefresh } from "../icons";
import { LYRICS_FETCH_MISSING_KEY } from "../../lib/fetchMissingLyrics";
import { panelMotion } from "../../lib/motion";
import { cancelLyricsFetch } from "../../lib/tauri";
import { useCdImportStore } from "../../store/useCdImportStore";
import {
  useBackgroundTasksStore,
  type BackgroundTask,
} from "../../store/useBackgroundTasksStore";
import "./BackgroundTasksIndicator.css";

function formatProgress(task: BackgroundTask): string | null {
  if (!task.progress) return null;
  const { current, total } = task.progress;
  if (total <= 1) return null;
  return `${current} / ${total}`;
}

function TaskStatusIcon({ status }: { status: BackgroundTask["status"] }) {
  if (status === "running") {
    return <span className="background-tasks__spinner" aria-hidden />;
  }
  if (status === "success") {
    return (
      <span
        className="background-tasks__icon background-tasks__icon--success"
        aria-hidden
      >
        <IconCheck />
      </span>
    );
  }
  if (status === "info") {
    return (
      <span
        className="background-tasks__icon background-tasks__icon--info"
        aria-hidden
      >
        <IconRefresh />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="background-tasks__icon background-tasks__icon--cancelled"
        aria-hidden
      >
        <IconCancel />
      </span>
    );
  }
  return (
    <span
      className="background-tasks__icon background-tasks__icon--error"
      aria-hidden
    >
      !
    </span>
  );
}

function BackgroundTaskItem({ task }: { task: BackgroundTask }) {
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const requestCancel = useBackgroundTasksStore((s) => s.requestCancel);
  const requestCancelImport = useCdImportStore((s) => s.requestCancelImport);
  const cdCancelRequested = useCdImportStore((s) => s.cancelRequested);
  const progress = formatProgress(task);
  const meta = progress ?? task.detail;
  const isDone = task.status !== "running";
  const showCancel = task.status === "running" && task.cancellable;
  const hasActions = Boolean(task.actions?.length);
  const cancelRequested =
    task.key === "cd-import"
      ? cdCancelRequested
      : Boolean(task.cancelRequested);

  return (
    <motion.div
      layout={task.status !== "running"}
      className={`background-tasks__item background-tasks__item--${task.status}`}
      role="status"
      aria-live={task.status === "running" ? "off" : "polite"}
      {...panelMotion}
    >
      <TaskStatusIcon status={task.status} />
      <div className="background-tasks__body">
        <span className="background-tasks__label" title={task.label}>
          {task.label}
        </span>
        {meta && (
          <span className="background-tasks__meta" title={meta}>
            {meta}
          </span>
        )}
        {hasActions ? (
          <div className="background-tasks__actions">
            {task.actions!.map((action) => (
              <Button
                key={action.id}
                variant={action.variant ?? "ghost"}
                size="sm"
                className="background-tasks__action"
                onClick={() => {
                  dismissTask(task.id);
                  action.onClick();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {showCancel && (
        <Button
          variant="ghost"
          size="sm"
          className="background-tasks__cancel"
          onClick={() => {
            if (task.key === "cd-import") {
              requestCancelImport();
            } else {
              requestCancel(task.id);
              if (task.key === LYRICS_FETCH_MISSING_KEY) {
                void cancelLyricsFetch();
              }
            }
          }}
          disabled={cancelRequested}
        >
          {cancelRequested ? "Cancelling…" : "Cancel"}
        </Button>
      )}
      {isDone && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="background-tasks__dismiss"
          onClick={() => dismissTask(task.id)}
          aria-label="Dismiss"
        >
          <IconClose />
        </Button>
      )}
    </motion.div>
  );
}

export function BackgroundTasksIndicator() {
  const tasks = useBackgroundTasksStore((s) => s.tasks);

  return createPortal(
    <div className="background-tasks" aria-label="Background tasks">
      <AnimatePresence mode="sync">
        {tasks.map((task) => (
          <BackgroundTaskItem key={task.id} task={task} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
