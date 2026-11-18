import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/types/source";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@/lib/scheduling", () => ({
  waitForPaint: () => Promise.resolve(),
  yieldToMain: () => Promise.resolve(),
}));
const tauri = vi.hoisted(() => ({
  SOURCE_SCAN_EVENT: "library://source-scan",
  getActiveScans: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

const source = {
  id: 7,
  name: "Music",
  rootPath: "/Music",
} as Source;
const summary = {
  sourceId: 7,
  added: 3,
  updated: 0,
  missing: 0,
  restored: 0,
  moved: 0,
  failed: 0,
  errors: [],
};

async function setup(onboardingOpen: boolean) {
  vi.resetModules();
  const tracker = await import("./sourceScanTracker");
  const { useOnboardingStore } = await import("@/store/useOnboardingStore");
  const { useSourcesStore } = await import("@/store/useSourcesStore");
  const { useSourceScansStore } = await import("@/store/useSourceScansStore");
  const { useBackgroundTasksStore } =
    await import("@/store/useBackgroundTasksStore");
  useOnboardingStore.setState({ open: onboardingOpen });
  useSourcesStore.setState({ sourcesById: new Map([[7, source]]) });
  return {
    tracker,
    onboarding: useOnboardingStore,
    scans: useSourceScansStore,
    tasks: useBackgroundTasksStore,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("source scan tracking", () => {
  beforeEach(() => {
    tauri.getActiveScans.mockResolvedValue([]);
    vi.useRealTimers();
    vi.stubGlobal("window", globalThis);
  });

  it("shows a running toast, then the result, outside onboarding", async () => {
    const { tracker, scans, tasks } = await setup(false);
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "started",
      summary: null,
      progress: null,
      background: false,
    });
    await flush();
    expect(scans.getState().scanning.has(7)).toBe(true);
    expect(tasks.getState().tasks[0]?.status).toBe("running");

    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "finished",
      summary,
      progress: null,
      background: false,
    });
    await flush();
    expect(scans.getState().scanning.has(7)).toBe(false);
    expect(tasks.getState().tasks[0]?.status).toBe("success");
  });

  it("holds the toast back during onboarding, then shows it on finish", async () => {
    const { tracker, scans, tasks, onboarding } = await setup(true);
    const stop = tracker.startSourceScanTracking();
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "started",
      summary: null,
      progress: null,
      background: false,
    });
    await flush();
    expect(scans.getState().scanning.has(7)).toBe(true);
    expect(tasks.getState().tasks).toHaveLength(0);

    onboarding.setState({ open: false });
    await flush();
    expect(tasks.getState().tasks[0]?.status).toBe("running");
    stop();
  });

  it("shows no toast for a scan that ended during onboarding", async () => {
    const { tracker, scans, tasks, onboarding } = await setup(true);
    const stop = tracker.startSourceScanTracking();
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "started",
      summary: null,
      progress: null,
      background: false,
    });
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "finished",
      summary,
      progress: null,
      background: false,
    });
    onboarding.setState({ open: false });
    await flush();
    expect(scans.getState().scanning.size).toBe(0);
    expect(tasks.getState().tasks).toHaveLength(0);
    stop();
  });

  it("feeds progress to the card and the toast, and clears it when done", async () => {
    const { tracker, scans, tasks } = await setup(false);
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "started",
      summary: null,
      progress: null,
      background: false,
    });
    await flush();
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "progress",
      summary: null,
      progress: {
        phase: "reading",
        current: 3,
        total: 10,
        path: "/Music/A/x.mp3",
      },
      background: false,
    });
    expect(scans.getState().progress[7]).toMatchObject({ current: 3 });
    expect(tasks.getState().tasks[0]).toMatchObject({
      progress: { current: 3, total: 10 },
      detail: "3 of 10 tracks",
    });

    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "finished",
      summary,
      progress: null,
      background: false,
    });
    expect(scans.getState().progress[7]).toBeUndefined();
  });

  it("shows progress for a rescan on the card without a toast", async () => {
    const { tracker, scans, tasks } = await setup(false);
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "progress",
      summary: null,
      progress: { phase: "walking", found: 250 },
      background: false,
    });
    expect(scans.getState().progress[7]).toEqual({
      phase: "walking",
      found: 250,
    });
    expect(tasks.getState().tasks).toHaveLength(0);
    tracker.handleSourceScanEvent({
      sourceId: 7,
      phase: "progress",
      summary: null,
      progress: null,
      background: false,
    });
    expect(scans.getState().progress[7]).toBeUndefined();
  });

  it("toasts a startup scan only if it runs long", async () => {
    vi.useFakeTimers();
    const { tracker, scans, tasks } = await setup(false);
    const event = (phase: "started" | "finished") => ({
      sourceId: 7,
      phase,
      summary: phase === "finished" ? summary : null,
      progress: null,
      background: true,
    });

    // Quick: the card shows it, but no toast.
    tracker.handleSourceScanEvent(event("started"));
    expect(scans.getState().scanning.has(7)).toBe(true);
    vi.advanceTimersByTime(500);
    tracker.handleSourceScanEvent(event("finished"));
    vi.advanceTimersByTime(5000);
    expect(tasks.getState().tasks).toHaveLength(0);

    // Slow: a toast appears once it has run a while.
    tracker.handleSourceScanEvent(event("started"));
    vi.advanceTimersByTime(tracker.BACKGROUND_SCAN_TOAST_DELAY_MS + 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(tasks.getState().tasks[0]?.status).toBe("running");
  });

  it("picks up a scan that began before the window was listening", async () => {
    const { tracker, scans } = await setup(false);
    tauri.getActiveScans.mockResolvedValue([
      {
        sourceId: 7,
        background: true,
        progress: { phase: "reading", current: 5, total: 20, path: "/a/b.mp3" },
      },
    ]);
    const stop = tracker.startSourceScanTracking();
    await flush();
    expect(scans.getState().scanning.has(7)).toBe(true);
    expect(scans.getState().progress[7]).toMatchObject({ current: 5 });
    stop();
  });
});
