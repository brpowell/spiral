/** MusicBrainz UUID helpers (matches `src-tauri/src/mbid.rs`). */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Trim + lowercase. Empty → null. */
export function normalizeMbid(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

/** Hyphenated lowercase UUID, or null if invalid/empty. */
export function parseUuidMbid(value: string | null | undefined): string | null {
  const normalized = normalizeMbid(value);
  if (normalized == null) return null;
  return UUID_RE.test(normalized) ? normalized : null;
}

export function isValidUuidMbid(value: string | null | undefined): boolean {
  return parseUuidMbid(value) != null;
}
