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
 * What Spiral may do to a track's file, mirroring `track_permissions.rs`:
 * `writable` allows tag, art and lyrics writes; `managed` also allows moving,
 * replacing and deleting the file.
 */
export interface TrackAccess {
  writable: boolean;
  managed: boolean;
  /** The track's source, when the sources list has it. */
  source: Source | null;
}

/**
 * Tracks still being imported have no source yet and land in the library, so
 * they count as managed. Every source but Other is writable; only the default
 * source's files are Spiral's to move, replace or delete.
 */
export function trackAccess(
  track: Pick<Track, "sourceId">,
  sourcesById: ReadonlyMap<number, Source>,
): TrackAccess {
  const id = track.sourceId;
  if (id == null || id === DEFAULT_SOURCE_ID) {
    return {
      writable: true,
      managed: true,
      source: id == null ? null : (sourcesById.get(id) ?? null),
    };
  }
  const source = sourcesById.get(id) ?? null;
  return {
    writable: id !== OTHER_SOURCE_ID,
    managed: false,
    source,
  };
}

export function isTrackWritable(
  track: Pick<Track, "sourceId">,
  sourcesById: ReadonlyMap<number, Source>,
): boolean {
  return trackAccess(track, sourcesById).writable;
}

export function isTrackManaged(
  track: Pick<Track, "sourceId">,
  sourcesById: ReadonlyMap<number, Source>,
): boolean {
  return trackAccess(track, sourcesById).managed;
}

/**
 * One line on why a selection can't be edited, or null when every track can.
 * Only Other's loose files are read-only, so `watched` is always false; it
 * stays until the sources UI is reworked.
 */
export function readOnlyReason(
  tracks: Pick<Track, "sourceId">[],
  sourcesById: ReadonlyMap<number, Source>,
): { message: string; watched: boolean } | null {
  const blocked = tracks.filter(
    (track) => !trackAccess(track, sourcesById).writable,
  );
  if (blocked.length === 0) return null;
  return {
    watched: false,
    message: t(
      blocked.length < tracks.length
        ? "library:sources.readOnly.someExternal"
        : "library:sources.readOnly.external",
    ),
  };
}

/** Error prefixes the source commands and file guards return. */
const SOURCE_ERROR_KEYS = {
  source_read_only: "library:sources.errors.readOnly",
  source_not_folder: "library:sources.errors.notFolder",
  source_inside_library: "library:sources.errors.insideLibrary",
  source_overlap: "library:sources.errors.overlap",
} as const;

export type SourceErrorCode = keyof typeof SOURCE_ERROR_KEYS;

function rawMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The code a backend error starts with, e.g. `source_read_only: …`. */
export function sourceErrorCode(err: unknown): SourceErrorCode | null {
  const message = rawMessage(err);
  for (const code of Object.keys(SOURCE_ERROR_KEYS) as SourceErrorCode[]) {
    if (message.startsWith(code)) return code;
  }
  return null;
}

export function isSourceReadOnlyError(err: unknown): boolean {
  return sourceErrorCode(err) === "source_read_only";
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

/** Display name for a source: the localized managed/external names, or the folder's. */
export function sourceDisplayName(source: Source): string {
  const role = sourceRole(source);
  if (role === "default") return t("library:sources.managedName");
  if (role === "other") return t("library:sources.externalName");
  return source.name;
}

/** Sort rank for the source column: the library, then watched folders, then other files. */
export function sourceSortRank(sourceId: number | undefined): number {
  if (sourceId == null || sourceId === DEFAULT_SOURCE_ID) return 0;
  if (sourceId === OTHER_SOURCE_ID) return Number.MAX_SAFE_INTEGER;
  return sourceId;
}
