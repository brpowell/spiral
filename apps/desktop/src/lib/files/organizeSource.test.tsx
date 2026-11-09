import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import type { FilePlanApplySummary, Source } from "@/types/source";
import { organizeInBackground, organizeSettleOptions } from "./organizeSource";

const tauri = vi.hoisted(() => ({
  applyOrganizeSource: vi.fn(),
  previewOrganizeSource: vi.fn(),
  rescanSource: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  FILE_PLAN_PROGRESS_EVENT: "library://file-plan-progress",
}));
const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
const player = vi.hoisted(() => ({
  library: [] as { sourceId: number }[],
  loadLibrary: vi.fn(),
}));

vi.mock("@/lib/tauri", () => tauri);
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (name: string, handler: (event: { payload: unknown }) => void) => {
      events.handlers.set(name, handler);
      return Promise.resolve(() => events.handlers.delete(name));
    },
  ),
}));
vi.mock("@/store/usePlayerStore", () => ({
  usePlayerStore: { getState: () => player },
}));

const music: Source = {
  id: 3,
  rootPath: "/Users/me/hello",
  name: "hello",
  autoOrganize: true,
  pathFormat: null,
  importTarget: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const labels = () =>
  useBackgroundTasksStore.getState().tasks.map((task) => task.label);

describe("organizeSettleOptions", () => {
  const settle = (summary: FilePlanApplySummary) =>
    organizeSettleOptions(summary, ["hello"]);

  it("counts what moved", () => {
    expect(settle({ moved: 14, failed: 0, errors: [] })).toEqual({
      status: "success",
      label: "14 files organized",
      detail: "hello",
    });
  });

  it("shows a single failure inline", () => {
    expect(settle({ moved: 2, failed: 1, errors: ["a.mp3: denied"] })).toEqual({
      status: "warning",
      label: "2 files organized · 1 failed",
      detail: "a.mp3: denied",
    });
  });

  it("links to the logs for several failures, error when none moved", () => {
    expect(settle({ moved: 0, failed: 3, errors: ["a", "b", "c"] })).toEqual(
      expect.objectContaining({ status: "error", logLink: true }),
    );
  });
});

describe("organizeInBackground", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.handlers.clear();
    useBackgroundTasksStore.setState({ tasks: [] });
    tauri.listSources.mockResolvedValue([music]);
    tauri.getSourceStatuses.mockResolvedValue([]);
    tauri.rescanSource.mockResolvedValue({});
    tauri.previewOrganizeSource.mockResolvedValue({ moves: 14 });
    tauri.applyOrganizeSource.mockResolvedValue({
      moved: 14,
      failed: 0,
      errors: [],
    });
    player.library = [{ sourceId: 3 }];
  });

  it("moves the files in a toast and reports the outcome", async () => {
    const onApplied = vi.fn();
    await organizeInBackground([
      { source: music, pathFormat: "{title}.{ext}", onApplied },
    ]);
    expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, "{title}.{ext}");
    expect(tauri.rescanSource).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledWith({
      moved: 14,
      failed: 0,
      errors: [],
    });
    await vi.waitFor(() => expect(labels()).toEqual(["14 files organized"]));
  });

  it("says a folder is offline in words, not its error code", async () => {
    tauri.previewOrganizeSource.mockRejectedValue(
      "source_unavailable: the folder /Volumes/Music is not available",
    );
    await organizeInBackground([{ source: music }]);
    expect(useBackgroundTasksStore.getState().tasks).toEqual([
      expect.objectContaining({
        status: "error",
        label: "Couldn't organize “hello”",
        detail:
          "That music folder isn't available. Connect its drive and try again.",
      }),
    ]);
  });

  it("never shows a toast when nothing needs to move", async () => {
    tauri.previewOrganizeSource.mockResolvedValue({ moves: 0 });
    tauri.applyOrganizeSource.mockResolvedValue({
      moved: 0,
      failed: 0,
      errors: [],
    });
    const seen: string[] = [];
    const stop = useBackgroundTasksStore.subscribe((state) =>
      seen.push(...state.tasks.map((task) => task.label)),
    );
    const onApplied = vi.fn();
    await organizeInBackground([{ source: music, onApplied }]);
    stop();
    expect(seen).toEqual([]);
    // Organizing still turns on.
    expect(tauri.applyOrganizeSource).toHaveBeenCalledWith(3, undefined);
    expect(onApplied).toHaveBeenCalled();
  });

  it("reports a check that fails", async () => {
    tauri.previewOrganizeSource.mockRejectedValue(new Error("offline"));
    await organizeInBackground([{ source: music }]);
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
    expect(useBackgroundTasksStore.getState().tasks).toEqual([
      expect.objectContaining({
        status: "error",
        label: "Couldn't organize “hello”",
        detail: "offline",
      }),
    ]);
  });

  it("finishes the scan first when asked", async () => {
    await organizeInBackground([{ source: music }], { scanFirst: true });
    expect(tauri.rescanSource).toHaveBeenCalledWith(3);
    expect(player.loadLibrary).toHaveBeenCalledWith({ preservePlayback: true });
    expect(tauri.applyOrganizeSource).toHaveBeenCalled();
  });

  it("goes quietly when a scanned folder has no tracks", async () => {
    player.library = [];
    await organizeInBackground([{ source: music }], { scanFirst: true });
    expect(tauri.previewOrganizeSource).not.toHaveBeenCalled();
    expect(tauri.applyOrganizeSource).not.toHaveBeenCalled();
    expect(labels()).toEqual([]);
  });

  it("runs one folder at a time", async () => {
    let finishFirst!: (summary: FilePlanApplySummary) => void;
    tauri.applyOrganizeSource.mockReturnValueOnce(
      new Promise<FilePlanApplySummary>((resolve) => {
        finishFirst = resolve;
      }),
    );
    const first = organizeInBackground([{ source: music }]);
    const second = organizeInBackground([
      { source: { ...music, id: 4, name: "other" } },
    ]);
    await vi.waitFor(() =>
      expect(tauri.applyOrganizeSource).toHaveBeenCalledTimes(1),
    );
    finishFirst({ moved: 1, failed: 0, errors: [] });
    await Promise.all([first, second]);
    expect(tauri.applyOrganizeSource).toHaveBeenCalledTimes(2);
    expect(tauri.applyOrganizeSource.mock.calls[1][0]).toBe(4);
  });

  it("organizes several sources in one toast, progress across all", async () => {
    const other = { ...music, id: 4, name: "other" };
    tauri.previewOrganizeSource.mockImplementation((id: number) =>
      Promise.resolve({ moves: id === 3 ? 2 : 3 }),
    );
    const progress: [string, number, number][] = [];
    tauri.applyOrganizeSource.mockImplementation((id: number) => {
      const [task] = useBackgroundTasksStore.getState().tasks;
      events.handlers.get("library://file-plan-progress")?.({
        payload: { sourceId: id, done: 1, total: 9 },
      });
      const after = useBackgroundTasksStore.getState().tasks[0];
      progress.push([
        task.label,
        after.progress?.current ?? -1,
        after.progress?.total ?? -1,
      ]);
      return Promise.resolve({
        moved: id === 3 ? 2 : 3,
        failed: 0,
        errors: [],
      });
    });

    await organizeInBackground([{ source: music }, { source: other }]);
    // Each source's progress picks up where the last left off, out of 5.
    expect(progress).toEqual([
      ["Organizing “hello”…", 1, 5],
      ["Organizing “other”…", 3, 5],
    ]);
    await vi.waitFor(() =>
      expect(useBackgroundTasksStore.getState().tasks).toEqual([
        expect.objectContaining({
          status: "success",
          label: "5 files organized",
          detail: "hello, other",
        }),
      ]),
    );
  });

  it("keeps going when one source fails, and counts its files", async () => {
    const other = { ...music, id: 4, name: "other" };
    tauri.applyOrganizeSource
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ moved: 14, failed: 0, errors: [] });
    await organizeInBackground([{ source: music }, { source: other }]);
    expect(tauri.applyOrganizeSource).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(useBackgroundTasksStore.getState().tasks).toEqual([
        expect.objectContaining({
          status: "warning",
          label: "14 files organized · 14 failed",
          // Its error was logged, so the toast links there.
          actions: [expect.objectContaining({ id: "view-logs" })],
        }),
      ]),
    );
  });
});
