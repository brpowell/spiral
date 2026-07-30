import { discoverTrackFileMissing } from "./missingFileTrack";
import { t } from "./i18n";
import { showPlaybackFileMissingToast } from "./playbackToast";
import { revealPathInFileManager } from "./tauri";
import type { Track } from "../types/track";

export function revealInFileManagerLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return t("common:revealInFinder");
  if (ua.includes("Win")) return t("common:revealInFileExplorer");
  return t("common:revealInFileManager");
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
