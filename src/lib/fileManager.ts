import { discoverTrackFileMissing } from "./missingFileTrack";
import { showPlaybackFileMissingToast } from "./playbackToast";
import { revealPathInFileManager } from "./tauri";
import type { Track } from "../types/track";

export function revealInFileManagerLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "Reveal in Finder";
  if (ua.includes("Win")) return "Show in File Explorer";
  return "Show in File Manager";
}

export async function revealTrackInFileManager(
  track: Track,
  updateTrackInLibrary: (track: Track) => void,
): Promise<void> {
  const missing = await discoverTrackFileMissing(track, updateTrackInLibrary);
  if (missing) {
    showPlaybackFileMissingToast(track);
    return;
  }

  await revealPathInFileManager(track.filePath);
}
