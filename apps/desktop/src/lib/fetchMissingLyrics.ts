import { logActivity } from "./activityLog";
import { BackgroundTaskCancelledError } from "./backgroundTaskCancel";
import { commitInstrumentalMarkForTrack } from "./lyricsFetchCommit";
import {
  buildLyricsFetchParamsForTrack,
  canFetchLyricsForTrack,
  RETRY_DETAIL,
  runSingleLyricsFetch,
} from "./lyricsFetchRunner";
import { t } from "./i18n";
import {
  formatLyricsFetchPeerTitle,
  lyricsFetchBulkSettleOptions,
} from "./lyricsFetchToastSettle";
import { lyricsNoneMissingPayload } from "./toastPayloads";
import { yieldForInteraction } from "./scheduling";
import { clearLyricsFetchCancel, peekLyricsFetchCache } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLyricsFetchStore } from "../store/useLyricsFetchStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import type { Track } from "../types/track";

export const LYRICS_FETCH_MISSING_KEY = "lyrics-fetch-missing";

type FetchMissingLyricsTrackStatus =
  "found" | "not_found" | "instrumental" | "ambiguous" | "failed" | "skipped";

type FetchMissingLyricsSkipReason =
  | "insufficient_metadata"
  | "already_in_progress"
  | "already_has_lyrics"
  | "cached_miss"
  | "cancelled";

type FetchMissingLyricsTrackResult = {
  trackId: number;
  title: string;
  artist: string | null;
  status: FetchMissingLyricsTrackStatus;
  reason?: FetchMissingLyricsSkipReason | string;
};

export type FetchMissingLyricsSummary = {
  cancelled: boolean;
  totalMissing: number;
  attempted: number;
  found: number;
  notFound: number;
  instrumental: number;
  ambiguous: number;
  failed: number;
  skipped: number;
  tracks: FetchMissingLyricsTrackResult[];
};

type MissingLyricsPartition = {
  eligible: Track[];
  ineligible: Track[];
};

type EligibleCacheFilterResult = {
  toFetch: Track[];
  cachedMiss: Track[];
  cachedInstrumental: Track[];
};

export function partitionMissingLyricsTracks(
  library: Track[],
): MissingLyricsPartition {
  const eligible: Track[] = [];
  const ineligible: Track[] = [];

  for (const track of library) {
    if (track.lyricsFormat != null) continue;
    if (canFetchLyricsForTrack(track)) {
      eligible.push(track);
    } else {
      ineligible.push(track);
    }
  }

  return { eligible, ineligible };
}

/** Drop tracks with a still-valid miss/instrumental cache entry from the fetch set. */
export async function filterEligibleByFetchCache(
  eligible: Track[],
  options?: {
    isCancelRequested?: () => boolean;
  },
): Promise<EligibleCacheFilterResult> {
  const toFetch: Track[] = [];
  const cachedMiss: Track[] = [];
  const cachedInstrumental: Track[] = [];

  for (let i = 0; i < eligible.length; i++) {
    if (options?.isCancelRequested?.()) {
      break;
    }

    const track = eligible[i];
    const params = buildLyricsFetchParamsForTrack(track);
    if (!params) {
      toFetch.push(track);
      continue;
    }

    let peek: Awaited<ReturnType<typeof peekLyricsFetchCache>>;
    try {
      peek = await peekLyricsFetchCache({
        artist: params.artist,
        title: params.title,
        durationSeconds: params.durationSeconds,
      });
    } catch {
      toFetch.push(track);
      continue;
    }

    if (peek === "miss") {
      cachedMiss.push(track);
    } else if (peek === "instrumental") {
      cachedInstrumental.push(track);
    } else {
      // notCached or hit — still worth running (hit applies lyrics from cache).
      toFetch.push(track);
    }

    await yieldForInteraction();
  }

  return { toFetch, cachedMiss, cachedInstrumental };
}

export function emptyFetchMissingLyricsSummary(
  totalMissing: number,
): FetchMissingLyricsSummary {
  return {
    cancelled: false,
    totalMissing,
    attempted: 0,
    found: 0,
    notFound: 0,
    instrumental: 0,
    ambiguous: 0,
    failed: 0,
    skipped: 0,
    tracks: [],
  };
}

export function recordTrackResult(
  summary: FetchMissingLyricsSummary,
  result: FetchMissingLyricsTrackResult,
): void {
  summary.tracks.push(result);
  switch (result.status) {
    case "found":
      summary.found += 1;
      summary.attempted += 1;
      break;
    case "not_found":
      summary.notFound += 1;
      summary.attempted += 1;
      break;
    case "instrumental":
      summary.instrumental += 1;
      summary.attempted += 1;
      break;
    case "ambiguous":
      summary.ambiguous += 1;
      summary.attempted += 1;
      break;
    case "failed":
      summary.failed += 1;
      summary.attempted += 1;
      break;
    case "skipped":
      summary.skipped += 1;
      break;
  }
}

