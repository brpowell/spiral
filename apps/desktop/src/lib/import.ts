import { parseTrackMetadata } from "./metadata";
import {
  allocPendingTrackId,
  resetPendingTrackIds,
} from "./pendingImportTrack";
import { yieldForInteraction } from "./scheduling";
import { t } from "./i18n";
import {
  findLibraryDuplicate,
  findTrackAtSourcePath,
  countRemainingBatchDuplicates,
  type ImportDedupeResolution,
  type ImportDuplicateContext,
} from "./trackDedupe";
import {
  getTrackLyrics,
  prepareImportFile,
  replaceTrackFromImport,
  saveTrack,
} from "./tauri";
import { shouldAutoReplaceMissingDuplicate } from "./missingFileTrack";
import { importLyricsConflict, trackLyricsToInput } from "./lyrics";
import {
  applyBatchRule,
  useImportDedupeStore,
  isImportCancelledError,
} from "../store/useImportDedupeStore";
import type { BackgroundTaskSettleAsOptions } from "../store/useBackgroundTasksStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, TrackInput } from "../types/track";
import { BackgroundTaskCancelledError } from "./backgroundTaskCancel";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";

export interface ImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  failed: number;
  errors: string[];
  lyricsFromTags: number;
  lyricsFromSidecar: number;
  lyricsNone: number;
}

export interface ParsedImportEntry {
  sourcePath: string;
  metadata: TrackInput;
  pendingId: number;
}

export interface CommitImportOptions {
  onProgress?: (current: number, total: number) => void;
  mode: "copy" | "reference";
  /** Copies go into this source; the import source when unset. */
  destinationSourceId?: number | null;
  /** Pre-resolved duplicate actions keyed by pending import id. */
  duplicateActions?: ReadonlyMap<number, ImportDedupeResolution>;
  onTrackActivated?: (pendingId: number, track: Track) => void;
  onTrackFailed?: (pendingId: number) => void;
  onTrackSkipped?: (pendingId: number) => void;
  onTrackReplaced?: (pendingId: number, track: Track) => void;
  /** When set, throw BackgroundTaskCancelledError if cancel is requested mid-loop. */
  isCancelRequested?: () => boolean;
}

export interface ResolveImportDuplicatesResult {
  duplicateActions: ReadonlyMap<number, ImportDedupeResolution>;
  skippedPendingIds: ReadonlySet<number>;
}

export interface ResolveImportDuplicatesOptions {
  incomingPendingRip?: boolean;
}

export interface ParseImportMetadataResult {
  entries: ParsedImportEntry[];
  errors: string[];
}

