import { peekLyricsFetchCache, searchLyricsCandidates } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { t } from "./i18n";
import type { LyricsSearchCandidate } from "../types/lyrics";
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

/**
 * "Choose from available options": search LRCLIB for every match behind a
 * progress toast. Resolves with the candidates (the toast then dismisses
 * silently; the caller shows the picker or a not-found notice) and rejects
 * when the search fails, which settles the toast as an error.
 */
export function searchLyricsOptionsInBackground(
  trackId: number,
  displayTitle: string,
  params: LyricsFetchParams,
): Promise<LyricsSearchCandidate[]> {
  return new Promise((resolve, reject) => {
    useBackgroundTasksStore.getState().runInBackground({
      key: `lyrics-options-${trackId}`,
      label: t("toasts:lyrics.searchingFor", { title: displayTitle }),
      run: async (ctx) => {
        try {
          resolve(await searchLyricsCandidates(params));
          ctx.dismissSilently();
        } catch (err) {
          reject(err);
          throw err;
        }
      },
    });
  });
}