export function formatFetchMissingLyricsToastLabel(
  summary: FetchMissingLyricsSummary,
): string {
  const { cancelled, skipped, attempted } = summary;

  if (cancelled) {
    if (attempted === 0 && skipped === 0) {
      return t("toasts:lyricsMissing.cancelled");
    }
    return t("toasts:lyricsMissing.cancelledAttempted", { count: attempted });
  }

  if (attempted === 0 && skipped > 0) {
    const cachedMissCount = summary.tracks.filter(
      (track) => track.status === "skipped" && track.reason === "cached_miss",
    ).length;
    if (cachedMissCount === skipped) {
      return t("toasts:lyricsMissing.recentlyChecked", { count: skipped });
    }
    return t("toasts:lyricsMissing.couldNotFetch", { count: skipped });
  }

  return formatLyricsFetchPeerTitle({
    found: summary.found,
    notFound: summary.notFound,
    ambiguous: summary.ambiguous,
    failed: summary.failed,
    instrumental: summary.instrumental,
    skipped: summary.skipped,
  });
}

function ambiguousTrackIds(summary: FetchMissingLyricsSummary): number[] {
  return summary.tracks
    .filter((item) => item.status === "ambiguous")
    .map((item) => item.trackId);
}

function failureDetailLines(summary: FetchMissingLyricsSummary): string[] {
  return summary.tracks
    .filter((track) => track.status === "failed")
    .map((track) => {
      const reason = track.reason?.trim();
      return reason ? `${track.title}: ${reason}` : track.title;
    });
}

function trackResultBase(
  track: Track,
): Pick<FetchMissingLyricsTrackResult, "trackId" | "title" | "artist"> {
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
  };
}

function logSummary(summary: FetchMissingLyricsSummary): void {
  const level = summary.cancelled || summary.failed > 0 ? "warn" : "info";
  logActivity({
    level,
    domain: ACTIVITY_LOG_DOMAINS.lyricsFetch,
    message: summary.cancelled
      ? "Fetch missing lyrics cancelled"
      : "Fetch missing lyrics completed",
    details: {
      cancelled: summary.cancelled,
      totalMissing: summary.totalMissing,
      attempted: summary.attempted,
      found: summary.found,
      notFound: summary.notFound,
      instrumental: summary.instrumental,
      ambiguous: summary.ambiguous,
      failed: summary.failed,
      skipped: summary.skipped,
      tracks: summary.tracks,
    },
  });
}

function seedIneligibleResults(
  summary: FetchMissingLyricsSummary,
  ineligible: Track[],
): void {
  for (const track of ineligible) {
    recordTrackResult(summary, {
      ...trackResultBase(track),
      status: "skipped",
      reason: "insufficient_metadata",
    });
  }
}

function seedCachedMissResults(
  summary: FetchMissingLyricsSummary,
  tracks: Track[],
): void {
  for (const track of tracks) {
    recordTrackResult(summary, {
      ...trackResultBase(track),
      status: "skipped",
      reason: "cached_miss",
    });
  }
}

async function applyCachedInstrumentalResults(
  summary: FetchMissingLyricsSummary,
  tracks: Track[],
): Promise<void> {
  for (const track of tracks) {
    await commitInstrumentalMarkForTrack(track.id);
    recordTrackResult(summary, {
      ...trackResultBase(track),
      status: "instrumental",
    });
  }
}

