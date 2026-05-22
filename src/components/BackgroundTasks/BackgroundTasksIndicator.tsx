import { AnimatePresence, motion } from "framer-motion";
import { Button } from "../Button/Button";
import { IconCheck, IconClose } from "../icons";
import { panelMotion } from "../../lib/motion";
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
  return (
    <span className="background-tasks__icon background-tasks__icon--error" aria-hidden>
      !
    </span>
  );
}

function BackgroundTaskItem({ task }: { task: BackgroundTask }) {
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const progress = formatProgress(task);
  const isDone = task.status !== "running";

  return (
    <motion.div
      layout
      className={`background-tasks__item background-tasks__item--${task.status}`}
      role="status"
      aria-live="polite"
      {...panelMotion}
    >
      <TaskStatusIcon status={task.status} />
      <div className="background-tasks__body">
        <span className="background-tasks__label">{task.label}</span>
        {(progress || task.detail) && (
          <span className="background-tasks__meta">{progress ?? task.detail}</span>
        )}
      </div>
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

  return (
    <div className="background-tasks" aria-label="Background tasks">
      <AnimatePresence mode="popLayout">
        {tasks.map((task) => (
          <BackgroundTaskItem key={task.id} task={task} />
        ))}
      </AnimatePresence>
    </div>
  );
}
