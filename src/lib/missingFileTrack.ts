import type { Track } from "../types/track";
import { fileExists } from "./artPath";

export function isTrackMissingFile(track: Track): boolean {
  return track.missingFile === true;
}

export function isMissingFileError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cannot stat file|enoent|not found|no such file|file not found/i.test(
    message,
  );
}

export function missingFileErrorDetail(track: Pick<Track, "title">): string {
  return `${track.title}: File not found`;
}

export function isMissingFileErrorDetail(detail: string): boolean {
  return detail.endsWith(": File not found");
}

/** Resolve whether a track file exists, flagging the library row when it does not. */
export async function discoverTrackFileMissing(
  track: Track,
  onMissing?: (track: Track) => void,
): Promise<boolean> {
  if (isTrackMissingFile(track)) return true;
  const missing = !(await fileExists(track.filePath));
  if (missing) {
    onMissing?.(withTrackMissingFile(track, true));
  }
  return missing;
}

/** True when an import duplicate should restore the library row without prompting. */
export async function shouldAutoReplaceMissingDuplicate(
  track: Track,
): Promise<boolean> {
  return discoverTrackFileMissing(track);
}

export function withTrackMissingFile(track: Track, missing: boolean): Track {
  if (missing) {
    if (track.missingFile) return track;
    return { ...track, missingFile: true };
  }
  if (!track.missingFile) return track;
  const { missingFile: _removed, ...rest } = track;
  return rest;
}

/** Keep client-only missing-file flags when the library is reloaded from disk. */
export function mergeLibraryClientState(
  previous: Track[],
  loaded: Track[],
): Track[] {
  const priorById = new Map(previous.map((track) => [track.id, track]));
  return loaded.map((track) => {
    const prior = priorById.get(track.id);
    if (
      prior?.missingFile &&
      prior.filePath === track.filePath
    ) {
      return { ...track, missingFile: true };
    }
    return track;
  });
}