export function fetchMissingLyrics(): void {
  const library = usePlayerStore.getState().library;
  const { eligible, ineligible } = partitionMissingLyricsTracks(library);
  const totalMissing = eligible.length + ineligible.length;

  if (totalMissing === 0) {
    useBackgroundTasksStore.getState().showToast(lyricsNoneMissingPayload());
    return;
  }

  if (eligible.length === 0) {
    const summary = emptyFetchMissingLyricsSummary(totalMissing);
    seedIneligibleResults(summary, ineligible);

    logActivity({
      level: "info",
      domain: ACTIVITY_LOG_DOMAINS.lyricsFetch,
      message: "Starting fetch missing lyrics",
      details: { totalMissing, eligible: 0, ineligible: ineligible.length },
    });
    logSummary(summary);

    useBackgroundTasksStore.getState().showToast({
      label: formatFetchMissingLyricsToastLabel(summary),
    });
    return;
  }

  useBackgroundTasksStore.getState().runInBackground({
    key: LYRICS_FETCH_MISSING_KEY,
    label: t("toasts:lyricsMissing.fetching"),
    cancellable: true,
    progressDisplay: "bar",
    run: async (ctx) => {
      await clearLyricsFetchCancel();

      const summary = emptyFetchMissingLyricsSummary(totalMissing);
      seedIneligibleResults(summary, ineligible);

      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.lyricsFetch,
        message: "Starting fetch missing lyrics",
        details: {
          totalMissing,
          eligible: eligible.length,
          ineligible: ineligible.length,
        },
      });

      try {
        ctx.setDetail(t("toasts:lyricsMissing.checkingCache"));
        const { toFetch, cachedMiss, cachedInstrumental } =
          await filterEligibleByFetchCache(eligible, {
            isCancelRequested: () => ctx.isCancelRequested(),
          });

        seedCachedMissResults(summary, cachedMiss);
        await applyCachedInstrumentalResults(summary, cachedInstrumental);

        if (ctx.isCancelRequested()) {
          summary.cancelled = true;
          const toastLabel = formatFetchMissingLyricsToastLabel(summary);
          ctx.setLabel(toastLabel);
          ctx.clearDetail();
          ctx.clearProgress();
          logSummary(summary);
          throw new BackgroundTaskCancelledError(toastLabel);
        }

        if (toFetch.length === 0) {
          const toastLabel = formatFetchMissingLyricsToastLabel(summary);
          ctx.setLabel(toastLabel);
          ctx.clearDetail();
          ctx.clearProgress();
          logSummary(summary);
          return;
        }

        for (let i = 0; i < toFetch.length; i++) {
          if (ctx.isCancelRequested()) {
            summary.cancelled = true;
            break;
          }

          const track = toFetch[i];
          const lyricsStore = useLyricsFetchStore.getState();

          if (
            lyricsStore.fetchingTrackIds.has(track.id) ||
            lyricsStore.queuedTrackIds.has(track.id)
          ) {
            recordTrackResult(summary, {
              ...trackResultBase(track),
              status: "skipped",
              reason: "already_in_progress",
            });
            ctx.setProgress(i + 1, toFetch.length);
            await yieldForInteraction();
            continue;
          }

          const params = buildLyricsFetchParamsForTrack(track);
          if (!params) {
            recordTrackResult(summary, {
              ...trackResultBase(track),
              status: "skipped",
              reason: "insufficient_metadata",
            });
            ctx.setProgress(i + 1, toFetch.length);
            await yieldForInteraction();
            continue;
          }

          ctx.setDetail(track.title);
          ctx.setProgress(i, toFetch.length);
          lyricsStore.setFetching(track.id, true);

          try {
            const result = await runSingleLyricsFetch(track.id, params, {
              skipIfHasLyrics: true,
              respectMissCache: true,
              onRetry: () => {
                if (!ctx.isCancelRequested()) {
                  ctx.setDetail(RETRY_DETAIL());
                }
              },
            });

            if (result.status === "cancelled") {
              summary.cancelled = true;
              recordTrackResult(summary, {
                ...trackResultBase(track),
                status: "skipped",
                reason: "cancelled",
              });
            } else if (result.status === "error") {
              const message =
                result.error instanceof Error
                  ? result.error.message
                  : String(result.error);
              recordTrackResult(summary, {
                ...trackResultBase(track),
                status: "failed",
                reason: message,
              });
            } else if (result.status === "skipped") {
              recordTrackResult(summary, {
                ...trackResultBase(track),
                status: "skipped",
                reason: result.reason,
              });
            } else {
              recordTrackResult(summary, {
                ...trackResultBase(track),
                status: result.status,
              });
            }
          } finally {
            useLyricsFetchStore.getState().setFetching(track.id, false);
          }

          if (summary.cancelled) {
            break;
          }

          ctx.setProgress(i + 1, toFetch.length);
          await yieldForInteraction();
        }

        if (ctx.isCancelRequested()) {
          summary.cancelled = true;
        }

        const toastLabel = formatFetchMissingLyricsToastLabel(summary);
        ctx.setLabel(toastLabel);
        ctx.clearDetail();
        ctx.clearProgress();
        logSummary(summary);

        const reviewIds = ambiguousTrackIds(summary);
        if (summary.cancelled) {
          // Preserve Review when cancel interrupted after ambiguous matches.
          if (reviewIds.length > 0) {
            ctx.settleAs(
              lyricsFetchBulkSettleOptions({
                tally: {
                  found: summary.found,
                  notFound: summary.notFound,
                  ambiguous: summary.ambiguous,
                  failed: summary.failed,
                  instrumental: summary.instrumental,
                  skipped: summary.skipped,
                },
                errorLines: failureDetailLines(summary),
                reviewTrackIds: reviewIds,
              }),
            );
            return;
          }
          throw new BackgroundTaskCancelledError(toastLabel);
        }

        ctx.settleAs(
          lyricsFetchBulkSettleOptions({
            tally: {
              found: summary.found,
              notFound: summary.notFound,
              ambiguous: summary.ambiguous,
              failed: summary.failed,
              instrumental: summary.instrumental,
              skipped: summary.skipped,
            },
            errorLines: failureDetailLines(summary),
            reviewTrackIds: reviewIds,
          }),
        );
      } finally {
        await clearLyricsFetchCancel().catch(() => {});
      }
    },
  });
}
