import type { BackgroundTaskRunContext } from "../store/useBackgroundTasksStore";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLyricsFetchStore } from "../store/useLyricsFetchStore";
import { formatFailureDetail } from "./formatFailureDetail";
import {
  RETRY_DETAIL,
  runSingleLyricsFetch,
  type LyricsFetchParams,
} from "./lyricsFetchRunner";

export const LYRICS_FETCH_BULK_KEY = "lyrics-fetch-bulk";

type LyricsFetchToastContext = Pick<
  BackgroundTaskRunContext,
  | "setLabel"
  | "setDetail"
  | "clearDetail"
  | "setProgress"
  | "clearProgress"
  | "dismissSilently"
>;

type LyricsFetchPriority = "manual" | "auto";

type QueueItem = {
  trackId: number;
  displayTitle: string;
  params: LyricsFetchParams;
  respectMissCache?: boolean;
  skipIfHasLyrics?: boolean;
};

type ProcessorState = {
  processedCount: number;
  bulkMode: boolean;
  currentDisplayTitle: string | null;
  tally: {
    found: number;
    notFound: number;
    ambiguous: number;
    failed: number;
  };
  errorLines: string[];
  dismissSilently: boolean;
};

type ActiveProcessor = {
  ctx: LyricsFetchToastContext;
  state: ProcessorState;
};

const manualQueue: QueueItem[] = [];
const autoQueue: QueueItem[] = [];

let processorPromise: Promise<void> | null = null;
let activeProcessor: ActiveProcessor | null = null;

function queueSize(): number {
  return manualQueue.length + autoQueue.length;
}

function isTrackInFlight(trackId: number): boolean {
  return useLyricsFetchStore.getState().fetchingTrackIds.has(trackId);
}

function setTrackQueued(trackId: number, isQueued: boolean): void {
  useLyricsFetchStore.getState().setQueued(trackId, isQueued);
}

function removeFromQueueAt(
  queue: QueueItem[],
  index: number,
): QueueItem | undefined {
  const [item] = queue.splice(index, 1);
  if (item) {
    setTrackQueued(item.trackId, false);
  }
  return item;
}

function addToQueue(item: QueueItem, queue: QueueItem[]): void {
  queue.push(item);
  setTrackQueued(item.trackId, true);
}

function unshiftToQueue(item: QueueItem, queue: QueueItem[]): void {
  queue.unshift(item);
  setTrackQueued(item.trackId, true);
}

function popNextItem(): QueueItem | undefined {
  if (manualQueue.length > 0) {
    return removeFromQueueAt(manualQueue, 0);
  }
  if (autoQueue.length > 0) {
    return removeFromQueueAt(autoQueue, 0);
  }
  return undefined;
}

function findQueueIndex(queue: QueueItem[], trackId: number): number {
  return queue.findIndex((item) => item.trackId === trackId);
}

function totalItemsInRun(processedCount: number): number {
  return processedCount + queueSize() + 1;
}

function isBulkMode(processedCount: number): boolean {
  return totalItemsInRun(processedCount) > 1;
}

function refreshActiveBulkToast(): void {
  if (!activeProcessor) return;

  const { ctx, state } = activeProcessor;
  const total = totalItemsInRun(state.processedCount);
  if (total <= 1) return;

  state.bulkMode = true;
  ctx.setLabel("Fetching lyrics…");
  ctx.setProgress(state.processedCount, total);
  if (state.currentDisplayTitle) {
    ctx.setDetail(state.currentDisplayTitle);
  }
}

