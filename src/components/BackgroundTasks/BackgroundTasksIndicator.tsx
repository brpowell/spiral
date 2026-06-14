import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Button } from "../common/Button/Button";
import { IconCheck, IconClose } from "../icons";
import { panelMotion } from "../../lib/motion";
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
      <span className="background-tasks__icon background-tasks__icon--success" aria-hidden>
        <IconCheck />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="background-tasks__icon background-tasks__icon--cancelled" aria-hidden>
        <IconClose />
      </span>
    );
  }
  return (
    <span className="background-tasks__icon background-tasks__icon--error" aria-hidden>
      !
    </span>
  );
}

function BackgroundTaskItem({ task }: { task: BackgroundTask }) {
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const requestCancelImport = useCdImportStore((s) => s.requestCancelImport);
  const cancelRequested = useCdImportStore((s) => s.cancelRequested);
  const progress = formatProgress(task);
  const isDone = task.status !== "running";
  const showCancel =
    task.status === "running" && task.cancellable && task.key === "cd-import";

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
        <span className="background-tasks__label">{task.label}</span>
        {(progress || task.detail) && (
          <span className="background-tasks__meta">{progress ?? task.detail}</span>
        )}
      </div>
      {showCancel && (
        <Button
          variant="ghost"
          size="sm"
          className="background-tasks__cancel"
          onClick={() => requestCancelImport()}
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
