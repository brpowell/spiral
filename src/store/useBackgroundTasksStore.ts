import { create } from "zustand";
import { isCdImportCancelledError } from "../lib/cdImport";
import { waitForPaint, yieldToMain } from "../lib/scheduling";

export type BackgroundTaskStatus = "running" | "success" | "error" | "cancelled";

export interface BackgroundTask {
  id: string;
  key?: string;
  label: string;
  status: BackgroundTaskStatus;
  detail?: string;
  progress?: { current: number; total: number };
  cancellable?: boolean;
  createdAt: number;
}

export interface BackgroundTaskRunContext {
  setLabel: (label: string) => void;
  setDetail: (detail: string) => void;
  clearDetail: () => void;
  setProgress: (current: number, total: number) => void;
  clearProgress: () => void;
}

interface RunInBackgroundOptions {
  label: string;
  key?: string;
  cancellable?: boolean;
  run: (ctx: BackgroundTaskRunContext) => Promise<void>;
}

interface ShowToastOptions {
  label: string;
  detail?: string;
  /** Replaces any existing toast with the same key. */
  key?: string;
  dismissMs?: number;
  status?: Extract<BackgroundTaskStatus, "success" | "error">;
}

interface BackgroundTasksState {
  tasks: BackgroundTask[];
  runInBackground: (options: RunInBackgroundOptions) => string;
  showToast: (options: ShowToastOptions) => string;
  showErrorToast: (options: ShowToastOptions) => string;
  dismissTask: (id: string) => void;
}

const SUCCESS_DISMISS_MS = 5000;
const ERROR_DISMISS_MS = 10000;
const BRIEF_TOAST_DISMISS_MS = 2000;

function scheduleAutoDismiss(
  get: () => BackgroundTasksState,
  id: string,
  ms: number,
  status: "success" | "cancelled" | "error",
): void {
  window.setTimeout(() => {
    if (get().tasks.some((t) => t.id === id && t.status === status)) {
      get().dismissTask(id);
    }
  }, ms);
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
): BackgroundTaskRunContext {
  let lastProgressAt = 0;
  let lastProgressPercent = -1;

  return {
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
  };
}

export const useBackgroundTasksStore = create<BackgroundTasksState>((set, get) => ({
  tasks: [],

  runInBackground: ({ label, key, cancellable, run }) => {
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
      createdAt: Date.now(),
    };

    set((state) => ({ tasks: [...state.tasks, task] }));

    const ctx = createRunContext(id, set);

    void (async () => {
      await waitForPaint();
      await yieldToMain();
      try {
        await run(ctx);
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
              label: "Import cancelled",
              detail: undefined,
              progress: undefined,
            }),
          }));
          scheduleAutoDismiss(get, id, SUCCESS_DISMISS_MS, "cancelled");
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
    dismissMs = status === "error" ? ERROR_DISMISS_MS : BRIEF_TOAST_DISMISS_MS,
  }) => {
    const id = crypto.randomUUID();
    const task: BackgroundTask = {
      id,
      key,
      label,
      detail,
      status,
      createdAt: Date.now(),
    };

    set((state) => ({
      tasks: [
        ...(key ? state.tasks.filter((t) => t.key !== key) : state.tasks),
        task,
      ],
    }));

    scheduleAutoDismiss(get, id, dismissMs, status);
    return id;
  },

  showErrorToast: (options) =>
    get().showToast({ ...options, status: "error" }),

  dismissTask: (id) =>
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
}));
