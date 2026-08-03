import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTaskRunContext } from "../store/useBackgroundTasksStore";

const {
  runInBackgroundMock,
  runSingleLyricsFetchMock,
  clearPendingMock,
  setFetchingMock,
  setQueuedMock,
  fetchingTrackIds,
  queuedTrackIds,
} = vi.hoisted(() => {
  const fetchingTrackIds = new Set<number>();
  const queuedTrackIds = new Set<number>();
  return {
    runInBackgroundMock: vi.fn(),
    runSingleLyricsFetchMock: vi.fn(),
    clearPendingMock: vi.fn(),
    setFetchingMock: vi.fn((trackId: number, isFetching: boolean) => {
      if (isFetching) {
        fetchingTrackIds.add(trackId);
      } else {
        fetchingTrackIds.delete(trackId);
      }
    }),
    setQueuedMock: vi.fn((trackId: number, isQueued: boolean) => {
      if (isQueued) {
        queuedTrackIds.add(trackId);
      } else {
        queuedTrackIds.delete(trackId);
      }
    }),
    fetchingTrackIds,
    queuedTrackIds,
  };
});

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      runInBackground: runInBackgroundMock,
    }),
  },
}));

vi.mock("../store/useLyricsFetchStore", () => ({
  useLyricsFetchStore: {
    getState: () => ({
      clearPending: clearPendingMock,
      setFetching: setFetchingMock,
      setQueued: setQueuedMock,
      fetchingTrackIds,
      queuedTrackIds,
    }),
    setState: vi.fn(),
  },
}));

vi.mock("./lyricsFetchRunner", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lyricsFetchRunner")>();
  return {
    ...original,
    runSingleLyricsFetch: runSingleLyricsFetchMock,
  };
});

import {
  enqueueLyricsFetch,
  LYRICS_FETCH_BULK_KEY,
  resetLyricsFetchQueueForTests,
} from "./lyricsFetchQueue";

const params = {
  artist: "Artist",
  albumArtist: "Artist",
  title: "Song",
  album: "Album",
  durationSeconds: 200,
};

function createCtx(): BackgroundTaskRunContext & {
  labels: string[];
  details: string[];
  progress: Array<{ current: number; total: number }>;
  dismissedSilently: boolean;
} {
  const labels: string[] = [];
  const details: string[] = [];
  const progress: Array<{ current: number; total: number }> = [];
  let dismissedSilently = false;

  return {
    labels,
    details,
    progress,
    get dismissedSilently() {
      return dismissedSilently;
    },
    setLabel: (label: string) => {
      labels.push(label);
    },
    setDetail: (detail: string) => {
      details.push(detail);
    },
    clearDetail: () => {
      details.push("");
    },
    setProgress: (current: number, total: number) => {
      progress.push({ current, total });
    },
    clearProgress: () => {
      progress.push({ current: -1, total: -1 });
    },
    dismissSilently: () => {
      dismissedSilently = true;
    },
    settleAs: () => {
      /* unused in lyrics fetch queue tests */
    },
  };
}

