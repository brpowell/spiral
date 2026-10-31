import { useTagWriteConfirmStore } from "../store/useTagWriteConfirmStore";
import type { Track } from "../types/track";
import { setTrackRating } from "./tauri";
import { confirmTagWriteNative } from "./tagWriteConfirmNative";
import type { CanonicalRating } from "./trackRating";

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
 * the user opted out). `native` uses an OS dialog, for skins where the in-app
 * modal may not fit.
 */
export async function confirmAndApplyTrackRatings(
  tracks: Track[],
  rating: CanonicalRating,
  updateTrackInLibrary: (track: Track) => void,
  options: { native?: boolean } = {},
): Promise<void> {
  const changed = tracks.filter((track) => track.rating !== rating);
  if (changed.length === 0) return;

  const confirmed = options.native
    ? await confirmTagWriteNative("rating", changed.length)
    : await useTagWriteConfirmStore
        .getState()
        .confirmTagWrite("rating", changed.length);
  if (!confirmed) return;

  for (const track of changed) {
    applyTrackRating(track, rating, updateTrackInLibrary);
  }
}
