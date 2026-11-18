import { listen } from "@tauri-apps/api/event";
import { getActiveScans, SOURCE_SCAN_EVENT } from "@/lib/tauri";
import { sourceScanSettleOptions } from "@/lib/toast/toastPayloads";
import { t } from "@/lib/i18n/i18n";
import { useBackgroundTasksStore } from "@/store/useBackgroundTasksStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useSourceScansStore } from "@/store/useSourceScansStore";
import { useSourcesStore } from "@/store/useSourcesStore";
import type {
  ReconcileSummary,
  ScanProgress,
  SourceScanEvent,
} from "@/types/source";
import { sourceDisplayName } from "./sourceAccess";

/** Updates a scan's running toast as it progresses. */
const toastUpdaters = new Map<
  number,
  (progress: ScanProgress | null) => void
>();

/** Resolves a scan's running toast with its result; null if it errored. */
const toastWaiters = new Map<
  number,
  (summary: ReconcileSummary | null) => void
>();

function sourceName(sourceId: number): string {
  const source = useSourcesStore.getState().sourcesById.get(sourceId);
  return source ? sourceDisplayName(source) : "";
}

/** Show a background task for a scan that's running, settled by its result. */
function startScanToast(sourceId: number): void {
  if (toastWaiters.has(sourceId)) return;
  void useBackgroundTasksStore.getState().runInBackground({
    key: `source-scan-${sourceId}`,
    label: t("toasts:sourceScan.running"),
    progressDisplay: "bar",
    run: (ctx) =>
      new Promise<void>((resolve) => {
        toastUpdaters.set(sourceId, (progress) => {
          if (progress?.phase === "walking") {
            ctx.clearProgress();
            ctx.setDetail(
              progress.found > 0
                ? t("toasts:sourceScan.finding", {
                    count: progress.found,
                    found: progress.found.toLocaleString(),
                  })
                : t("toasts:sourceScan.findingStart"),
            );
          } else if (progress?.phase === "reading") {
            ctx.setProgress(progress.current, progress.total);
            ctx.setDetail(
              t("toasts:sourceScan.progress", {
                current: progress.current.toLocaleString(),
                total: progress.total.toLocaleString(),
              }),
            );
          }
        });
        toastWaiters.set(sourceId, (summary) => {
          toastWaiters.delete(sourceId);
          toastUpdaters.delete(sourceId);
          if (summary) {
            // Looked up now: a folder just added isn't in the store yet when its
            // scan starts.
            ctx.settleAs(
              sourceScanSettleOptions(sourceName(sourceId), summary),
            );
          } else {
            ctx.dismissSilently();
          }
          resolve();
        });
      }),
  });
}

/** A startup scan only gets a toast if it runs this long. */
export const BACKGROUND_SCAN_TOAST_DELAY_MS = 2000;

export function handleSourceScanEvent(event: SourceScanEvent): void {
  const scans = useSourceScansStore.getState();
  if (event.phase === "started") {
    scans.begin(event.sourceId);
    // Onboarding shows the scan on the folder's card; the toast waits.
    if (useOnboardingStore.getState().open) return;
    if (!event.background) {
      startScanToast(event.sourceId);
      return;
    }
    // Picking up a scan the last run didn't finish, or just checking for
    // changes: stay quiet unless it takes a while.
    window.setTimeout(() => {
      if (
        useSourceScansStore.getState().scanning.has(event.sourceId) &&
        !useOnboardingStore.getState().open
      ) {
        startScanToast(event.sourceId);
      }
    }, BACKGROUND_SCAN_TOAST_DELAY_MS);
    return;
  }
  if (event.phase === "progress") {
    scans.setProgress(event.sourceId, event.progress);
    if (event.progress) toastUpdaters.get(event.sourceId)?.(event.progress);
    return;
  }
  scans.end(event.sourceId);
  toastWaiters.get(event.sourceId)?.(event.summary);
}

/**
 * Follow the scan that runs after a folder is added: the folder's card shows
 * it at once, and a background task toast does too, but only once onboarding
 * is done (scans still running when it finishes get their toast then).
 * Returns a function that stops listening.
 */
export function startSourceScanTracking(): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  // The startup scan begins before this window is listening, so ask what's
  // running once attached. A scan that ends meanwhile must not be revived.
  const endedMeanwhile = new Set<number>();
  let seeded = false;
  void listen<SourceScanEvent>(SOURCE_SCAN_EVENT, (e) => {
    if (!seeded && e.payload.phase === "finished") {
      endedMeanwhile.add(e.payload.sourceId);
    }
    handleSourceScanEvent(e.payload);
  }).then(async (fn) => {
    if (cancelled) {
      fn();
      return;
    }
    unlisten = fn;
    try {
      for (const scan of await getActiveScans()) {
        if (endedMeanwhile.has(scan.sourceId)) continue;
        handleSourceScanEvent({
          sourceId: scan.sourceId,
          phase: "started",
          summary: null,
          progress: null,
          background: scan.background,
        });
        if (scan.progress) {
          handleSourceScanEvent({
            sourceId: scan.sourceId,
            phase: "progress",
            summary: null,
            progress: scan.progress,
            background: scan.background,
          });
        }
      }
    } catch (err) {
      console.error("getActiveScans failed:", err);
    } finally {
      seeded = true;
    }
  });
  const unsubscribe = useOnboardingStore.subscribe((state, prev) => {
    if (prev.open && !state.open) {
      for (const id of useSourceScansStore.getState().scanning) {
        startScanToast(id);
      }
    }
  });
  return () => {
    cancelled = true;
    unlisten?.();
    unsubscribe();
  };
}
