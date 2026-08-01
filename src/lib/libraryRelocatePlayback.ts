import { usePlayerStore } from "../store/usePlayerStore";

/**
 * Stop in-flight playback before switching, moving, or replacing the library root.
 * Clears the set list so stale track IDs from the previous library cannot linger.
 */
export function stopPlaybackForLibraryRelocate(): void {
  usePlayerStore.getState().clearSetList();
}
