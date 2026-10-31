import type { Track } from "../types/track";
import { fileExists } from "./artPath";
import { formatDateAdded } from "./format";
import { t } from "./i18n";

/** Missing when the library marked it so on a scan, or playback couldn't find it. */
export function isTrackMissingFile(track: Track): boolean {
  return track.missingFile === true || track.missingSince != null;
}

/** Tooltip for a missing track: since when, when a scan recorded it. */
export function missingFileLabel(track: Pick<Track, "missingSince">): string {
  return track.missingSince
    ? t("library:sources.missingSince", {
        date: formatDateAdded(track.missingSince),
      })
    : t("library:sources.missingNow");
}

export function isMissingFileError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cannot stat file|enoent|not found|no such file|file not found/i.test(
    message,
  );
}

export function missingFileErrorDetail(track: Pick<Track, "title">): string {
  return t("library:editor.fileNotFound", { title: track.title });
}

export function isMissingFileErrorDetail(detail: string): boolean {
  return detail.endsWith(`: ${t("library:editor.fileNotFoundSuffix")}`);
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

/**
 * Keep client-only missing-file flags when the library is reloaded from disk,
 * unless a scan has since found the file again.
 */
export function mergeLibraryClientState(
  previous: Track[],
  loaded: Track[],
): Track[] {
  const priorById = new Map(previous.map((track) => [track.id, track]));
  return loaded.map((track) => {
    const prior = priorById.get(track.id);
    const restoredByScan = prior?.missingSince != null && !track.missingSince;
    if (
      prior?.missingFile &&
      prior.filePath === track.filePath &&
      !restoredByScan
    ) {
      return { ...track, missingFile: true };
    }
    return track;
  });
}