function buildBulkSummary(tally: {
  found: number;
  notFound: number;
  ambiguous: number;
  failed: number;
}): string {
  const { found, notFound, ambiguous, failed } = tally;
  const total = found + notFound + ambiguous + failed;

  if (failed > 0 && found === 0 && ambiguous === 0) {
    return failed === 1
      ? "Lyrics fetch failed"
      : `Lyrics fetch failed (${failed})`;
  }

  if (found === total) {
    return found === 1
      ? "Lyrics fetched"
      : `Lyrics fetched for ${found} tracks`;
  }

  if (found === 0 && ambiguous === 0 && notFound === total) {
    return total === 1
      ? "No lyrics found"
      : `No lyrics found (${total} tracks)`;
  }

  const parts: string[] = [];
  if (found > 0) {
    parts.push(`fetched ${found}`);
  }
  if (notFound > 0) {
    parts.push(`${notFound} not found`);
  }
  if (ambiguous > 0) {
    parts.push(`${ambiguous} need review`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  return `Lyrics: ${parts.join(", ")}`;
}

async function processQueueItem(
  item: QueueItem,
  ctx: LyricsFetchToastContext,
  state: ProcessorState,
): Promise<void> {
  const { trackId, displayTitle, params, respectMissCache, skipIfHasLyrics } =
    item;
  const store = useLyricsFetchStore.getState();

  state.currentDisplayTitle = displayTitle;
  store.setFetching(trackId, true);

  const bulk = state.bulkMode || isBulkMode(state.processedCount);

  if (bulk) {
    state.bulkMode = true;
    const total = totalItemsInRun(state.processedCount);
    ctx.setLabel("Fetching lyrics…");
    ctx.setProgress(state.processedCount, total);
    ctx.setDetail(displayTitle);
  } else {
    ctx.setLabel(`Fetching lyrics for ${displayTitle}`);
    ctx.clearDetail();
    ctx.clearProgress();
  }

  const result = await runSingleLyricsFetch(trackId, params, {
    respectMissCache,
    skipIfHasLyrics,
    onRetry: () => ctx.setDetail(RETRY_DETAIL),
  });

  store.setFetching(trackId, false);
  state.processedCount += 1;
  state.currentDisplayTitle = null;

  if (state.bulkMode) {
    ctx.setProgress(
      state.processedCount,
      totalItemsInRun(state.processedCount),
    );
  }

  switch (result.status) {
    case "skipped":
      if (!state.bulkMode) {
        state.dismissSilently = true;
      }
      break;
    case "found":
      state.tally.found += 1;
      if (!state.bulkMode) {
        ctx.setLabel(`Lyrics fetched for ${displayTitle}`);
        ctx.clearDetail();
      }
      break;
    case "not_found":
      state.tally.notFound += 1;
      if (!state.bulkMode) {
        state.dismissSilently = true;
        ctx.clearDetail();
      }
      break;
    case "ambiguous":
      state.tally.ambiguous += 1;
      if (!state.bulkMode) {
        ctx.setLabel(`Multiple lyrics matches for ${displayTitle}`);
        ctx.clearDetail();
      }
      break;
    case "error": {
      state.tally.failed += 1;
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      state.errorLines.push(`${displayTitle}: ${message}`);
      if (!state.bulkMode) {
        throw result.error;
      }
      break;
    }
  }
}

async function runProcessorLoop(ctx: BackgroundTaskRunContext): Promise<void> {
  const state: ProcessorState = {
    processedCount: 0,
    bulkMode: false,
    currentDisplayTitle: null,
    tally: {
      found: 0,
      notFound: 0,
      ambiguous: 0,
      failed: 0,
    },
    errorLines: [],
    dismissSilently: false,
  };

  activeProcessor = { ctx, state };

  try {
    while (queueSize() > 0) {
      const item = popNextItem();
      if (!item) break;

      await processQueueItem(item, ctx, state);
    }

    if (state.bulkMode) {
      ctx.setLabel(buildBulkSummary(state.tally));
      if (state.errorLines.length > 0) {
        ctx.setDetail(formatFailureDetail(state.errorLines));
      } else {
        ctx.clearDetail();
      }
      ctx.clearProgress();

      if (state.tally.failed > 0) {
        throw new Error(buildBulkSummary(state.tally));
      }
      return;
    }

    if (state.dismissSilently) {
      ctx.dismissSilently();
    }
  } finally {
    activeProcessor = null;
  }
}

function ensureProcessorRunning(): void {
  useBackgroundTasksStore.getState().runInBackground({
    key: LYRICS_FETCH_BULK_KEY,
    label: "Fetching lyrics…",
    run: async (ctx) => {
      if (processorPromise) return;

      processorPromise = runProcessorLoop(ctx);
      try {
        await processorPromise;
      } finally {
        processorPromise = null;
        if (queueSize() > 0) {
          queueMicrotask(() => ensureProcessorRunning());
        }
      }
    },
  });
}

export function enqueueLyricsFetch(
  trackId: number,
  displayTitle: string,
  params: LyricsFetchParams,
  options: {
    priority: LyricsFetchPriority;
    respectMissCache?: boolean;
  },
): void {
  useLyricsFetchStore.getState().clearPending(trackId);

  if (isTrackInFlight(trackId)) {
    return;
  }

  const manualIndex = findQueueIndex(manualQueue, trackId);
  const autoIndex = findQueueIndex(autoQueue, trackId);

  const item: QueueItem = {
    trackId,
    displayTitle,
    params,
    respectMissCache: options.respectMissCache,
    // Auto-fetch must not overwrite existing lyrics; manual refetch may replace.
    skipIfHasLyrics: options.priority === "auto",
  };

  if (options.priority === "manual") {
    if (manualIndex >= 0) {
      return;
    }
    if (autoIndex >= 0) {
      removeFromQueueAt(autoQueue, autoIndex);
      unshiftToQueue(item, manualQueue);
      ensureProcessorRunning();
      refreshActiveBulkToast();
      return;
    }
    unshiftToQueue(item, manualQueue);
  } else {
    if (manualIndex >= 0 || autoIndex >= 0) {
      return;
    }
    addToQueue(item, autoQueue);
  }

  ensureProcessorRunning();
  refreshActiveBulkToast();
}

/** @internal Test-only reset for module-level queue state. */
export function resetLyricsFetchQueueForTests(): void {
  manualQueue.length = 0;
  autoQueue.length = 0;
  processorPromise = null;
  activeProcessor = null;
  useLyricsFetchStore.setState({
    queuedTrackIds: new Set(),
    fetchingTrackIds: new Set(),
  });
}
