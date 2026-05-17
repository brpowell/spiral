import { parseTrackMetadata } from "./metadata";
import { yieldToMain } from "./scheduling";
import { prepareImportFile, saveTrack } from "./tauri";
import type { LibrarySettings } from "../types/library";

export interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

export interface ImportPathsOptions {
  onProgress?: (current: number, total: number) => void;
  mode: "copy" | "reference";
  settings: LibrarySettings;
}

export async function importPaths(
  paths: string[],
  options: ImportPathsOptions,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, failed: 0, errors: [] };
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      const finalPath = await prepareImportFile(
        path,
        options.mode,
        options.settings.autoOrganize,
        options.settings.mediaFolder,
      );
      const track = await parseTrackMetadata(finalPath);
      await saveTrack(track);
      result.imported += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${path}: ${message}`);
      console.error(`Failed to import ${path}:`, err);
    }

    options.onProgress?.(i + 1, total);
    await yieldToMain();
  }

  return result;
}
