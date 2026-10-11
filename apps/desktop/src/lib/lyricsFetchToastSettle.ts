import type {
  BackgroundTaskAction,
  BackgroundTaskSettleAsOptions,
} from "../store/useBackgroundTasksStore";
import { useLyricsFetchStore } from "../store/useLyricsFetchStore";
import { t } from "./i18n";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";

/**
 * Bulk lyrics-fetch toast rules (see Toast Spec: Lyrics Fetch):
 * - Title: number-first peer clauses, middot-joined, zero-suppressed.
 * - Always prefixed (`Lyrics:`) — every clause is a generic outcome word.
 * - Color from `failed` only (not-found / need-review are not failures).
 * - Need-review + no failures → [Review]/Choose] only.
 * - Need-review + failures → [Review] primary + [View logs] secondary.
 * - Else 1 failure → inline detail; 2+ → View logs.
 */

export type LyricsFetchPeerTally = {
  found: number;
  notFound: number;
  ambiguous: number;
  failed: number;
  instrumental?: number;
  skipped?: number;
};

export function formatLyricsFetchPeerTitle(
  tally: LyricsFetchPeerTally,
): string {
  return formatPeerOutcomeTitle(
    [
      ...(tally.found > 0
        ? [{ text: t("toasts:lyrics.partFetched", { count: tally.found }) }]
        : []),
      ...((tally.instrumental ?? 0) > 0
        ? [
            {
              text: t("toasts:lyrics.partInstrumental", {
                count: tally.instrumental,
              }),
            },
          ]
        : []),
      ...(tally.notFound > 0
        ? [
            {
              text: t("toasts:lyrics.partNotFound", { count: tally.notFound }),
            },
          ]
        : []),
      ...(tally.ambiguous > 0
        ? [
            {
              text: t("toasts:lyrics.partNeedReview", {
                count: tally.ambiguous,
              }),
            },
          ]
        : []),
      ...(tally.failed > 0
        ? [{ text: t("toasts:lyrics.partFailed", { count: tally.failed }) }]
        : []),
      ...((tally.skipped ?? 0) > 0
        ? [
            {
              text: t("toasts:lyrics.partSkipped", { count: tally.skipped }),
            },
          ]
        : []),
    ],
    {
      operation: t("toasts:lyrics.operation"),
      fallback: t("toasts:lyrics.fetching"),
    },
  );
}

function lyricsFetchBulkStatus(
  tally: LyricsFetchPeerTally,
): Extract<
  BackgroundTaskSettleAsOptions["status"],
  "success" | "warning" | "error"
> {
  if (tally.failed === 0) return "success";
  const successes = tally.found + (tally.instrumental ?? 0);
  return successes > 0 ? "warning" : "error";
}

function reviewLyricsAction(trackIds: number[]): BackgroundTaskAction {
  return {
    id: "lyrics-review",
    label: t("toasts:lyrics.review"),
    variant: "primary",
    onClick: () => {
      useLyricsFetchStore.getState().openReviewQueue(trackIds);
    },
  };
}

function chooseLyricsAction(trackIds: number[]): BackgroundTaskAction {
  return {
    id: "lyrics-choose",
    label: t("toasts:lyrics.choose"),
    variant: "primary",
    onClick: () => {
      useLyricsFetchStore.getState().openReviewQueue(trackIds);
    },
  };
}

export function lyricsFetchBulkSettleOptions(options: {
  tally: LyricsFetchPeerTally;
  errorLines?: string[];
  operationId?: string;
  /** Tracks that need candidate review, if any. */
  reviewTrackIds?: number[];
}): BackgroundTaskSettleAsOptions & { label: string } {
  const { tally, errorLines = [], operationId, reviewTrackIds = [] } = options;
  const label = formatLyricsFetchPeerTitle(tally);
  const status = lyricsFetchBulkStatus(tally);

  if (tally.ambiguous > 0 && reviewTrackIds.length > 0) {
    return {
      status,
      label,
      actions: [reviewLyricsAction(reviewTrackIds)],
      ...(tally.failed >= 1 && operationId ? { logLink: { operationId } } : {}),
    };
  }

  if (tally.failed === 1) {
    return {
      status,
      label,
      detail: errorLines[0],
    };
  }

  if (tally.failed >= 2 && operationId) {
    return {
      status,
      label,
      logLink: { operationId },
    };
  }

  return { status, label };
}

export function lyricsAmbiguousSettleOptions(
  title: string,
  trackId: number,
): BackgroundTaskSettleAsOptions & { label: string } {
  return {
    status: "success",
    label: t("toasts:lyrics.ambiguousFor", { title }),
    actions: [chooseLyricsAction([trackId])],
  };
}
