export const DEFAULT_ARTIST_JOIN_DELIMITER = "; ";

/** Names that must not be split on semicolon even if present. */
export function shouldSkipSemicolonSplit(_raw: string): boolean {
  return false;
}

export function normalizeArtistName(name: string): string {
  return name.trim().replace(/\s+/g, " ").normalize("NFC");
}

export function parseArtistField(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  if (shouldSkipSemicolonSplit(trimmed)) {
    const name = normalizeArtistName(trimmed);
    return name ? [name] : [];
  }
  return trimmed
    .split(/\s*;\s*/)
    .map(normalizeArtistName)
    .filter(Boolean);
}

export function serializeArtistField(
  names: string[],
  delimiter: string = DEFAULT_ARTIST_JOIN_DELIMITER,
): string | null {
  const normalized = names.map(normalizeArtistName).filter(Boolean);
  if (normalized.length === 0) return null;
  return normalized.join(delimiter);
}

export function artistNamesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (normalizeArtistName(a[i]) !== normalizeArtistName(b[i])) return false;
  }
  return true;
}
