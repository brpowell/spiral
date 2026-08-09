import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Button } from "../common/Button/Button";
import { ProgressBar } from "../common/ProgressBar/ProgressBar";
import {
  IconCancel,
  IconCheck,
  IconClose,
  IconErrorAlert,
  IconRefresh,
  IconWarningAlert,
} from "../icons";
import { LYRICS_FETCH_MISSING_KEY } from "../../lib/fetchMissingLyrics";
import { panelMotion } from "../../lib/motion";
import { cancelLyricsFetch } from "../../lib/tauri";
import { useCdImportStore } from "../../store/useCdImportStore";
import {
  useBackgroundTasksStore,
  type BackgroundTask,
  type BackgroundTaskAction,
  type BackgroundTaskActionsPlacement,
} from "../../store/useBackgroundTasksStore";
import "./BackgroundTasksIndicator.css";

function formatProgress(task: BackgroundTask): string | null {
  if (!task.progress) return null;
  const { current, total } = task.progress;
  if (total <= 1) return null;
  return `${current} / ${total}`;
}

function progressPercentLabel(task: BackgroundTask): string | null {
  if (!task.progress) return null;
  const { current, total } = task.progress;
  if (total <= 0) return null;
  const pct = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  return `${pct}%`;
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
  if (status === "warning") {
    return (
      <span
        className="background-tasks__icon background-tasks__icon--warning"
        aria-hidden
      >
        <IconWarningAlert />
      </span>
    );
  }
  return (
    <span
      className="background-tasks__icon background-tasks__icon--error"
      aria-hidden
    >
      <IconErrorAlert />
    </span>
  );
}

function resolveCancelAction(
  task: BackgroundTask,
  cancelRequested: boolean,
  onCancel: () => void,
): BackgroundTaskAction | null {
  if (task.status !== "running" || !task.cancellable) return null;
  if (task.actions?.some((action) => action.id === "cancel")) return null;
  return {
    id: "cancel",
    label: cancelRequested ? "Cancelling…" : "Cancel",
    variant: "ghost",
    align: "end",
    disabled: cancelRequested,
    dismissOnClick: false,
    onClick: onCancel,
  };
}

function resolveActions(
  task: BackgroundTask,
  cancelRequested: boolean,
  onCancel: () => void,
): BackgroundTaskAction[] {
  const cancel = resolveCancelAction(task, cancelRequested, onCancel);
  return [...(task.actions ?? []), ...(cancel ? [cancel] : [])];
}

function resolveActionsPlacement(
  task: BackgroundTask,
  actions: BackgroundTaskAction[],
): BackgroundTaskActionsPlacement {
  if (task.actionsPlacement) return task.actionsPlacement;
  // Cancellable-only toasts default to a trailing action column.
  if (
    actions.length > 0 &&
    actions.every((action) => action.id === "cancel" || action.align === "end")
  ) {
    return "end";
  }
  return "bottom";
}

function TaskActions({
  actions,
  placement,
  onAction,
}: {
  actions: BackgroundTaskAction[];
  placement: BackgroundTaskActionsPlacement;
  onAction: (action: BackgroundTaskAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <div
      className={`background-tasks__actions background-tasks__actions--${placement}`}
    >
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.variant ?? "ghost"}
          size="xs"
          className={[
            "background-tasks__action",
            action.align === "end" ? "background-tasks__action--end" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={action.disabled}
          onClick={() => onAction(action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function BackgroundTaskItem({ task }: { task: BackgroundTask }) {
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const requestCancel = useBackgroundTasksStore((s) => s.requestCancel);
  const requestCancelImport = useCdImportStore((s) => s.requestCancelImport);
  const cdCancelRequested = useCdImportStore((s) => s.cancelRequested);
  const showProgressBar =
    task.progressDisplay === "bar" &&
    task.progress != null &&
    task.progress.total > 1;
  const progressText = showProgressBar ? null : formatProgress(task);
  const rawMeta = progressText ?? task.detail;
  const meta = rawMeta?.trim() ? rawMeta : null;
  const progressLabel = showProgressBar ? progressPercentLabel(task) : null;
  const isDone = task.status !== "running";
  const cancelRequested =
    task.key === "cd-import"
      ? cdCancelRequested
      : Boolean(task.cancelRequested);

  const handleCancel = () => {
    if (task.key === "cd-import") {
      requestCancelImport();
    } else {
      requestCancel(task.id);
      if (task.key === LYRICS_FETCH_MISSING_KEY) {
        void cancelLyricsFetch();
      }
    }
  };

  const actions = resolveActions(task, cancelRequested, handleCancel);
  const actionsPlacement = resolveActionsPlacement(task, actions);
  const hasBottomActions = actions.length > 0 && actionsPlacement === "bottom";
  const hasEndActions = actions.length > 0 && actionsPlacement === "end";
  const hasFooter = Boolean(meta) || showProgressBar || hasBottomActions;
  const actionsOnlyFooter = hasBottomActions && !meta && !showProgressBar;
  // Keep an X when actions are non-dismissing (e.g. View logs). Choice toasts
  // with Update/Later already dismiss via those buttons.
  const showDismiss =
    isDone && actions.every((action) => action.dismissOnClick === false);

  const onAction = (action: BackgroundTaskAction) => {
    if (action.dismissOnClick !== false) {
      dismissTask(task.id);
    }
    action.onClick();
  };

  return (
    <motion.div
      layout={task.status !== "running"}
      className={[
        "background-tasks__item",
        `background-tasks__item--${task.status}`,
        hasFooter || hasEndActions ? "background-tasks__item--multiline" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live={task.status === "running" ? "off" : "polite"}
      {...panelMotion}
    >
      <div className="background-tasks__content">
        <div className="background-tasks__title-row">
          <TaskStatusIcon status={task.status} />
          <span className="background-tasks__label" title={task.label}>
            {task.label}
          </span>
        </div>
        {hasFooter && (
          <div
            className={[
              "background-tasks__body",
              actionsOnlyFooter ? "background-tasks__body--actions-only" : null,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {meta ? (
              <span className="background-tasks__meta" title={meta}>
                {meta}
              </span>
            ) : null}
            {showProgressBar && task.progress ? (
              <ProgressBar
                className="background-tasks__progress"
                value={task.progress.current}
                max={task.progress.total}
                size="sm"
                label={progressLabel ?? undefined}
              />
            ) : null}
            {hasBottomActions ? (
              <TaskActions
                actions={actions}
                placement="bottom"
                onAction={onAction}
              />
            ) : null}
          </div>
        )}
      </div>
      {hasEndActions ? (
        <TaskActions actions={actions} placement="end" onAction={onAction} />
      ) : null}
      {showDismiss && (
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

export function BackgroundTasksStack({
  className = "background-tasks",
}: {
  className?: string;
}) {
  const tasks = useBackgroundTasksStore((s) => s.tasks);

  return (
    <div className={className} aria-label="Background tasks">
      <AnimatePresence mode="sync">
        {tasks.map((task) => (
          <BackgroundTaskItem key={task.id} task={task} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export function BackgroundTasksIndicator() {
  return createPortal(<BackgroundTasksStack />, document.body);
}
