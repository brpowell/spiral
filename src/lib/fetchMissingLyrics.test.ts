import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyFetchMissingLyricsSummary,
  fetchMissingLyrics,
  filterEligibleByFetchCache,
  formatFetchMissingLyricsToastLabel,
  partitionMissingLyricsTracks,
  recordTrackResult,
  type FetchMissingLyricsSummary,
} from "./fetchMissingLyrics";
import type { Track } from "../types/track";

const {
  runSingleLyricsFetchMock,
  logActivityMock,
  showToastMock,
  runInBackgroundMock,
  peekLyricsFetchCacheMock,
  commitInstrumentalMarkForTrackMock,
} = vi.hoisted(() => ({
  runSingleLyricsFetchMock: vi.fn(),
  logActivityMock: vi.fn(),
  showToastMock: vi.fn(),
  runInBackgroundMock: vi.fn(),
  peekLyricsFetchCacheMock: vi.fn(),
  commitInstrumentalMarkForTrackMock: vi.fn(),
}));

vi.mock("./lyricsFetchRunner", async () => {
  const actual = await vi.importActual<typeof import("./lyricsFetchRunner")>(
    "./lyricsFetchRunner",
  );
  return {
    ...actual,
    runSingleLyricsFetch: runSingleLyricsFetchMock,
  };
});

vi.mock("./lyricsFetchCommit", () => ({
  commitInstrumentalMarkForTrack: commitInstrumentalMarkForTrackMock,
}));

vi.mock("./activityLog", () => ({
  createOperationId: () => "op-1",
  logActivity: logActivityMock,
}));

vi.mock("./scheduling", () => ({
  yieldForInteraction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./tauri", () => ({
  clearLyricsFetchCancel: vi.fn().mockResolvedValue(undefined),
  peekLyricsFetchCache: peekLyricsFetchCacheMock,
}));

const fetchingTrackIds = new Set<number>();
const queuedTrackIds = new Set<number>();
const setFetchingMock = vi.fn((trackId: number, isFetching: boolean) => {
  if (isFetching) fetchingTrackIds.add(trackId);
  else fetchingTrackIds.delete(trackId);
});

vi.mock("../store/useLyricsFetchStore", () => ({
  useLyricsFetchStore: {
    getState: () => ({
      fetchingTrackIds,
      queuedTrackIds,
      setFetching: setFetchingMock,
    }),
  },
}));

let library: Track[] = [];

vi.mock("../store/usePlayerStore", () => ({
  usePlayerStore: {
    getState: () => ({
      library,
    }),
  },
}));

vi.mock("../store/useBackgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      showToast: showToastMock,
      runInBackground: runInBackgroundMock,
    }),
  },
}));

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 2000,
    genre: "Rock",
    durationSeconds: 200,
    sampleRate: 44_100,
    bitrate: 320,
    codec: "mp3",
    filePath: "/music/song.mp3",
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    lyricsFormat: null,
    ...overrides,
  };
}

function mockRunContext(isCancelRequested: () => boolean = () => false) {
  return {
    setLabel: vi.fn(),
    setDetail: vi.fn(),
    clearDetail: vi.fn(),
    setProgress: vi.fn(),
    clearProgress: vi.fn(),
    settleAs: vi.fn(),
    dismissSilently: vi.fn(),
    isCancelRequested,
  };
}

async function runBackgroundJob(
  isCancelRequested: () => boolean = () => false,
): Promise<ReturnType<typeof mockRunContext>> {
  const ctx = mockRunContext(isCancelRequested);
  runInBackgroundMock.mockImplementation(
    async ({
      run,
    }: {
      run: (ctx: ReturnType<typeof mockRunContext>) => Promise<void>;
    }) => {
      try {
        await run(ctx);
      } catch {
        // BackgroundTaskCancelledError expected for cancel paths
      }
    },
  );
  fetchMissingLyrics();
  await runInBackgroundMock.mock.results[0]?.value;
  return ctx;
}

describe("partitionMissingLyricsTracks", () => {
  it("splits missing tracks into eligible and ineligible", () => {
    const result = partitionMissingLyricsTracks([
      track({ id: 1, title: "Has lyrics", lyricsFormat: "plain" }),
      track({ id: 2, title: "Instrumental", lyricsFormat: "instrumental" }),
      track({ id: 3, title: "Missing eligible" }),
      track({ id: 4, title: "Missing no artist", artist: null }),
      track({ id: 5, title: "Missing no duration", durationSeconds: null }),
    ]);

    expect(result.eligible.map((t) => t.id)).toEqual([3]);
    expect(result.ineligible.map((t) => t.id)).toEqual([4, 5]);
  });
});

