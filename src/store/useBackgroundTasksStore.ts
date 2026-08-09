import { create } from "zustand";
import type { ActivityLogRevealTarget } from "../lib/activityLogsWindow";
import { isBackgroundTaskCancelledError } from "../lib/backgroundTaskCancel";
import { isCdImportCancelledError } from "../lib/cdImport";
import { t } from "../lib/i18n";
import { waitForPaint, yieldToMain } from "../lib/scheduling";
import { withLogLinkAction } from "../lib/toastLogLink";

export type BackgroundTaskStatus =
  "running" | "success" | "warning" | "error" | "cancelled" | "info";

/** Where the toast renders its action buttons. */
export type BackgroundTaskActionsPlacement = "bottom" | "end";

/** How running-task progress is presented in the toast. */
export type BackgroundTaskProgressDisplay = "text" | "bar";

export interface BackgroundTaskAction {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  /** Push this action to the trailing edge within the actions group. */
  align?: "start" | "end";
  disabled?: boolean;
  /**
   * When false, keep the toast after click (e.g. Cancel while work continues).
   * Defaults to true.
   */
  dismissOnClick?: boolean;
  onClick: () => void;
}

export interface BackgroundTask {
  id: string;
  key?: string;
  label: string;
  status: BackgroundTaskStatus;
  detail?: string;
  progress?: { current: number; total: number };
  /** Defaults to `text` (`current / total`). */
  progressDisplay?: BackgroundTaskProgressDisplay;
  cancellable?: boolean;
  cancelRequested?: boolean;
  /** Confirmation / choice buttons (e.g. Update / Later). */
  actions?: BackgroundTaskAction[];
  /** Defaults to `bottom`; cancellable-only toasts default to `end`. */
  actionsPlacement?: BackgroundTaskActionsPlacement;
  createdAt: number;
}

export interface BackgroundTaskSettleAsOptions {
  status: Extract<
    BackgroundTaskStatus,
    "success" | "warning" | "error" | "info"
  >;
  label?: string;
  detail?: string;
  actions?: BackgroundTaskAction[];
  actionsPlacement?: BackgroundTaskActionsPlacement;
  logLink?: ActivityLogRevealTarget;
  /**
   * Auto-dismiss delay. `null` keeps the toast until the user acts or dismisses.
   * Defaults match `showToast` (brief success/info, longer errors/warnings, sticky with actions).
   */
  dismissMs?: number | null;
}

export interface BackgroundTaskRunContext {
  setLabel: (label: string) => void;
  setDetail: (detail: string) => void;
  clearDetail: () => void;
  setProgress: (current: number, total: number) => void;
  clearProgress: () => void;
  /** Remove the task when it completes instead of showing a success toast. */
  dismissSilently: () => void;
  /**
   * Settle the same toast into a terminal status (e.g. info + actions)
   * instead of the default success transition.
   */
  settleAs: (options: BackgroundTaskSettleAsOptions) => void;
  isCancelRequested: () => boolean;
}

interface RunInBackgroundOptions {
  label: string;
  key?: string;
  cancellable?: boolean;
  actionsPlacement?: BackgroundTaskActionsPlacement;
  /** Defaults to `text`. Use `bar` for determinate download-style progress. */
  progressDisplay?: BackgroundTaskProgressDisplay;
  run: (ctx: BackgroundTaskRunContext) => Promise<void>;
}

interface ShowToastOptions {
  label: string;
  detail?: string;
  /** Replaces any existing toast with the same key. */
  key?: string;
  /**
   * Auto-dismiss delay. `null` keeps the toast until the user acts or dismisses.
   * Defaults to a short delay for success, longer for errors, and no dismiss when
   * `actions` are present.
   */
  dismissMs?: number | null;
  status?: Extract<
    BackgroundTaskStatus,
    "success" | "warning" | "error" | "info" | "cancelled"
  >;
  actions?: BackgroundTaskAction[];
  actionsPlacement?: BackgroundTaskActionsPlacement;
  /** When set, synthesizes a View logs action that reveals this target. */
  logLink?: ActivityLogRevealTarget;
}

export type { ShowToastOptions };

