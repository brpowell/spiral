export type LyricsFormat =
  | "plain"
  | "line_synced"
  | "word_synced"
  | "instrumental";
export type LyricsSource = "manual" | "embedded" | "sidecar" | "lrclib" | null;

export interface LyricsWord {
  text: string;
  startMs: number;
  endMs?: number;
}

export interface LyricsLine {
  text: string;
  startMs?: number;
  endMs?: number;
  words?: LyricsWord[];
}

export interface TrackLyricsInput {
  format: LyricsFormat;
  source: LyricsSource;
  lines: LyricsLine[];
  plainText: string;
}

export interface TrackLyrics {
  trackId: number;
  format: LyricsFormat;
  source: LyricsSource;
  lines: LyricsLine[];
  plainText: string;
  updatedAt: string;
}

export interface LyricsSearchCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  lyrics: TrackLyricsInput;
}

export type LyricsFetchOutcome =
  | { status: "found"; lyrics: TrackLyricsInput }
  | { status: "not_found" }
  | { status: "instrumental" }
  | { status: "ambiguous"; candidates: LyricsSearchCandidate[] };
