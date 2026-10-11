import { peekLyricsFetchCache } from "./tauri";
import { enqueueLyricsFetch } from "./lyricsFetchQueue";
import type { LyricsFetchParams } from "./lyricsFetchRunner";
import {
  buildLyricsFetchParamsForTrack,
  canFetchLyricsForTrack,
  markLyricsFetchInstrumental,
  markLyricsFetchNotFound,
  trackAlreadyHasLyrics,
  trackIsMarkedInstrumental,
} from "./lyricsFetchRunner";
import { commitInstrumentalMarkForTrack } from "./lyricsFetchCommit";
import type { Track } from "../types/track";

export type { LyricsFetchParams } from "./lyricsFetchRunner";
export { buildLyricsFetchParamsForTrack, canFetchLyricsForTrack };

type LyricsFetchRunOptions = {
  respectMissCache?: boolean;
};

export function startLyricsFetchForTrack(track: Track): boolean {
  const params = buildLyricsFetchParamsForTrack(track);
  if (!params) return false;

  runLyricsFetchInBackground(track.id, params.title, params);
  return true;
}

export async function prepareLyricsFetchForLightbox(
  track: Track,
  options: { autoFetch: boolean },
): Promise<void> {
  const params = buildLyricsFetchParamsForTrack(track);
  if (!params) return;

  if (trackIsMarkedInstrumental(track)) return;

  if (await trackAlreadyHasLyrics(track.id)) return;

  const peek = await peekLyricsFetchCache({
    artist: params.artist,
    title: params.title,
    durationSeconds: params.durationSeconds,
  });

  if (peek === "miss") {
    markLyricsFetchNotFound(track.id);
    return;
  }

  if (peek === "instrumental") {
    await commitInstrumentalMarkForTrack(track.id);
    markLyricsFetchInstrumental(track.id);
    return;
  }

  if (!options.autoFetch) return;

  enqueueLyricsFetch(track.id, params.title, params, {
    priority: "auto",
    respectMissCache: true,
  });
}

export function runLyricsFetchInBackground(
  trackId: number,
  displayTitle: string,
  params: LyricsFetchParams,
  options?: LyricsFetchRunOptions,
): void {
  enqueueLyricsFetch(trackId, displayTitle, params, {
    priority: "manual",
    respectMissCache: options?.respectMissCache,
  });
}
