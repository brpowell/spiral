import type { BackgroundTaskRunContext } from "../store/useBackgroundTasksStore";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLyricsFetchStore } from "../store/useLyricsFetchStore";
import { logActivity } from "./activityLog";
import { t } from "./i18n";
import {
  lyricsAmbiguousSettleOptions,
  lyricsFetchBulkSettleOptions,
} from "./lyricsFetchToastSettle";
import {
  RETRY_DETAIL,
  runSingleLyricsFetch,
  type LyricsFetchParams,
} from "./lyricsFetchRunner";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

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
  ambiguousTrackIds: number[];
  soloAmbiguous: { trackId: number; displayTitle: string } | null;
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
  ctx.setLabel(t("toasts:lyrics.fetching"));
  ctx.setProgress(state.processedCount, total);
  if (state.currentDisplayTitle) {
    ctx.setDetail(state.currentDisplayTitle);
  }
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
    ctx.setLabel(t("toasts:lyrics.fetching"));
    ctx.setProgress(state.processedCount, total);
    ctx.setDetail(displayTitle);
  } else {
    ctx.setLabel(t("toasts:lyrics.fetchingFor", { title: displayTitle }));
    ctx.clearDetail();
    ctx.clearProgress();
  }

  const result = await runSingleLyricsFetch(trackId, params, {
    respectMissCache,
    skipIfHasLyrics,
    onRetry: () => ctx.setDetail(RETRY_DETAIL()),
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
        ctx.setLabel(t("toasts:lyrics.fetchedFor", { title: displayTitle }));
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
      state.ambiguousTrackIds.push(trackId);
      if (!state.bulkMode) {
        state.soloAmbiguous = { trackId, displayTitle };
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
    ambiguousTrackIds: [],
    soloAmbiguous: null,
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
      logActivity({
        level: state.tally.failed > 0 ? "warn" : "info",
        domain: ACTIVITY_LOG_DOMAINS.lyricsFetch,
        message: "Lyrics fetch completed",
        details: {
          ...state.tally,
          errors: state.errorLines,
          ambiguousTrackIds: state.ambiguousTrackIds,
        },
      });

      const settle = lyricsFetchBulkSettleOptions({
        tally: state.tally,
        errorLines: state.errorLines,
        reviewTrackIds: state.ambiguousTrackIds,
      });
      ctx.clearProgress();
      ctx.settleAs(settle);
      return;
    }

    if (state.dismissSilently) {
      ctx.dismissSilently();
      return;
    }

    if (state.soloAmbiguous) {
      ctx.settleAs(
        lyricsAmbiguousSettleOptions(
          state.soloAmbiguous.displayTitle,
          state.soloAmbiguous.trackId,
        ),
      );
    }
  } finally {
    activeProcessor = null;
  }
}

function ensureProcessorRunning(): void {
  useBackgroundTasksStore.getState().runInBackground({
    key: LYRICS_FETCH_BULK_KEY,
    label: t("toasts:lyrics.fetching"),
    progressDisplay: "bar",
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
    reviewQueueTrackIds: [],
    reviewQueueIndex: 0,
    pendingByTrackId: {},
  });
}
