import { discoverTrackFileMissing } from "@/lib/tracks/missingFileTrack";
import { t } from "@/lib/i18n";
import { showPlaybackFileMissingToast } from "@/lib/playback/playbackToast";
import { revealPathInFileManager } from "@/lib/tauri";
import type { Track } from "@/types/track";

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
