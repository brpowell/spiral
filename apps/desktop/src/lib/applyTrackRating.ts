import { useSourcesStore } from "../store/useSourcesStore";
import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import type { Track } from "../types/track";
import { setTrackRating } from "./tauri";
import { confirmTagWriteNative } from "./tagWriteConfirmNative";
import type { CanonicalRating } from "./trackRating";
import { isTrackWritable } from "./sourceAccess";

export function applyTrackRating(
  track: Track,
  rating: CanonicalRating,
  updateTrackInLibrary: (track: Track) => void,
): void {
  updateTrackInLibrary({ ...track, rating });
  void setTrackRating(track.id, rating).catch(() =>
    updateTrackInLibrary(track),
  );
}

/**
 * Rating a track rewrites the tag in its audio file, so confirm first (unless
 * the user opted out). Tracks whose file Spiral won't write (read-only
 * sources) only change in the library, so they don't count and never prompt
 * on their own. `native` uses an OS dialog, for skins where the in-app modal
 * may not fit.
 */
export async function confirmAndApplyTrackRatings(
  tracks: Track[],
  rating: CanonicalRating,
  updateTrackInLibrary: (track: Track) => void,
  options: { native?: boolean } = {},
): Promise<void> {
  const changed = tracks.filter((track) => track.rating !== rating);
  if (changed.length === 0) return;

  const { sourcesById } = useSourcesStore.getState();
  const fileWrites = changed.filter((track) =>
    isTrackWritable(track, sourcesById),
  ).length;
  if (fileWrites > 0) {
    const confirmed = options.native
      ? await confirmTagWriteNative("rating", fileWrites)
      : await useTagWriteConfirmStore
          .getState()
          .confirmTagWrite("rating", fileWrites);
    if (!confirmed) return;
  }

  for (const track of changed) {
    applyTrackRating(track, rating, updateTrackInLibrary);
  }
}
