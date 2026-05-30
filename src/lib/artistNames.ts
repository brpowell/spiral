export const DEFAULT_ARTIST_JOIN_DELIMITER = " / ";

const STRUCTURAL_SPLITS: Array<{ pattern: RegExp; split: (s: string) => string[] }> = [
  { pattern: /\s+\/\s+/, split: (s) => s.split(/\s+\/\s+/) },
  { pattern: /\//, split: (s) => s.split(/\//) },
  { pattern: /;/, split: (s) => s.split(/\s*;\s*/) },
  { pattern: /,/, split: (s) => s.split(/\s*,\s*/) },
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function splitOnAmpersand(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const segments = part.split(/\s+&\s+/);
    if (segments.length <= 1) {
      out.push(part);
      continue;
    }
    let buffer = segments[0] ?? "";
    for (let i = 1; i < segments.length; i++) {
      const left = buffer.trim();
      const right = (segments[i] ?? "").trim();
      if (wordCount(left) >= 2 && wordCount(right) >= 2) {
        if (left) out.push(left);
        buffer = right;
      } else {
        buffer = `${buffer} & ${right}`;
      }
    }
    const tail = buffer.trim();
    if (tail) out.push(tail);
  }
  return out;
}

function splitStructural(parts: string[]): string[] {
  let current = parts;
  for (const { pattern, split } of STRUCTURAL_SPLITS) {
    const next: string[] = [];
    for (const part of current) {
      if (pattern.test(part)) {
        next.push(...split(part).map((s) => s.trim()).filter(Boolean));
      } else {
        const trimmed = part.trim();
        if (trimmed) next.push(trimmed);
      }
    }
    current = next;
  }
  return current;
}

export function normalizeArtistName(name: string): string {
  return name.trim().replace(/\s+/g, " ").normalize("NFC");
}

export function parseArtistField(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  let parts = [trimmed];
  parts = splitStructural(parts);
  parts = splitOnAmpersand(parts);

  return parts.map(normalizeArtistName).filter(Boolean);
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

export function normalizeArtistFieldFromTagValue(
  value: string | string[] | undefined,
  delimiter: string = DEFAULT_ARTIST_JOIN_DELIMITER,
): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const names = value.map(normalizeArtistName).filter(Boolean);
    return names.length > 0 ? names.join(delimiter) : null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
