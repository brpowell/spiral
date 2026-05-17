import { create } from "zustand";
import { waitForPaint, yieldToMain } from "../lib/scheduling";

export type BackgroundTaskStatus = "running" | "success" | "error";

export interface BackgroundTask {
  id: string;
  key?: string;
  label: string;
  status: BackgroundTaskStatus;
  detail?: string;
  progress?: { current: number; total: number };
  createdAt: number;
}

export interface BackgroundTaskRunContext {
  setLabel: (label: string) => void;
  setDetail: (detail: string) => void;
  setProgress: (current: number, total: number) => void;
  clearProgress: () => void;
}

interface RunInBackgroundOptions {
  label: string;
  key?: string;
  run: (ctx: BackgroundTaskRunContext) => Promise<void>;
}

interface BackgroundTasksState {
  tasks: BackgroundTask[];
  runInBackground: (options: RunInBackgroundOptions) => string;
  dismissTask: (id: string) => void;
}

const SUCCESS_DISMISS_MS = 5000;

function patchTask(
  tasks: BackgroundTask[],
  id: string,
  patch: Partial<BackgroundTask>,
): BackgroundTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
}

function createRunContext(
  id: string,
  set: (
    partial:
      | Partial<BackgroundTasksState>
      | ((state: BackgroundTasksState) => Partial<BackgroundTasksState>),
  ) => void,
): BackgroundTaskRunContext {
  return {
    setLabel: (label) =>
      set((state) => ({ tasks: patchTask(state.tasks, id, { label }) })),
    setDetail: (detail) =>
      set((state) => ({ tasks: patchTask(state.tasks, id, { detail }) })),
    setProgress: (current, total) =>
      set((state) => ({
        tasks: patchTask(state.tasks, id, {
          progress: { current, total },
        }),
      })),
    clearProgress: () =>
      set((state) => ({
        tasks: patchTask(state.tasks, id, { progress: undefined }),
      })),
  };
}

export const useBackgroundTasksStore = create<BackgroundTasksState>((set, get) => ({
  tasks: [],

  runInBackground: ({ label, key, run }) => {
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
        window.setTimeout(() => {
          if (get().tasks.some((t) => t.id === id && t.status === "success")) {
            get().dismissTask(id);
          }
        }, SUCCESS_DISMISS_MS);
      } catch (err) {
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

  dismissTask: (id) =>
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
}));
