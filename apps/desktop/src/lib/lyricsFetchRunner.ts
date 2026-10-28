import { listen } from "@tauri-apps/api/event";
import type { LyricsFetchOutcome } from "../types/lyrics";
import { ACTIVITY_LOG_DOMAINS, ACTIVITY_LOG_EVENT } from "../types/activityLog";
import {
  createLyricsFetchFeedback,
  LYRICS_FETCH_INSTRUMENTAL,
  LYRICS_FETCH_NOT_FOUND,
  lyricsFetchFailureFeedback,
} from "./lyricsFetch";
import {
  commitFetchedLyricsForTrack,
  commitInstrumentalMarkForTrack,
} from "./lyricsFetchCommit";
import { normalizeActivityLogEntry } from "./activityLogLine";
import { t } from "./i18n";
import { fetchLyricsLrclib, getTrackLyrics } from "./tauri";
import { useLyricsFetchStore } from "../store/useLyricsFetchStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { missingFileErrorDetail } from "./missingFileTrack";
import type { Track } from "../types/track";

const LYRICS_FETCH_CANCELLED_MESSAGE = "Lyrics fetch cancelled";

const RETRY_APPROACH_MESSAGES = new Set([
  "Retrying LRCLIB get with album artist",
  "Searching LRCLIB for lyrics",
  "Retrying LRCLIB search without parenthetical title",
]);

export const RETRY_DETAIL = (): string => t("toasts:lyrics.retryDetail");

function isLyricsFetchRetryMessage(message: string): boolean {
  if (RETRY_APPROACH_MESSAGES.has(message)) return true;
  return (
    message.startsWith("LRCLIB ") &&
    message.includes("timed out, retrying once")
  );
}

function isLyricsFetchCancelledError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message === LYRICS_FETCH_CANCELLED_MESSAGE;
  }
  return String(err) === LYRICS_FETCH_CANCELLED_MESSAGE;
}

export type LyricsFetchParams = {
  artist: string;
  albumArtist: string;
  title: string;
  album: string;
  durationSeconds: number;
};

type LyricsFetchRunOptions = {
  respectMissCache?: boolean;
  /** When true, skip fetch if the track already has lyrics or is marked instrumental. */
  skipIfHasLyrics?: boolean;
};

type SingleLyricsFetchResult =
  | { status: "skipped"; reason: "already_has_lyrics" }
  | { status: "found" }
  | { status: "not_found" }
  | { status: "instrumental" }
  | { status: "ambiguous" }
  | { status: "cancelled" }
  | { status: "error"; error: unknown };

export function markLyricsFetchNotFound(trackId: number): void {
  applyFetchOutcome(trackId, {
    feedback: LYRICS_FETCH_NOT_FOUND,
    candidates: [],
  });
}

export function markLyricsFetchInstrumental(trackId: number): void {
  applyFetchOutcome(trackId, {
    feedback: LYRICS_FETCH_INSTRUMENTAL,
    candidates: [],
  });
}

function applyFetchOutcome(
  trackId: number,
  ui: {
    feedback: ReturnType<typeof createLyricsFetchFeedback> | null;
    candidates: Extract<
      LyricsFetchOutcome,
      { status: "ambiguous" }
    >["candidates"];
  },
): void {
  useLyricsFetchStore.getState().applyOutcome(trackId, {
    feedback: ui.feedback,
    candidates: ui.candidates,
  });
}

async function handleFoundLyrics(
  trackId: number,
  result: Extract<LyricsFetchOutcome, { status: "found" }>,
): Promise<void> {
  const track = usePlayerStore
    .getState()
    .library.find((entry) => entry.id === trackId);
  if (!track) return;

  const commit = await commitFetchedLyricsForTrack(track, {
    plainText: result.lyrics.plainText,
    lines: result.lyrics.lines,
    format: result.lyrics.format,
  });

  if (commit.status === "ok") {
    applyFetchOutcome(trackId, { feedback: null, candidates: [] });
    return;
  }

  if (commit.status === "missing_file") {
    applyFetchOutcome(trackId, {
      feedback: createLyricsFetchFeedback(missingFileErrorDetail(track)),
      candidates: [],
    });
    return;
  }

  applyFetchOutcome(trackId, {
    feedback: createLyricsFetchFeedback(
      "Fetched lyrics couldn't be saved. Try again or use Save.",
    ),
    candidates: [],
  });
}

async function handleInstrumental(trackId: number): Promise<void> {
  const commit = await commitInstrumentalMarkForTrack(trackId);
  markLyricsFetchInstrumental(trackId);
  if (commit.status !== "ok") {
    applyFetchOutcome(trackId, {
      feedback: createLyricsFetchFeedback(
        "Couldn't save instrumental mark. Auto-fetch may try again later.",
      ),
      candidates: [],
    });
  }
}

export function buildLyricsFetchParamsForTrack(
  track: Track,
): LyricsFetchParams | null {
  const artist = track.artist?.trim() || "";
  const albumArtist = track.albumArtist?.trim() || "";
  const title = track.title.trim();
  const album = track.album?.trim() || "";

  if (!artist || !title || !track.durationSeconds) {
    return null;
  }

  return {
    artist,
    albumArtist,
    title,
    album,
    durationSeconds: track.durationSeconds,
  };
}

export function canFetchLyricsForTrack(track: Track): boolean {
  return buildLyricsFetchParamsForTrack(track) != null;
}

/** True when the track has lyrics text or is marked instrumental (skip auto-fetch). */
export async function trackAlreadyHasLyrics(trackId: number): Promise<boolean> {
  const lyrics = await getTrackLyrics(trackId);
  if (!lyrics) return false;
  if (lyrics.format === "instrumental") return true;
  return Boolean(lyrics.plainText.trim());
}

export function trackIsMarkedInstrumental(track: Track): boolean {
  return track.lyricsFormat === "instrumental";
}

export async function runSingleLyricsFetch(
  trackId: number,
  params: LyricsFetchParams,
  options?: LyricsFetchRunOptions & {
    onRetry?: () => void;
  },
): Promise<SingleLyricsFetchResult> {
  let unlisten: (() => void) | undefined;
  try {
    if (options?.skipIfHasLyrics && (await trackAlreadyHasLyrics(trackId))) {
      return { status: "skipped", reason: "already_has_lyrics" };
    }

    unlisten = await listen<Record<string, unknown>>(
      ACTIVITY_LOG_EVENT,
      (event) => {
        const entry = normalizeActivityLogEntry(event.payload);
        if (entry.domain !== ACTIVITY_LOG_DOMAINS.lyrics) return;
        if (isLyricsFetchRetryMessage(entry.message)) {
          options?.onRetry?.();
        }
      },
    );

    const result = await fetchLyricsLrclib(params, {
      respectMissCache: options?.respectMissCache ?? false,
    });

    if (result.status === "found") {
      await handleFoundLyrics(trackId, result);
      return { status: "found" };
    }

    if (result.status === "instrumental") {
      await handleInstrumental(trackId);
      return { status: "instrumental" };
    }

    if (result.status === "not_found") {
      markLyricsFetchNotFound(trackId);
      return { status: "not_found" };
    }

    applyFetchOutcome(trackId, {
      feedback: null,
      candidates: result.candidates,
    });
    return { status: "ambiguous" };
  } catch (err) {
    if (isLyricsFetchCancelledError(err)) {
      return { status: "cancelled" };
    }
    applyFetchOutcome(trackId, {
      feedback: lyricsFetchFailureFeedback(err),
      candidates: [],
    });
    return { status: "error", error: err };
  } finally {
    await unlisten?.();
  }
}