describe("enqueueLyricsFetch", () => {
  let capturedRun: ((ctx: BackgroundTaskRunContext) => Promise<void>) | null =
    null;

  beforeEach(() => {
    resetLyricsFetchQueueForTests();
    runInBackgroundMock.mockReset();
    runSingleLyricsFetchMock.mockReset();
    clearPendingMock.mockReset();
    setFetchingMock.mockClear();
    setQueuedMock.mockClear();
    fetchingTrackIds.clear();
    queuedTrackIds.clear();
    capturedRun = null;

    runInBackgroundMock.mockImplementation(({ run }) => {
      capturedRun = run;
      return "task-id";
    });

    runSingleLyricsFetchMock.mockResolvedValue({ status: "found" });
  });

  async function runCapturedProcessor() {
    expect(capturedRun).not.toBeNull();
    const ctx = createCtx();
    await capturedRun!(ctx);
    return ctx;
  }

  it("processes manual items before auto items", async () => {
    const order: number[] = [];
    runSingleLyricsFetchMock.mockImplementation(async (trackId: number) => {
      order.push(trackId);
      return { status: "found" };
    });

    enqueueLyricsFetch(1, "Auto One", params, { priority: "auto" });
    enqueueLyricsFetch(2, "Manual Two", params, { priority: "manual" });
    await runCapturedProcessor();

    expect(order).toEqual([2, 1]);
  });

  it("promotes an auto-queued track to the manual queue front", async () => {
    const order: number[] = [];
    runSingleLyricsFetchMock.mockImplementation(async (trackId: number) => {
      order.push(trackId);
      return { status: "found" };
    });

    enqueueLyricsFetch(1, "Auto One", params, { priority: "auto" });
    enqueueLyricsFetch(2, "Manual Two", params, { priority: "manual" });
    enqueueLyricsFetch(1, "Auto One", params, { priority: "manual" });
    await runCapturedProcessor();

    expect(order).toEqual([1, 2]);
  });

  it("uses solo labels for a single successful fetch", async () => {
    runSingleLyricsFetchMock.mockResolvedValue({ status: "found" });

    enqueueLyricsFetch(1, "Song", params, { priority: "manual" });
    const ctx = await runCapturedProcessor();

    expect(runSingleLyricsFetchMock).toHaveBeenCalledWith(
      1,
      params,
      expect.objectContaining({ skipIfHasLyrics: false }),
    );
    expect(ctx.labels).toContain("Fetching lyrics for Song");
    expect(ctx.labels.at(-1)).toBe("Lyrics fetched for Song");
    expect(ctx.dismissedSilently).toBe(false);
  });

  it("passes skipIfHasLyrics for auto-priority fetches", async () => {
    runSingleLyricsFetchMock.mockResolvedValue({ status: "found" });

    enqueueLyricsFetch(1, "Song", params, {
      priority: "auto",
      respectMissCache: true,
    });
    await runCapturedProcessor();

    expect(runSingleLyricsFetchMock).toHaveBeenCalledWith(
      1,
      params,
      expect.objectContaining({
        skipIfHasLyrics: true,
        respectMissCache: true,
      }),
    );
  });

  it("dismisses silently for a solo not-found fetch", async () => {
    runSingleLyricsFetchMock.mockResolvedValue({ status: "not_found" });

    enqueueLyricsFetch(1, "Song", params, { priority: "manual" });
    const ctx = await runCapturedProcessor();

    expect(ctx.dismissedSilently).toBe(true);
  });

  it("uses bulk labels and summary when multiple tracks are queued", async () => {
    runSingleLyricsFetchMock
      .mockResolvedValueOnce({ status: "found" })
      .mockResolvedValueOnce({ status: "not_found" });

    enqueueLyricsFetch(1, "Song One", params, { priority: "manual" });
    enqueueLyricsFetch(2, "Song Two", params, { priority: "auto" });
    const ctx = await runCapturedProcessor();

    expect(
      ctx.labels.some((label) => label.startsWith("Fetching lyrics…")),
    ).toBe(true);
    expect(ctx.labels.at(-1)).toBe("Lyrics: fetched 1, 1 not found");
    expect(ctx.progress.some((entry) => entry.total === 2)).toBe(true);
  });

  it("starts the shared bulk background task with a stable key", () => {
    enqueueLyricsFetch(1, "Song", params, { priority: "manual" });

    expect(runInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: LYRICS_FETCH_BULK_KEY }),
    );
  });

  it("switches to bulk toast immediately when another track is enqueued mid-fetch", async () => {
    let unblockFirst: (() => void) | undefined;
    runSingleLyricsFetchMock.mockImplementation((trackId: number) => {
      if (trackId === 1) {
        return new Promise((resolve) => {
          unblockFirst = () => resolve({ status: "found" });
        });
      }
      return Promise.resolve({ status: "found" });
    });

    const ctx = createCtx();
    runInBackgroundMock.mockImplementation(({ run }) => {
      capturedRun = run;
      void run(ctx);
      return "task-id";
    });

    enqueueLyricsFetch(1, "Song One", params, { priority: "manual" });
    await Promise.resolve();

    enqueueLyricsFetch(2, "Song Two", params, { priority: "auto" });

    expect(ctx.labels.at(-1)).toBe("Fetching lyrics…");
    expect(ctx.progress.at(-1)).toEqual({ current: 0, total: 2 });

    unblockFirst?.();
    await vi.waitFor(() => {
      expect(runSingleLyricsFetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
