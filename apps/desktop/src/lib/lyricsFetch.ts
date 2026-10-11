import type { LyricsSearchCandidate } from "../types/lyrics";
import { t } from "./i18n";

export type LyricsFetchFeedback = {
  text: string;
  variant: "info" | "error";
};

export const LYRICS_FETCH_NOT_FOUND: LyricsFetchFeedback = {
  text: t("library:editor.lyrics.notFound"),
  variant: "info",
};

export const LYRICS_FETCH_INSTRUMENTAL: LyricsFetchFeedback = {
  text: t("library:editor.lyrics.instrumentalJoke"),
  variant: "info",
};

export function createLyricsFetchFeedback(
  text: string,
  variant: LyricsFetchFeedback["variant"] = "error",
): LyricsFetchFeedback {
  return { text, variant };
}

/** Map backend/invoke errors to copy safe to show in the lyrics editor. */
export function lyricsFetchFailureFeedback(
  error: unknown,
): LyricsFetchFeedback {
  const raw = error instanceof Error ? error.message : String(error);

  if (
    raw.includes("Artist and title are required") ||
    raw.includes("Track duration is required")
  ) {
    return createLyricsFetchFeedback(
      raw.includes("Track duration is required")
        ? t("library:editor.lyrics.durationRequired")
        : t("library:editor.lyrics.artistTitleRequired"),
    );
  }

  if (
    raw.includes("LRCLIB request failed") ||
    /connection|timed out|timeout|dns|network/i.test(raw)
  ) {
    return createLyricsFetchFeedback(t("library:editor.lyrics.networkError"));
  }

  if (raw.includes("failed to parse LRCLIB response")) {
    return createLyricsFetchFeedback(t("library:editor.lyrics.parseError"));
  }

  if (
    raw.includes("LRCLIB returned HTTP") ||
    raw.startsWith("LRCLIB returned")
  ) {
    return createLyricsFetchFeedback(t("library:editor.lyrics.httpError"));
  }

  if (raw.includes("failed to create HTTP client")) {
    return createLyricsFetchFeedback(t("library:editor.lyrics.clientError"));
  }

  if (raw.includes("lyrics fetch cache")) {
    return createLyricsFetchFeedback(t("library:editor.lyrics.cacheError"));
  }

  return createLyricsFetchFeedback(t("library:editor.lyrics.genericError"));
}

export function formatLyricsDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export type LyricsLibraryTrackRef = {
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
};

export function lyricsCandidateLabel(candidate: LyricsSearchCandidate): string {
  return `${candidate.trackName} · ${candidate.artistName}`;
}

export function lyricsCandidateDetails(
  candidate: LyricsSearchCandidate,
): string {
  const album = candidate.albumName.trim();
  if (!album || album.toLowerCase() === "null") {
    return t("common:unknownAlbum");
  }
  return album;
}

export function lyricsCandidateDurationMeta(
  candidate: LyricsSearchCandidate,
  targetDurationSeconds?: number | null,
): string {
  const formatted = formatLyricsDuration(candidate.duration);
  if (targetDurationSeconds == null) {
    return formatted;
  }

  const delta = Math.round(candidate.duration - targetDurationSeconds);
  if (Math.abs(delta) <= 2) {
    return formatted;
  }

  const sign = delta > 0 ? "+" : "";
  return `${formatted} (${sign}${delta}s)`;
}