interface BackgroundTasksState {
  tasks: BackgroundTask[];
  runInBackground: (options: RunInBackgroundOptions) => string;
  showToast: (options: ShowToastOptions) => string;
  showErrorToast: (options: ShowToastOptions) => string;
  requestCancel: (id: string) => void;
  dismissTask: (id: string) => void;
}

const SUCCESS_DISMISS_MS = 5000;
const ERROR_DISMISS_MS = 10000;
const BRIEF_TOAST_DISMISS_MS = 2000;

function scheduleAutoDismiss(
  get: () => BackgroundTasksState,
  id: string,
  ms: number,
  status: Extract<
    BackgroundTaskStatus,
    "success" | "warning" | "cancelled" | "error" | "info"
  >,
): void {
  window.setTimeout(() => {
    if (get().tasks.some((t) => t.id === id && t.status === status)) {
      get().dismissTask(id);
    }
  }, ms);
}

function defaultToastDismissMs(
  status: Extract<
    BackgroundTaskStatus,
    "success" | "warning" | "error" | "info" | "cancelled"
  >,
  hasActions: boolean,
  dismissMs: number | null | undefined,
): number | null {
  if (dismissMs !== undefined) return dismissMs;
  if (hasActions) return null;
  if (status === "error" || status === "warning") return ERROR_DISMISS_MS;
  if (status === "cancelled") return SUCCESS_DISMISS_MS;
  return BRIEF_TOAST_DISMISS_MS;
}

function patchTask(
  tasks: BackgroundTask[],
  id: string,
  patch: Partial<BackgroundTask>,
): BackgroundTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
}

const PROGRESS_UPDATE_MIN_MS = 250;

function createRunContext(
  id: string,
  set: (
    partial:
      | Partial<BackgroundTasksState>
      | ((state: BackgroundTasksState) => Partial<BackgroundTasksState>),
  ) => void,
  get: () => BackgroundTasksState,
): {
  ctx: BackgroundTaskRunContext;
  shouldDismissSilently: () => boolean;
  getSettleAs: () => BackgroundTaskSettleAsOptions | null;
} {
  let lastProgressAt = 0;
  let lastProgressPercent = -1;
  let dismissSilently = false;
  let settleAs: BackgroundTaskSettleAsOptions | null = null;

  const ctx: BackgroundTaskRunContext = {
    setLabel: (label) =>
      set((state) => ({ tasks: patchTask(state.tasks, id, { label }) })),
    setDetail: (detail) =>
      set((state) => ({ tasks: patchTask(state.tasks, id, { detail }) })),
    clearDetail: () =>
      set((state) => ({
        tasks: patchTask(state.tasks, id, { detail: undefined }),
      })),
    setProgress: (current, total) => {
      const now = Date.now();
      const isComplete = current >= total;
      const percent =
        total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 100;
      if (
        !isComplete &&
        percent === lastProgressPercent &&
        now - lastProgressAt < PROGRESS_UPDATE_MIN_MS
      ) {
        return;
      }
      lastProgressAt = now;
      lastProgressPercent = percent;
      set((state) => ({
        tasks: patchTask(state.tasks, id, {
          progress: { current, total },
        }),
      }));
    },
    clearProgress: () => {
      set((state) => ({
        tasks: patchTask(state.tasks, id, { progress: undefined }),
      }));
    },
    dismissSilently: () => {
      dismissSilently = true;
      settleAs = null;
    },
    settleAs: (options) => {
      settleAs = options;
      dismissSilently = false;
    },
    isCancelRequested: () =>
      get().tasks.find((task) => task.id === id)?.cancelRequested === true,
  };

  return {
    ctx,
    shouldDismissSilently: () => dismissSilently,
    getSettleAs: () => settleAs,
  };
}

