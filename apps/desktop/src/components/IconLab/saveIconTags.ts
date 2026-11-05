import { setLibraryIconTags } from "../../lib/iconLibrary";
import { normalizeIconTags } from "../../lib/iconLibrary/iconTagTable";

/** Dev server route that writes `iconTags.json` (see vite.config.ts). */
export const ICON_TAGS_ENDPOINT = "/__icon-lab/tags";

export type SaveIconTagsResult = { ok: true } | { ok: false; error: string };

/**
 * Apply tags in memory right away (so the grid and the picker update), then
 * persist them to `iconTags.json` through the dev server.
 */
export async function saveIconTags(
  id: string,
  tags: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<SaveIconTagsResult> {
  const normalized = normalizeIconTags(tags);
  if (!setLibraryIconTags(id, normalized)) {
    return { ok: false, error: `Unknown icon "${id}"` };
  }
  try {
    const response = await fetchImpl(ICON_TAGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tags: normalized }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, error: body?.error ?? response.statusText };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