describe("filterEligibleByFetchCache", () => {
  beforeEach(() => {
    peekLyricsFetchCacheMock.mockReset();
  });

  it("excludes miss and instrumental cache entries from the fetch set", async () => {
    peekLyricsFetchCacheMock
      .mockResolvedValueOnce("miss")
      .mockResolvedValueOnce("instrumental")
      .mockResolvedValueOnce("notCached")
      .mockResolvedValueOnce("hit");

    const result = await filterEligibleByFetchCache([
      track({ id: 1, title: "Miss" }),
      track({ id: 2, title: "Instrumental" }),
      track({ id: 3, title: "Fresh" }),
      track({ id: 4, title: "Cached hit" }),
    ]);

    expect(result.cachedMiss.map((t) => t.id)).toEqual([1]);
    expect(result.cachedInstrumental.map((t) => t.id)).toEqual([2]);
    expect(result.toFetch.map((t) => t.id)).toEqual([3, 4]);
  });
});

describe("formatFetchMissingLyricsToastLabel", () => {
  it("formats cancelled and mixed summaries", () => {
    const cancelled = emptyFetchMissingLyricsSummary(3);
    cancelled.cancelled = true;
    cancelled.attempted = 2;
    cancelled.found = 1;
    cancelled.notFound = 1;
    expect(formatFetchMissingLyricsToastLabel(cancelled)).toBe(
      "Lyrics fetch cancelled (2 attempted)",
    );

    const mixed = emptyFetchMissingLyricsSummary(4);
    mixed.attempted = 4;
    mixed.found = 1;
    mixed.notFound = 1;
    mixed.ambiguous = 1;
    mixed.failed = 1;
    expect(formatFetchMissingLyricsToastLabel(mixed)).toBe(
      "Lyrics: 1 fetched · 1 not found · 1 need review · 1 failed",
    );
  });

  it("formats all-cached-miss summaries", () => {
    const summary = emptyFetchMissingLyricsSummary(2);
    summary.skipped = 2;
    summary.tracks = [
      {
        trackId: 1,
        title: "A",
        artist: "X",
        status: "skipped",
        reason: "cached_miss",
      },
      {
        trackId: 2,
        title: "B",
        artist: "Y",
        status: "skipped",
        reason: "cached_miss",
      },
    ];
    expect(formatFetchMissingLyricsToastLabel(summary)).toBe(
      "2 tracks recently checked, no lyrics",
    );
  });
});

describe("recordTrackResult", () => {
  it("accumulates per-track statuses into summary counts", () => {
    const summary = emptyFetchMissingLyricsSummary(3);
    recordTrackResult(summary, {
      trackId: 1,
      title: "A",
      artist: "X",
      status: "found",
    });
    recordTrackResult(summary, {
      trackId: 2,
      title: "B",
      artist: "Y",
      status: "skipped",
      reason: "insufficient_metadata",
    });
    recordTrackResult(summary, {
      trackId: 3,
      title: "C",
      artist: "Z",
      status: "failed",
      reason: "network",
    });

    expect(summary).toMatchObject({
      attempted: 2,
      found: 1,
      failed: 1,
      skipped: 1,
    });
    expect(summary.tracks).toHaveLength(3);
  });
});

