/**
 * Where saving an edit rewrites tags in audio files. Each context remembers
 * "don't ask again" on its own: dismissing the warning for one kind of edit
 * must not silence it for another that touches files in a way the user may not
 * expect (e.g. an album edit writing every track on the album).
 */
export type TagWriteContext = "track" | "album" | "artist";

export const TAG_WRITE_CONTEXTS: readonly TagWriteContext[] = [
  "track",
  "album",
  "artist",
];

export type TagWriteDismissals = Record<TagWriteContext, boolean>;

const STORAGE_KEY = "spiral:tagWriteConfirmDismissed";

export function emptyTagWriteDismissals(): TagWriteDismissals {
  return { track: false, album: false, artist: false };
}

export function loadTagWriteDismissals(): TagWriteDismissals {
  const dismissals = emptyTagWriteDismissals();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return dismissals;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return dismissals;
    for (const context of TAG_WRITE_CONTEXTS) {
      dismissals[context] =
        (parsed as Record<string, unknown>)[context] === true;
    }
  } catch {
    /* ignore quota / private mode / corrupt value */
  }
  return dismissals;
}

export function saveTagWriteDismissals(dismissals: TagWriteDismissals): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissals));
  } catch {
    /* ignore */
  }
}
