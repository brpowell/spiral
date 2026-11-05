/**
 * Pure helpers for the icon tag table (`iconTags.json`), shared by the
 * registry, the Icon Lab and the dev server endpoint that persists edits.
 */

/** Icon id → tags. Ids missing from the table have no tags. */
export type IconTagTable = Record<string, string[]>;

export type IconTagUpdate = { id: string; tags: string[] };

const ICON_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Lowercase, trimmed, inner whitespace collapsed to `-`. Empty when blank. */
export function normalizeIconTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Normalize each tag, drop blanks and duplicates, keep first-seen order. */
export function normalizeIconTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of raw) {
    const tag = normalizeIconTag(entry);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function isValidIconId(id: unknown): id is string {
  return typeof id === "string" && ICON_ID_PATTERN.test(id);
}

/** Validate an untrusted `{ id, tags }` payload; null when malformed. */
export function parseIconTagUpdate(body: unknown): IconTagUpdate | null {
  if (typeof body !== "object" || body === null) return null;
  const { id, tags } = body as { id?: unknown; tags?: unknown };
  if (!isValidIconId(id)) return null;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    return null;
  }
  return { id, tags: normalizeIconTags(tags) };
}

/**
 * Apply an update to a table. An empty tag list keeps the id with `[]` so the
 * file still records that the icon was reviewed. Result is sorted by id.
 */
export function applyIconTagUpdate(
  table: Readonly<IconTagTable>,
  update: IconTagUpdate,
): IconTagTable {
  const next: IconTagTable = { ...table, [update.id]: update.tags };
  return Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Tags in use with how many icons carry each, most-used first. */
export function countIconTags(
  icons: readonly { tags: readonly string[] }[],
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const icon of icons) {
    for (const tag of icon.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
