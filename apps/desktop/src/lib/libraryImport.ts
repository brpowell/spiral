import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  commitImportEntries,
  importCompletionSettleOptions,
  importNoAudioSettleOptions,
  parseImportMetadata,
} from "./import";
import {
  flushImportActivationQueue,
  queueImportedTrackActivation,
  queuePendingImportRemoval,
  resetImportActivationQueue,
} from "./importActivationQueue";
import { logActivity } from "./activityLog";
import { BackgroundTaskCancelledError } from "./backgroundTaskCancel";
import { isTrackImporting, pendingTrackFromInput } from "./pendingImportTrack";
import {
  filterPathsForLibraryImport,
  isSupportedAudioPath,
  isZipPath,
} from "./supportedAudio";
import { waitForPaint, yieldForInteraction, yieldToMain } from "./scheduling";
import { t } from "./i18n";
import { SKIN_AUX_LABEL_PREFIX } from "./skinAuxContext";
import {
  cleanupZipImport,
  pickLibraryPaths,
  scanFolder,
  scanZipImport,
} from "./tauri";
import { isTauri } from "./windowRole";
import { reportUnexpectedError } from "./unexpectedErrorToast";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import {
  isImportCancelledError,
  useImportDedupeStore,
} from "../store/useImportDedupeStore";
import { useLibrarySettingsStore } from "../store/useLibrarySettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

interface ResolvedImportPaths {
  audioPaths: string[];
  zipExtractDirs: string[];
}