export async function parseImportMetadata(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
  isCancelRequested?: () => boolean,
): Promise<ParseImportMetadataResult> {
  resetPendingTrackIds();
  const entries: ParsedImportEntry[] = [];
  const errors: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
    if (isCancelRequested?.()) {
      throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"));
    }
    const sourcePath = paths[i];
    try {
      const metadata = await parseTrackMetadata(sourcePath);
      entries.push({
        sourcePath,
        metadata,
        pendingId: allocPendingTrackId(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${sourcePath}: ${message}`);
      console.error(`Failed to read metadata for ${sourcePath}:`, err);
    }

    onProgress?.(i + 1, total);
    await yieldForInteraction();
  }

  return { entries, errors };
}

async function detectImportLyricsConflict(
  incoming: TrackInput,
  existing: Track,
): Promise<boolean> {
  if (!incoming.lyrics?.plainText.trim()) {
    return false;
  }
  if (existing.lyricsFormat == null) {
    return false;
  }
  const existingLyrics = await getTrackLyrics(existing.id);
  if (!existingLyrics) {
    return false;
  }
  return importLyricsConflict(
    incoming.lyrics,
    trackLyricsToInput(existingLyrics),
  );
}

async function resolveDuplicateAction(
  context: ImportDuplicateContext,
): Promise<ImportDedupeResolution> {
  if (await shouldAutoReplaceMissingDuplicate(context.existing)) {
    return { action: "replace" };
  }

  const { batchRule, promptImportDedupe } = useImportDedupeStore.getState();
  if (batchRule != null) {
    return applyBatchRule(batchRule, context);
  }
  return promptImportDedupe(context);
}

async function buildDuplicatePromptContext(
  entry: ParsedImportEntry,
  entries: ReadonlyArray<ParsedImportEntry>,
  index: number,
  library: Track[],
  existing: Track,
  incomingPendingRip?: boolean,
): Promise<ImportDuplicateContext> {
  return {
    incoming: entry.metadata,
    existing,
    pendingId: entry.pendingId,
    sourcePath: entry.sourcePath,
    remainingDuplicates: countRemainingBatchDuplicates(entries, index, library),
    incomingPendingRip,
    hasLyricsConflict: await detectImportLyricsConflict(
      entry.metadata,
      existing,
    ),
  };
}

function trackForReplace(
  metadata: TrackInput,
  resolution: ImportDedupeResolution,
): TrackInput {
  if (resolution.replaceLyrics === false) {
    return { ...metadata, lyrics: null };
  }
  return metadata;
}

function tallyPersistedImportLyrics(
  result: ImportResult,
  lyrics: TrackInput["lyrics"] | null | undefined,
): void {
  const plain = lyrics?.plainText?.trim();
  if (!plain) {
    result.lyricsNone += 1;
    return;
  }
  if (lyrics?.source === "sidecar") {
    result.lyricsFromSidecar += 1;
    return;
  }
  if (lyrics?.source === "embedded") {
    result.lyricsFromTags += 1;
    return;
  }
  result.lyricsNone += 1;
}

export async function resolveImportDuplicates(
  entries: ParsedImportEntry[],
  options: ResolveImportDuplicatesOptions = {},
): Promise<ResolveImportDuplicatesResult> {
  const duplicateActions = new Map<number, ImportDedupeResolution>();
  const skippedPendingIds = new Set<number>();
  const library = usePlayerStore.getState().library;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (findTrackAtSourcePath(entry.sourcePath, library)) {
      duplicateActions.set(entry.pendingId, { action: "skip" });
      skippedPendingIds.add(entry.pendingId);
      await yieldForInteraction();
      continue;
    }

    const existing = findLibraryDuplicate(entry.metadata, library);

    if (existing) {
      const resolution = await resolveDuplicateAction(
        await buildDuplicatePromptContext(
          entry,
          entries,
          i,
          library,
          existing,
          options.incomingPendingRip,
        ),
      );

      duplicateActions.set(entry.pendingId, resolution);
      if (resolution.action === "skip") {
        skippedPendingIds.add(entry.pendingId);
      }
    }

    await yieldForInteraction();
  }

  return { duplicateActions, skippedPendingIds };
}

export function formatImportSummary(result: {
  imported: number;
  skipped: number;
  replaced: number;
  failed?: number;
}): string {
  return formatPeerOutcomeTitle(
    [
      ...(result.imported > 0
        ? [
            {
              text: t("toasts:import.imported", { count: result.imported }),
              anchored: true,
            },
          ]
        : []),
      ...(result.replaced > 0
        ? [
            {
              text: t("toasts:import.replaced", { count: result.replaced }),
              anchored: true,
            },
          ]
        : []),
      ...(result.skipped > 0
        ? [
            {
              text: t("toasts:import.skippedDuplicate", {
                count: result.skipped,
              }),
              anchored: true,
            },
          ]
        : []),
      ...((result.failed ?? 0) > 0
        ? [
            {
              text: t("toasts:import.failedCount", { count: result.failed }),
            },
          ]
        : []),
    ],
    {
      operation: t("toasts:import.operation"),
      fallback: t("toasts:import.finished"),
    },
  );
}

/** Warning settle when a library import finds no audio files. */
export function importNoAudioSettleOptions(): BackgroundTaskSettleAsOptions & {
  label: string;
} {
  return {
    status: "warning",
    label: t("toasts:import.noAudio"),
  };
}

/**
 * Import completion toast: flat peer title (including failed).
 * View logs only for failures (1 known → inline; 2+ → link) — replace/skip
 * are success-side and stay out of the action slot.
 */
export function importCompletionSettleOptions(
  result: Pick<
    ImportResult,
    "imported" | "skipped" | "replaced" | "failed" | "errors"
  >,
): BackgroundTaskSettleAsOptions & { label: string } {
  const label = formatImportSummary(result);
  const hasWins = result.imported > 0 || result.replaced > 0;
  const status =
    result.failed === 0 ? "success" : hasWins ? "warning" : "error";

  if (result.failed === 0) {
    return { status, label };
  }

  if (result.failed === 1) {
    return {
      status,
      label,
      detail: result.errors[0] || t("toasts:import.failed"),
    };
  }

  return {
    status,
    label,
    logLink: true,
  };
}

export async function commitImportEntries(
  entries: ParsedImportEntry[],
  options: CommitImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    replaced: 0,
    failed: 0,
    errors: [],
    lyricsFromTags: 0,
    lyricsFromSidecar: 0,
    lyricsNone: 0,
  };
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    if (options.isCancelRequested?.()) {
      throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"));
    }
    const { sourcePath, metadata, pendingId } = entries[i];
    try {
      const library = usePlayerStore.getState().library;
      if (findTrackAtSourcePath(sourcePath, library)) {
        options.onTrackSkipped?.(pendingId);
        result.skipped += 1;
        options.onProgress?.(i + 1, total);
        await yieldForInteraction();
        continue;
      }

      const existing = findLibraryDuplicate(metadata, library);

      if (existing) {
        const resolution =
          options.duplicateActions?.get(pendingId) ??
          (await resolveDuplicateAction(
            await buildDuplicatePromptContext(
              entries[i],
              entries,
              i,
              library,
              existing,
            ),
          ));

        if (resolution.action === "skip") {
          options.onTrackSkipped?.(pendingId);
          result.skipped += 1;
          options.onProgress?.(i + 1, total);
          await yieldForInteraction();
          continue;
        }

        if (resolution.action === "replace") {
          const track = trackForReplace(metadata, resolution);
          const updated = await replaceTrackFromImport({
            trackId: existing.id,
            sourcePath,
            mode: options.mode,
            track,
          });
          options.onTrackReplaced?.(pendingId, updated);
          result.replaced += 1;
          // persist_import_lyrics only writes non-empty incoming; otherwise library lyrics stay.
          if (track.lyrics?.plainText.trim()) {
            tallyPersistedImportLyrics(result, track.lyrics);
          }
          options.onProgress?.(i + 1, total);
          await yieldForInteraction();
          continue;
        }
      }

      const finalPath = await prepareImportFile(
        sourcePath,
        options.mode,
        options.destinationSourceId,
      );
      const saved = await saveTrack({ ...metadata, filePath: finalPath });
      options.onTrackActivated?.(pendingId, saved);
      result.imported += 1;
      tallyPersistedImportLyrics(result, metadata.lyrics);
    } catch (err) {
      if (isImportCancelledError(err)) {
        throw err;
      }
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${sourcePath}: ${message}`);
      options.onTrackFailed?.(pendingId);
      console.error(`Failed to import ${sourcePath}:`, err);
    }

    options.onProgress?.(i + 1, total);
    await yieldForInteraction();
  }

  return result;
}
