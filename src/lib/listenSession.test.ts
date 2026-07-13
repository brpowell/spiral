import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeListen,
  closeListenForHandoff,
  getActiveListenTrackId,
  inferHandoffCompletion,
  openListen,
  pauseListenAccumulation,
  resetListenSessionForTests,
  resumeListenAccumulation,
  setSkinModeSessionActive,
} from "./listenSession";

vi.mock("../store/useThemeStore", () => ({
  useThemeStore: {
    getState: () => ({
      activeThemeId: "obsidian",
      themes: [{ id: "obsidian", name: "Obsidian" }],
    }),
  },
}));

vi.mock("../store/useSkinStore", () => ({
  useSkinStore: {
    getState: () => ({
      activeSkinId: "spiral-default",
      activeViewId: "standard",
      activePack: { summary: { name: "Spiral Default" } },
      skins: [],
    }),
  },
}));

vi.mock("../store/useVisualizerStore", () => ({
  useVisualizerStore: {
    getState: () => ({
      activePackId: "bars",
      packs: [{ id: "bars", name: "Bars" }],
      packCache: {},
    }),
  },
}));

afterEach(() => {
  resetListenSessionForTests();
  vi.useRealTimers();
});

describe("listenSession", () => {
  it("opens and closes a listen with appearance snapshot", () => {
    expect(openListen(7, 180, true)).toBeNull();
    expect(getActiveListenTrackId()).toBe(7);

    const closed = closeListen("natural_end");
    expect(closed).not.toBeNull();
    expect(closed?.trackId).toBe(7);
    expect(closed?.completion).toBe("natural_end");
    expect(closed?.uiMode).toBe("library");
    expect(closed?.libraryListenedSeconds).toBeGreaterThanOrEqual(0);
    expect(closed?.skinListenedSeconds).toBe(0);
    expect(closed?.themeId).toBe("obsidian");
    expect(closed?.themeName).toBe("Obsidian");
    expect(closed?.skinId).toBe("spiral-default");
    expect(closed?.skinName).toBe("Spiral Default");
    expect(closed?.visualizerId).toBe("bars");
    expect(closed?.visualizerName).toBe("Bars");
    expect(getActiveListenTrackId()).toBeNull();
  });

  it("records skin seconds when skin mode session is active", () => {
    setSkinModeSessionActive(true);
    vi.useFakeTimers();
    openListen(1, 100, true);
    vi.advanceTimersByTime(10_000);
    const closed = closeListen("natural_end");
    expect(closed?.uiMode).toBe("skin");
    expect(closed?.skinListenedSeconds).toBeCloseTo(10, 1);
    expect(closed?.libraryListenedSeconds).toBe(0);
  });

  it("splits seconds across library and skin when mode changes mid-listen", () => {
    vi.useFakeTimers();
    openListen(1, 200, true);
    vi.advanceTimersByTime(50_000);

    setSkinModeSessionActive(true);
    vi.advanceTimersByTime(50_000);

    const closed = closeListen("natural_end");
    expect(closed?.libraryListenedSeconds).toBeCloseTo(50, 1);
    expect(closed?.skinListenedSeconds).toBeCloseTo(50, 1);
    expect(closed?.listenedSeconds).toBeCloseTo(100, 1);
    // Tie → library majority
    expect(closed?.uiMode).toBe("library");
  });

  it("uses skin majority when more time spent in skin mode", () => {
    vi.useFakeTimers();
    openListen(1, 200, true);
    vi.advanceTimersByTime(20_000);

    setSkinModeSessionActive(true);
    vi.advanceTimersByTime(80_000);

    const closed = closeListen("natural_end");
    expect(closed?.libraryListenedSeconds).toBeCloseTo(20, 1);
    expect(closed?.skinListenedSeconds).toBeCloseTo(80, 1);
    expect(closed?.uiMode).toBe("skin");
  });

  it("is idempotent on double close", () => {
    openListen(1, 100, true);
    expect(closeListen("skipped")).not.toBeNull();
    expect(closeListen("skipped")).toBeNull();
  });

  it("returns previous listen when opening a new one", () => {
    openListen(1, 100, true);
    const previous = openListen(2, 200, true);
    expect(previous?.trackId).toBe(1);
    expect(previous?.completion).toBe("skipped");
    expect(getActiveListenTrackId()).toBe(2);
  });

  it("excludes paused time from listened_seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));

    openListen(1, 180, true);
    vi.advanceTimersByTime(5_000);
    pauseListenAccumulation();
    vi.advanceTimersByTime(20_000);
    resumeListenAccumulation();
    vi.advanceTimersByTime(3_000);

    const closed = closeListen("interrupted");
    expect(closed?.listenedSeconds).toBeCloseTo(8, 1);
    expect(closed?.libraryListenedSeconds).toBeCloseTo(8, 1);
  });

  it("treats near-complete crossfade handoff as natural_end", () => {
    vi.useFakeTimers();
    openListen(1, 207.9, true);
    vi.advanceTimersByTime(202_265);

    const closed = closeListenForHandoff(202.3, 207.9);
    expect(closed?.completion).toBe("natural_end");
  });

  it("treats early handoff as skipped", () => {
    vi.useFakeTimers();
    openListen(1, 200, true);
    vi.advanceTimersByTime(20_000);

    const closed = closeListenForHandoff(20, 200);
    expect(closed?.completion).toBe("skipped");
  });
});

describe("inferHandoffCompletion", () => {
  it("uses remaining position near end", () => {
    expect(inferHandoffCompletion(100, 200, 190, 200)).toBe("natural_end");
  });

  it("keeps mid-track skips as skipped", () => {
    expect(inferHandoffCompletion(30, 200, 30, 200)).toBe("skipped");
  });
});