async function resolveImportPaths(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
  isCancelRequested?: () => boolean,
): Promise<ResolvedImportPaths> {
  const audioPaths: string[] = [];
  const zipExtractDirs: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
    if (isCancelRequested?.()) {
      throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"));
    }
    const path = paths[i];
    if (isZipPath(path)) {
      try {
        const scanned = await scanZipImport(path);
        zipExtractDirs.push(scanned.extractDir);
        audioPaths.push(...scanned.audioPaths);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${path}: ${message}`);
      }
    } else {
      try {
        const scanned = await scanFolder(path);
        audioPaths.push(...scanned);
      } catch {
        if (isSupportedAudioPath(path)) {
          audioPaths.push(path);
        }
      }
    }
    onProgress?.(i + 1, total);
    await yieldForInteraction();
  }

  return { audioPaths, zipExtractDirs };
}

/** Drop always-on-top so a modal file panel isn't covered by the skin. */
async function withSkinAlwaysOnTopSuspended<T>(
  run: () => Promise<T>,
): Promise<T> {
  if (!isTauri()) return run();

  const restore: WebviewWindow[] = [];
  try {
    const windows = await WebviewWindow.getAll();
    for (const window of windows) {
      if (
        window.label !== "skin-mode" &&
        !window.label.startsWith(SKIN_AUX_LABEL_PREFIX)
      ) {
        continue;
      }
      try {
        if (await window.isAlwaysOnTop()) {
          await window.setAlwaysOnTop(false);
          restore.push(window);
        }
      } catch {
        /* window gone */
      }
    }
  } catch {
    /* getAll failed — still try the picker */
  }

  try {
    return await run();
  } finally {
    await Promise.all(
      restore.map((window) =>
        window.setAlwaysOnTop(true).catch(() => undefined),
      ),
    );
  }
}

export async function pickAndImportLibraryPaths(): Promise<void> {
  try {
    const paths = await withSkinAlwaysOnTopSuspended(() => pickLibraryPaths());
    if (paths.length === 0) return;
    usePlayerStore.getState().importFromPaths(paths);
  } catch (err) {
    reportUnexpectedError({
      kind: "importPicker",
      err,
    });
  }
}

export function startLibraryImport(paths: string[]): void {
  const pathsToImport = filterPathsForLibraryImport(paths);
  if (pathsToImport.length === 0) return;

  resetImportActivationQueue();
  useImportDedupeStore.getState().resetImportDedupeSession();

  useBackgroundTasksStore.getState().runInBackground({
    key: "library-import",
    label: t("toasts:import.library"),
    cancellable: true,
    progressDisplay: "bar",
    run: async (ctx) => {
      let zipExtractDirs: string[] = [];
      let outcomeLogged = false;
      const cleanupZips = async () => {
        for (const extractDir of zipExtractDirs) {
          await cleanupZipImport(extractDir).catch(() => undefined);
        }
      };
      const logImportCancelled = () => {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.library,
          message: "Library import cancelled",
        });
      };
      const clearImportingTracks = () => {
        usePlayerStore.setState((state) => ({
          library: state.library.filter((track) => !isTrackImporting(track)),
        }));
      };

      try {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.library,
          message: "Starting library import",
          details: {
            pathCount: pathsToImport.length,
            paths: pathsToImport,
          },
        });

        ctx.setLabel(t("toasts:import.scanning"));
        const resolved = await resolveImportPaths(
          pathsToImport,
          (current, total) => {
            ctx.setProgress(current, total);
          },
          () => ctx.isCancelRequested(),
        );
        zipExtractDirs = resolved.zipExtractDirs;
        const audioPaths = resolved.audioPaths;

        if (audioPaths.length === 0) {
          logActivity({
            level: "warn",
            domain: ACTIVITY_LOG_DOMAINS.library,
            message: "Library import found no audio files",
            details: { paths: pathsToImport },
          });
          ctx.settleAs(importNoAudioSettleOptions());
          return;
        }

        const settingsStore = useLibrarySettingsStore.getState();
        if (!settingsStore.settings) {
          await settingsStore.loadSettings();
        }
        let importMode: "copy" | "reference";
        try {
          importMode = await settingsStore.resolveImportMode();
        } catch {
          ctx.setDetail(t("toasts:import.cancelled"));
          logImportCancelled();
          return;
        }

        if (zipExtractDirs.length > 0 && importMode === "reference") {
          importMode = "copy";
        }

        await waitForPaint();
        await yieldToMain();

        if (ctx.isCancelRequested()) {
          logImportCancelled();
          throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"));
        }

        ctx.clearProgress();
        ctx.setLabel(
          t("toasts:import.readingMetadata", { count: audioPaths.length }),
        );

        const player = usePlayerStore.getState();
        const { entries, errors: metadataErrors } = await parseImportMetadata(
          audioPaths,
          (current, total) => ctx.setProgress(current, total),
          () => ctx.isCancelRequested(),
        );

        if (entries.length === 0) {
          throw new Error(
            metadataErrors[0] ?? t("toasts:import.metadataUnread"),
          );
        }

        const pendingTracks = entries.map((entry) =>
          pendingTrackFromInput(
            entry.pendingId,
            entry.sourcePath,
            entry.metadata,
          ),
        );
        player.stagePendingImportTracks(pendingTracks);

        ctx.clearProgress();
        ctx.setLabel(t("toasts:import.importing", { count: entries.length }));

        let result;
        const removePending = (pendingId: number) => {
          queuePendingImportRemoval(pendingId);
        };

        try {
          result = await commitImportEntries(entries, {
            mode: importMode,
            onProgress: (current, total) => ctx.setProgress(current, total),
            isCancelRequested: () => ctx.isCancelRequested(),
            onTrackActivated: (pendingId, track) => {
              queueImportedTrackActivation(pendingId, track);
            },
            onTrackFailed: removePending,
            onTrackSkipped: removePending,
            onTrackReplaced: (pendingId, track) => {
              removePending(pendingId);
              usePlayerStore.getState().updateTrackInLibrary(track);
            },
          });
        } catch (err) {
          flushImportActivationQueue();
          if (isImportCancelledError(err)) {
            clearImportingTracks();
            ctx.setLabel(t("toasts:import.cancelled"));
            logImportCancelled();
            return;
          }
          if (err instanceof BackgroundTaskCancelledError) {
            clearImportingTracks();
            logImportCancelled();
          }
          throw err;
        }

        flushImportActivationQueue();

        result.errors.unshift(...metadataErrors);
        result.failed += metadataErrors.length;

        // Re-hydrate absolute Artwork display paths after import/replace.
        if (result.imported > 0 || result.replaced > 0) {
          await usePlayerStore
            .getState()
            .loadLibrary({ preservePlayback: true });
        }

        const settle = importCompletionSettleOptions(result);

        logActivity({
          level: result.failed > 0 ? "warn" : "info",
          domain: ACTIVITY_LOG_DOMAINS.library,
          message: "Library import completed",
          details: {
            importMode,
            imported: result.imported,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
            lyricsFromTags: result.lyricsFromTags,
            lyricsFromSidecar: result.lyricsFromSidecar,
            lyricsNone: result.lyricsNone,
            ...(result.errors.length > 0 ? { errors: result.errors } : {}),
          },
        });
        outcomeLogged = true;

        ctx.settleAs(settle);
      } catch (err) {
        if (
          !(err instanceof BackgroundTaskCancelledError) &&
          !isImportCancelledError(err) &&
          !outcomeLogged
        ) {
          const message = err instanceof Error ? err.message : String(err);
          logActivity({
            level: "error",
            domain: ACTIVITY_LOG_DOMAINS.library,
            message: "Library import failed",
            details: { error: message },
          });
        }
        throw err;
      } finally {
        await cleanupZips();
      }
    },
  });
}
