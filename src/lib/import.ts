import { parseTrackMetadata } from "./metadata";
import { allocPendingTrackId, resetPendingTrackIds } from "./pendingImportTrack";
import { yieldForInteraction } from "./scheduling";
import { prepareImportFile, saveTrack } from "./tauri";
import type { Track, TrackInput } from "../types/track";

export interface ImportResult {
  imported: number;
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

export async function commitImportEntries(
  entries: ParsedImportEntry[],
  options: CommitImportOptions,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: 0, errors: [] };
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    const { sourcePath, metadata, pendingId } = entries[i];
    try {
      const finalPath = await prepareImportFile(sourcePath, options.mode);
      const saved = await saveTrack({ ...metadata, filePath: finalPath });
      options.onTrackActivated?.(pendingId, saved);
      result.imported += 1;
    } catch (err) {
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
