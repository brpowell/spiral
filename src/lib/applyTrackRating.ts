import type { Track } from "../types/track";
import { setTrackRating } from "./tauri";
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