describe("fetchMissingLyrics", () => {
  beforeEach(() => {
    library = [];
    fetchingTrackIds.clear();
    queuedTrackIds.clear();
    runSingleLyricsFetchMock.mockReset();
    logActivityMock.mockReset();
    showToastMock.mockReset();
    runInBackgroundMock.mockReset();
    setFetchingMock.mockClear();
    peekLyricsFetchCacheMock.mockReset();
    peekLyricsFetchCacheMock.mockResolvedValue("notCached");
    commitInstrumentalMarkForTrackMock.mockReset();
    commitInstrumentalMarkForTrackMock.mockResolvedValue({ status: "ok" });
  });

  it("toasts when nothing is missing", () => {
    library = [track({ lyricsFormat: "plain" })];
    fetchMissingLyrics();
    expect(showToastMock).toHaveBeenCalledWith({
      label: "No tracks missing lyrics",
    });
    expect(runInBackgroundMock).not.toHaveBeenCalled();
  });

  it("logs ineligible-only summary without starting a background job", () => {
    library = [track({ id: 9, artist: null })];
    fetchMissingLyrics();

    expect(runInBackgroundMock).not.toHaveBeenCalled();
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Starting fetch missing lyrics",
      }),
    );
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Fetch missing lyrics completed",
        details: expect.objectContaining({
          cancelled: false,
          totalMissing: 1,
          skipped: 1,
          tracks: [
            expect.objectContaining({
              trackId: 9,
              status: "skipped",
              reason: "insufficient_metadata",
            }),
          ],
        }),
      }),
    );
  });

  it("runs a cancelable job and writes a cancelled summary with attempted tracks", async () => {
    library = [
      track({ id: 1, title: "One" }),
      track({ id: 2, title: "Two" }),
      track({ id: 3, title: "Three" }),
    ];

    let cancelRequested = false;
    runSingleLyricsFetchMock.mockImplementation(async () => {
      cancelRequested = true;
      return { status: "found" };
    });

    await runBackgroundJob(() => cancelRequested);

    const completion = logActivityMock.mock.calls.find(
      (call) => call[0].message === "Fetch missing lyrics cancelled",
    );
    expect(completion).toBeTruthy();
    const summary = completion![0].details as FetchMissingLyricsSummary;
    expect(summary.cancelled).toBe(true);
    expect(summary.attempted).toBe(1);
    expect(summary.tracks).toEqual([
      expect.objectContaining({ trackId: 1, status: "found" }),
    ]);
    expect(summary.tracks.some((t) => t.trackId === 2)).toBe(false);
  });

  it("treats mid-fetch strategy cancel as cancelled, not failed", async () => {
    library = [track({ id: 1, title: "One" }), track({ id: 2, title: "Two" })];
    runSingleLyricsFetchMock.mockResolvedValueOnce({ status: "cancelled" });

    await runBackgroundJob();

    const completion = logActivityMock.mock.calls.find(
      (call) => call[0].message === "Fetch missing lyrics cancelled",
    );
    expect(completion).toBeTruthy();
    const summary = completion![0].details as FetchMissingLyricsSummary;
    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.tracks).toEqual([
      expect.objectContaining({
        trackId: 1,
        status: "skipped",
        reason: "cancelled",
      }),
    ]);
    expect(summary.tracks.some((t) => t.trackId === 2)).toBe(false);
  });

  it("settles cancel with Review when ambiguous matches remain", async () => {
    library = [
      track({ id: 1, title: "One" }),
      track({ id: 2, title: "Two" }),
      track({ id: 3, title: "Three" }),
    ];

    let cancelRequested = false;
    runSingleLyricsFetchMock
      .mockImplementationOnce(async () => {
        return { status: "ambiguous" };
      })
      .mockImplementationOnce(async () => {
        cancelRequested = true;
        return { status: "found" };
      });

    const ctx = await runBackgroundJob(() => cancelRequested);

    expect(ctx.settleAs).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Lyrics: 1 fetched · 1 need review",
        actions: [expect.objectContaining({ id: "lyrics-review" })],
      }),
    );
  });

  it("skips cached misses and only fetches uncached tracks", async () => {
    library = [
      track({ id: 1, title: "Cached miss" }),
      track({ id: 2, title: "Needs fetch" }),
    ];
    peekLyricsFetchCacheMock
      .mockResolvedValueOnce("miss")
      .mockResolvedValueOnce("notCached");
    runSingleLyricsFetchMock.mockResolvedValueOnce({ status: "found" });

    await runBackgroundJob();

    expect(runSingleLyricsFetchMock).toHaveBeenCalledTimes(1);
    expect(runSingleLyricsFetchMock).toHaveBeenCalledWith(
      2,
      expect.any(Object),
      expect.any(Object),
    );

    const completion = logActivityMock.mock.calls.find(
      (call) => call[0].message === "Fetch missing lyrics completed",
    );
    const summary = completion![0].details as FetchMissingLyricsSummary;
    expect(summary.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackId: 1,
          status: "skipped",
          reason: "cached_miss",
        }),
        expect.objectContaining({ trackId: 2, status: "found" }),
      ]),
    );
  });
});
