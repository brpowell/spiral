import { commitImportEntries, parseImportMetadata } from "./import";
import {
  flushImportActivationQueue,
  queueImportedTrackActivation,
  queuePendingImportRemoval,
  resetImportActivationQueue,
} from "./importActivationQueue";
import { isTrackImporting, pendingTrackFromInput } from "./pendingImportTrack";
import {
  filterPathsForLibraryImport,
  isSupportedAudioPath,
} from "./supportedAudio";
import { waitForPaint, yieldForInteraction, yieldToMain } from "./scheduling";
import { scanFolder } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import {
  isImportCancelledError,
  useImportDedupeStore,
} from "../store/useImportDedupeStore";
import { useLibrarySettingsStore } from "../store/useLibrarySettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

async function resolveImportPaths(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  const resolved: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      const scanned = await scanFolder(path);
      resolved.push(...scanned);
    } catch {
      if (isSupportedAudioPath(path)) {
        resolved.push(path);
      }
    }
    onProgress?.(i + 1, total);
    await yieldForInteraction();
  }

  return resolved;
}

function formatImportSummary(result: {
  imported: number;
  skipped: number;
  replaced: number;
}): string {
  const parts: string[] = [];
  if (result.imported > 0) {
    parts.push(
      result.imported === 1
        ? "Imported 1 track"
        : `Imported ${result.imported} tracks`,
    );
  }
  if (result.replaced > 0) {
    parts.push(
      result.replaced === 1
        ? "Replaced 1 track"
        : `Replaced ${result.replaced} tracks`,
    );
  }
  if (result.skipped > 0) {
    parts.push(
      result.skipped === 1
        ? "Skipped 1 duplicate"
        : `Skipped ${result.skipped} duplicates`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : "Import finished";
}

export function startLibraryImport(paths: string[]): void {
  const pathsToImport = filterPathsForLibraryImport(paths);
  if (pathsToImport.length === 0) return;

  usePlayerStore.setState({ importError: null });
  resetImportActivationQueue();
  useImportDedupeStore.getState().resetImportDedupeSession();

  useBackgroundTasksStore.getState().runInBackground({
    key: "library-import",
    label: "Importing library…",
    run: async (ctx) => {
      ctx.setLabel("Scanning files…");
      const audioPaths = await resolveImportPaths(
        pathsToImport,
        (current, total) => {
          ctx.setProgress(current, total);
        },
      );

      if (audioPaths.length === 0) {
        ctx.setDetail("No audio files found");
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
        return;
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
          return;
        }
        throw err;
      }

      flushImportActivationQueue();

      result.errors.unshift(...metadataErrors);
      result.failed += metadataErrors.length;

      ctx.setLabel(formatImportSummary(result));

      if (result.failed > 0) {
        usePlayerStore.setState({
          importError: `${formatImportSummary(result)}; failed ${result.failed}. ${result.errors[0] ?? ""}`,
        });
        if (result.imported === 0 && result.replaced === 0) {
          throw new Error(result.errors[0] ?? "Import failed");
        }
      }
    },
  });
}