export const useBackgroundTasksStore = create<BackgroundTasksState>(
  (set, get) => ({
    tasks: [],

    runInBackground: ({
      label,
      key,
      cancellable,
      actionsPlacement,
      progressDisplay,
      run,
    }) => {
      if (key) {
        const existing = get().tasks.find(
          (task) => task.key === key && task.status === "running",
        );
        if (existing) return existing.id;
      }

      const id = crypto.randomUUID();
      const task: BackgroundTask = {
        id,
        key,
        label,
        status: "running",
        cancellable,
        actionsPlacement,
        progressDisplay,
        createdAt: Date.now(),
      };

      set((state) => ({
        tasks: [
          ...(key ? state.tasks.filter((t) => t.key !== key) : state.tasks),
          task,
        ],
      }));

      const { ctx, shouldDismissSilently, getSettleAs } = createRunContext(
        id,
        set,
        get,
      );

      void (async () => {
        await waitForPaint();
        await yieldToMain();
        try {
          await run(ctx);
          if (shouldDismissSilently()) {
            get().dismissTask(id);
            return;
          }

          const settle = getSettleAs();
          if (settle) {
            const actions = withLogLinkAction(settle.actions, settle.logLink);
            const resolvedDismissMs = defaultToastDismissMs(
              settle.status,
              Boolean(actions?.length),
              settle.dismissMs,
            );
            set((state) => {
              const current = state.tasks.find((t) => t.id === id);
              return {
                tasks: patchTask(state.tasks, id, {
                  status: settle.status,
                  label: settle.label ?? current?.label ?? label,
                  detail: settle.detail,
                  actions,
                  actionsPlacement: settle.actionsPlacement,
                  progress: undefined,
                  cancellable: undefined,
                  cancelRequested: undefined,
                }),
              };
            });
            if (resolvedDismissMs != null) {
              scheduleAutoDismiss(get, id, resolvedDismissMs, settle.status);
            }
            return;
          }

          set((state) => ({
            tasks: patchTask(state.tasks, id, {
              status: "success",
              progress: undefined,
            }),
          }));
          scheduleAutoDismiss(get, id, SUCCESS_DISMISS_MS, "success");
        } catch (err) {
          if (isCdImportCancelledError(err)) {
            set((state) => ({
              tasks: patchTask(state.tasks, id, {
                status: "cancelled",
                label: t("toasts:import.cancelled"),
                detail: undefined,
                progress: undefined,
              }),
            }));
            scheduleAutoDismiss(get, id, SUCCESS_DISMISS_MS, "cancelled");
            return;
          }

          if (isBackgroundTaskCancelledError(err)) {
            set((state) => ({
              tasks: patchTask(state.tasks, id, {
                status: "cancelled",
                label: err.toastLabel,
                detail: undefined,
                progress: undefined,
              }),
            }));
            const resolvedDismissMs =
              err.dismissMs !== undefined ? err.dismissMs : SUCCESS_DISMISS_MS;
            if (resolvedDismissMs != null) {
              scheduleAutoDismiss(get, id, resolvedDismissMs, "cancelled");
            }
            return;
          }

          const message = err instanceof Error ? err.message : String(err);
          set((state) => ({
            tasks: patchTask(state.tasks, id, {
              status: "error",
              detail: message,
              progress: undefined,
            }),
          }));
        }
      })();

      return id;
    },

    showToast: ({
      label,
      detail,
      key,
      status = "success",
      actions: explicitActions,
      actionsPlacement,
      logLink,
      dismissMs,
    }) => {
      const id = crypto.randomUUID();
      const actions = withLogLinkAction(explicitActions, logLink);
      const resolvedDismissMs = defaultToastDismissMs(
        status,
        Boolean(actions?.length),
        dismissMs,
      );
      const task: BackgroundTask = {
        id,
        key,
        label,
        detail,
        status,
        actions,
        actionsPlacement,
        createdAt: Date.now(),
      };

      set((state) => ({
        tasks: [
          ...(key ? state.tasks.filter((t) => t.key !== key) : state.tasks),
          task,
        ],
      }));

      if (resolvedDismissMs != null) {
        scheduleAutoDismiss(get, id, resolvedDismissMs, status);
      }
      return id;
    },

    showErrorToast: (options) =>
      get().showToast({ ...options, status: "error" }),

    requestCancel: (id) =>
      set((state) => ({
        tasks: patchTask(state.tasks, id, { cancelRequested: true }),
      })),

    dismissTask: (id) =>
      set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
  }),
);
