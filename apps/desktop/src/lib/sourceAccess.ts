import type { Source } from "../types/source";
import type { Track } from "../types/track";
import { t } from "./i18n";

/** Built-in source rows; folders the user adds get ids from 3 up. */
export const DEFAULT_SOURCE_ID = 1;
export const OTHER_SOURCE_ID = 2;

/** The default source (the Spiral folder's tracks), a folder the user added, or Other. */
export type SourceRole = "default" | "user" | "other";

export function sourceRole(source: Pick<Source, "id">): SourceRole {
  if (source.id === DEFAULT_SOURCE_ID) return "default";
  if (source.id === OTHER_SOURCE_ID) return "other";
  return "user";
}

/**
 * Whether removing the track may also delete its file. Every source's files
 * can be deleted except Other's loose files, which stay on disk. Tracks still
 * importing have no source yet and land in a source folder.
 */
export function canDeleteFromDisk(track: Pick<Track, "sourceId">): boolean {
  return track.sourceId !== OTHER_SOURCE_ID;
}

/** Error prefixes the source commands return. */
const SOURCE_ERROR_KEYS = {
  source_not_folder: "library:sources.errors.notFolder",
  source_inside_library: "library:sources.errors.insideLibrary",
  source_overlap: "library:sources.errors.overlap",
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

/** Display name for a source: "Tracks" and "Other files" for the built-ins, else the stored name. */
export function sourceDisplayName(source: Pick<Source, "id" | "name">): string {
  const role = sourceRole(source);
  if (role === "default") return t("library:sources.defaultName");
  if (role === "other") return t("library:sources.otherName");
  return source.name;
}

/** Sort rank for the source column: the default source, then added folders, then Other. */
export function sourceSortRank(sourceId: number | undefined): number {
  if (sourceId == null || sourceId === DEFAULT_SOURCE_ID) return 0;
  if (sourceId === OTHER_SOURCE_ID) return Number.MAX_SAFE_INTEGER;
  return sourceId;
}
