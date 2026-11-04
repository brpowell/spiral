import {
  discoverTrackFileMissing,
  isMissingFileError,
  withTrackMissingFile,
} from "./missingFileTrack";
import { buildTrackLyricsInputFromEditor } from "./lyrics";
import { markTrackInstrumental, saveTrackLyrics } from "./tauri";
import { usePlayerStore } from "../store/usePlayerStore";
import type { LyricsFormat, LyricsLine } from "../types/lyrics";
import type { Track } from "../types/track";

export type CommitFetchedLyricsResult =
  | { status: "ok" }
  | { status: "missing_file" }
  | { status: "error"; message: string };

export async function commitFetchedLyricsForTrack(
  track: Track,
  input: {
    plainText: string;
    lines: LyricsLine[];
    format: LyricsFormat;
  },
): Promise<CommitFetchedLyricsResult> {
  if (await discoverTrackFileMissing(track)) {
    usePlayerStore
      .getState()
      .updateTrackInLibrary(withTrackMissingFile(track, true));
    return { status: "missing_file" };
  }

  try {
    // Kept in the library always; written to the file only when its source is writable.
    const lyrics = buildTrackLyricsInputFromEditor(
      input.plainText.trim(),
      input.format === "line_synced" ? input.lines : null,
      "lrclib",
    );
    const updated = await saveTrackLyrics(track.id, lyrics);
    usePlayerStore.getState().updateTrackInLibrary(updated);
    usePlayerStore.getState().notifyTrackLyricsUpdated(track.id);
    return { status: "ok" };
  } catch (err) {
    if (isMissingFileError(err)) {
      usePlayerStore
        .getState()
        .updateTrackInLibrary(withTrackMissingFile(track, true));
      return { status: "missing_file" };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Persist instrumental marker in the library (DB only) so auto-fetch skips this track. */
export async function commitInstrumentalMarkForTrack(
  trackId: number,
): Promise<CommitFetchedLyricsResult> {
  try {
    const updated = await markTrackInstrumental(trackId);
    usePlayerStore.getState().updateTrackInLibrary(updated);
    usePlayerStore.getState().notifyTrackLyricsUpdated(trackId);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
