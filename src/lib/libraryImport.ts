import {
  commitImportEntries,
  formatImportLyricsDetail,
  formatImportSummary,
  parseImportMetadata,
} from "./import";
import {
  flushImportActivationQueue,
  queueImportedTrackActivation,
  queuePendingImportRemoval,
  resetImportActivationQueue,
} from "./importActivationQueue";
import { createOperationId, logActivity } from "./activityLog";
import { isTrackImporting, pendingTrackFromInput } from "./pendingImportTrack";
import {
  filterPathsForLibraryImport,
  isSupportedAudioPath,
  isZipPath,
} from "./supportedAudio";
import { waitForPaint, yieldForInteraction, yieldToMain } from "./scheduling";
import {
  cleanupZipImport,
  pickLibraryPaths,
  scanFolder,
  scanZipImport,
} from "./tauri";
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
): Promise<ResolvedImportPaths> {
  const audioPaths: string[] = [];
  const zipExtractDirs: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
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

export async function pickAndImportLibraryPaths(): Promise<void> {
  usePlayerStore.setState({ importError: null });

  try {
    const paths = await pickLibraryPaths();
    if (paths.length === 0) return;
    usePlayerStore.getState().importFromPaths(paths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    usePlayerStore.setState({ importError: `Import failed: ${message}` });
  }
}

export function startLibraryImport(paths: string[]): void {
  const pathsToImport = filterPathsForLibraryImport(paths);
  if (pathsToImport.length === 0) return;

  usePlayerStore.setState({ importError: null });
  resetImportActivationQueue();
  useImportDedupeStore.getState().resetImportDedupeSession();

  const operationId = createOperationId();

  useBackgroundTasksStore.getState().runInBackground({
    key: "library-import",
    label: "Importing library…",
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
          domain: ACTIVITY_LOG_DOMAINS.import,
          message: "Library import cancelled",
          operationId,
        });
      };

      try {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.import,
          message: "Starting library import",
          operationId,
          details: {
            pathCount: pathsToImport.length,
            paths: pathsToImport,
          },
        });

        ctx.setLabel("Scanning files…");
        const resolved = await resolveImportPaths(
          pathsToImport,
          (current, total) => {
            ctx.setProgress(current, total);
          },
        );
        zipExtractDirs = resolved.zipExtractDirs;
        const audioPaths = resolved.audioPaths;

        if (audioPaths.length === 0) {
          ctx.setDetail("No audio files found");
          logActivity({
            level: "warn",
            domain: ACTIVITY_LOG_DOMAINS.import,
            message: "Library import found no audio files",
            operationId,
            details: { paths: pathsToImport },
          });
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
          ctx.setDetail("Import cancelled");
          logImportCancelled();
          return;
        }

        if (zipExtractDirs.length > 0 && importMode === "reference") {
          importMode = "copy";
        }

        await waitForPaint();
        await yieldToMain();

        ctx.clearProgress();
        ctx.setLabel(
          audioPaths.length === 1
            ? "Reading metadata for 1 track…"
            : `Reading metadata for ${audioPaths.length} tracks…`,
        );

        const player = usePlayerStore.getState();
        const { entries, errors: metadataErrors } = await parseImportMetadata(
          audioPaths,
          (current, total) => ctx.setProgress(current, total),
        );

        if (entries.length === 0) {
          throw new Error(metadataErrors[0] ?? "Could not read track metadata");
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
        ctx.setLabel(
          entries.length === 1
            ? "Importing 1 track…"
            : `Importing ${entries.length} tracks…`,
        );

        let result;
        const removePending = (pendingId: number) => {
          queuePendingImportRemoval(pendingId);
        };

        try {
          result = await commitImportEntries(entries, {
            mode: importMode,
            onProgress: (current, total) => ctx.setProgress(current, total),
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
            usePlayerStore.setState((state) => ({
              library: state.library.filter((track) => !isTrackImporting(track)),
            }));
            ctx.setLabel("Import cancelled");
            logImportCancelled();
            return;
          }
          throw err;
        }

        flushImportActivationQueue();

        result.errors.unshift(...metadataErrors);
        result.failed += metadataErrors.length;

        const summary = formatImportSummary(result);
        ctx.setLabel(summary);
        const lyricsDetail = formatImportLyricsDetail(result);
        if (lyricsDetail) {
          ctx.setDetail(lyricsDetail);
        }

        logActivity({
          level: result.failed > 0 ? "warn" : "info",
          domain: ACTIVITY_LOG_DOMAINS.import,
          message: "Library import completed",
          operationId,
          details: {
            importMode,
            imported: result.imported,
            replaced: result.replaced,
            skipped: result.skipped,
            failed: result.failed,
            ...(result.errors.length > 0 ? { errors: result.errors } : {}),
          },
        });
        outcomeLogged = true;

        if (result.failed > 0) {
          usePlayerStore.setState({
            importError: `${summary}; failed ${result.failed}. ${result.errors[0] ?? ""}`,
          });
          if (result.imported === 0 && result.replaced === 0) {
            throw new Error(result.errors[0] ?? "Import failed");
          }
        }
      } catch (err) {
        if (!isImportCancelledError(err) && !outcomeLogged) {
          const message = err instanceof Error ? err.message : String(err);
          logActivity({
            level: "error",
            domain: ACTIVITY_LOG_DOMAINS.import,
            message: "Library import failed",
            operationId,
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
