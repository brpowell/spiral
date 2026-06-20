import { parseTrackMetadata } from "./metadata";
import { allocPendingTrackId, resetPendingTrackIds } from "./pendingImportTrack";
import { yieldForInteraction } from "./scheduling";
import {
  findLibraryDuplicate,
  countRemainingBatchDuplicates,
  type ImportDuplicateContext,
} from "./trackDedupe";
import { prepareImportFile, replaceTrackFromImport, saveTrack } from "./tauri";
import { useImportDedupeStore, isImportCancelledError } from "../store/useImportDedupeStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";

export interface ImportResult {
  imported: number;
  skipped: number;
  replaced: number;
  failed: number;
  errors: string[];
}

export interface ParsedImportEntry {
  sourcePath: string;
  metadata: TrackInput;
  pendingId: number;
}

export interface CommitImportOptions {
  onProgress?: (current: number, total: number) => void;
  mode: "copy" | "reference";
  onTrackActivated?: (pendingId: number, track: Track) => void;
  onTrackFailed?: (pendingId: number) => void;
  onTrackSkipped?: (pendingId: number) => void;
  onTrackReplaced?: (pendingId: number, track: Track) => void;
}

export interface ParseImportMetadataResult {
  entries: ParsedImportEntry[];
  errors: string[];
}

export async function parseImportMetadata(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<ParseImportMetadataResult> {
  resetPendingTrackIds();
  const entries: ParsedImportEntry[] = [];
  const errors: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
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

async function resolveDuplicateAction(
  context: ImportDuplicateContext,
) {
  const { batchRule, promptImportDedupe } = useImportDedupeStore.getState();
  if (batchRule != null) {
    return batchRule;
  }
  return promptImportDedupe(context);
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
  };
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    const { sourcePath, metadata, pendingId } = entries[i];
    try {
      const library = usePlayerStore.getState().library;
      const existing = findLibraryDuplicate(metadata, library, {
        excludeSourcePath: sourcePath,
      });

      if (existing) {
        const remainingDuplicates = countRemainingBatchDuplicates(
          entries,
          i,
          library,
        );
        const action = await resolveDuplicateAction({
          incoming: metadata,
          existing,
          pendingId,
          sourcePath,
          remainingDuplicates,
        });

        if (action === "skip") {
          options.onTrackSkipped?.(pendingId);
          result.skipped += 1;
          options.onProgress?.(i + 1, total);
          await yieldForInteraction();
          continue;
        }

        if (action === "replace") {
          const updated = await replaceTrackFromImport({
            trackId: existing.id,
            sourcePath,
            mode: options.mode,
            track: metadata,
          });
          options.onTrackReplaced?.(pendingId, updated);
          result.replaced += 1;
          options.onProgress?.(i + 1, total);
          await yieldForInteraction();
          continue;
        }
      }

      const finalPath = await prepareImportFile(sourcePath, options.mode);
      const saved = await saveTrack({ ...metadata, filePath: finalPath });
      options.onTrackActivated?.(pendingId, saved);
      result.imported += 1;
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
