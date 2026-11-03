import type { Source } from "../types/source";
import type { Track } from "../types/track";
import { t } from "./i18n";

/**
 * Other: the built-in bucket for loose files, which has no folder. It isn't a
 * source the user chose, so it is never listed or counted among them. Every
 * other row is a folder the user chose (`Tracks` included).
 */
export const OTHER_SOURCE_ID = 2;

export function isOtherSource(source: Pick<Source, "id">): boolean {
  return source.id === OTHER_SOURCE_ID;
}

/**
 * Whether removing the track may also delete its file. Every source's files
 * can be deleted except Other's loose files, which stay on disk, and a
 * missing track's: its path may now name another track's file. Tracks still
 * importing have no source yet and land in a source folder.
 */
export function canDeleteFromDisk(
  track: Pick<Track, "sourceId" | "missingSince">,
): boolean {
  return track.sourceId !== OTHER_SOURCE_ID && !track.missingSince;
}

/** Error prefixes the source, import, replace and convert commands return. */
const SOURCE_ERROR_KEYS = {
  source_not_folder: "library:sources.errors.notFolder",
  source_spiral_data: "library:sources.errors.spiralData",
  source_overlap: "library:sources.errors.overlap",
  no_source: "library:sources.errors.noSource",
  source_unavailable: "library:sources.errors.unavailable",
} as const;

export type SourceErrorCode = keyof typeof SOURCE_ERROR_KEYS;

function rawMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The code a backend error starts with, e.g. `source_overlap: …`. */
export function sourceErrorCode(err: unknown): SourceErrorCode | null {
  const message = rawMessage(err);
  for (const code of Object.keys(SOURCE_ERROR_KEYS) as SourceErrorCode[]) {
    if (message.startsWith(code)) return code;
  }
  return null;
}

/** A readable, localized message for coded source errors; others pass through. */
export function describeSourceError(err: unknown): string {
  const code = sourceErrorCode(err);
  return code ? t(SOURCE_ERROR_KEYS[code]) : rawMessage(err);
}

/** Track and missing counts per source id. */
export function countTracksBySource(
  tracks: Pick<Track, "sourceId" | "missingSince">[],
): Map<number, { total: number; missing: number }> {
  const counts = new Map<number, { total: number; missing: number }>();
  for (const track of tracks) {
    if (track.sourceId == null) continue;
    const entry = counts.get(track.sourceId) ?? { total: 0, missing: 0 };
    entry.total += 1;
    if (track.missingSince) entry.missing += 1;
    counts.set(track.sourceId, entry);
  }
  return counts;
}

/** Display name for a source: "Other files" for Other, else the stored name. */
export function sourceDisplayName(source: Pick<Source, "id" | "name">): string {
  return isOtherSource(source) ? t("library:sources.otherName") : source.name;
}

/** Sort rank for the source column: folders in the order added, then Other. */
export function sourceSortRank(sourceId: number | undefined): number {
  if (sourceId == null) return 0;
  if (sourceId === OTHER_SOURCE_ID) return Number.MAX_SAFE_INTEGER;
  return sourceId;
}
