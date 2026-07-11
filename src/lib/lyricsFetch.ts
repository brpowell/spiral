import type { LyricsSearchCandidate } from "../types/lyrics";

export type LyricsFetchFeedback = {
  text: string;
  variant: "info" | "error";
};

export const LYRICS_FETCH_NOT_FOUND: LyricsFetchFeedback = {
  text: "No lyrics found on LRCLIB for this track.",
  variant: "info",
};

export const LYRICS_FETCH_INSTRUMENTAL: LyricsFetchFeedback = {
  text: "You can still mimic the instruments with your mouth.",
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
    return createLyricsFetchFeedback(raw);
  }

  if (
    raw.includes("LRCLIB request failed") ||
    /connection|timed out|timeout|dns|network/i.test(raw)
  ) {
    return createLyricsFetchFeedback(
      "Couldn't reach LRCLIB. Check your connection and try again.",
    );
  }

  if (raw.includes("failed to parse LRCLIB response")) {
    return createLyricsFetchFeedback(
      "Received an unexpected response from LRCLIB. Try again later.",
    );
  }

  if (
    raw.includes("LRCLIB returned HTTP") ||
    raw.startsWith("LRCLIB returned")
  ) {
    return createLyricsFetchFeedback(
      "LRCLIB returned an error. Try again later.",
    );
  }

  if (raw.includes("failed to create HTTP client")) {
    return createLyricsFetchFeedback(
      "Couldn't start a lyrics lookup. Try again.",
    );
  }

  if (raw.includes("lyrics fetch cache")) {
    return createLyricsFetchFeedback(
      "Couldn't read the lyrics lookup cache. Try again.",
    );
  }

  return createLyricsFetchFeedback("Couldn't fetch lyrics. Try again later.");
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
    return "Unknown album";
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
