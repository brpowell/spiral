import { parseTrackMetadata } from "./metadata";
import { allocPendingTrackId, resetPendingTrackIds } from "./pendingImportTrack";
import { yieldForInteraction } from "./scheduling";
import {
  findLibraryDuplicate,
  countRemainingBatchDuplicates,
  type ImportDedupeAction,
  type ImportDuplicateContext,
} from "./trackDedupe";
import { prepareImportFile, replaceTrackFromImport, saveTrack } from "./tauri";
import { useImportDedupeStore, isImportCancelledError } from "../store/useImportDedupeStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, TrackInput } from "../types/track";

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
  /** Pre-resolved duplicate actions keyed by pending import id. */
  duplicateActions?: ReadonlyMap<number, ImportDedupeAction>;
  onTrackActivated?: (pendingId: number, track: Track) => void;
  onTrackFailed?: (pendingId: number) => void;
  onTrackSkipped?: (pendingId: number) => void;
  onTrackReplaced?: (pendingId: number, track: Track) => void;
}

export interface ResolveImportDuplicatesResult {
  duplicateActions: ReadonlyMap<number, ImportDedupeAction>;
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
): Promise<ImportDedupeAction> {
  const { batchRule, promptImportDedupe } = useImportDedupeStore.getState();
  if (batchRule != null) {
    return batchRule;
  }
  return promptImportDedupe(context);
}

function buildDuplicatePromptContext(
  entry: ParsedImportEntry,
  entries: ReadonlyArray<ParsedImportEntry>,
  index: number,
  library: Track[],
  existing: Track,
  incomingPendingRip?: boolean,
): ImportDuplicateContext {
  return {
    incoming: entry.metadata,
    existing,
    pendingId: entry.pendingId,
    sourcePath: entry.sourcePath,
    remainingDuplicates: countRemainingBatchDuplicates(
      entries,
      index,
      library,
    ),
    incomingPendingRip,
  };
}

export async function resolveImportDuplicates(
  entries: ParsedImportEntry[],
  options: ResolveImportDuplicatesOptions = {},
): Promise<ResolveImportDuplicatesResult> {
  const duplicateActions = new Map<number, ImportDedupeAction>();
  const skippedPendingIds = new Set<number>();
  const library = usePlayerStore.getState().library;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const existing = findLibraryDuplicate(entry.metadata, library, {
      excludeSourcePath: entry.sourcePath || undefined,
    });

    if (existing) {
      const action = await resolveDuplicateAction(
        buildDuplicatePromptContext(
          entry,
          entries,
          i,
          library,
          existing,
          options.incomingPendingRip,
        ),
      );

      duplicateActions.set(entry.pendingId, action);
      if (action === "skip") {
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
        const action =
          options.duplicateActions?.get(pendingId) ??
          (await resolveDuplicateAction(
            buildDuplicatePromptContext(entries[i], entries, i, library, existing),
          ));

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
