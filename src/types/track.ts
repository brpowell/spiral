import type { LyricsFormat, TrackLyricsInput } from "./lyrics";

export type PlaybackState = "playing" | "paused" | "stopped";

/** off = play queue once; all = loop queue; one = loop current track */
export type RepeatMode = "off" | "all" | "one";

/** Client-only state while a track is staged before copy/save finishes. */
export type TrackImportStatus = "importing";

export interface Track {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNumber: number | null;
  totalTracks: number | null;
  discNumber: number | null;
  totalDiscs: number | null;
  year: number | null;
  genre: string | null;
  durationSeconds: number | null;
  sampleRate: number | null;
  bitrate: number | null;
  codec: string | null;
  filePath: string;
  artPath: string | null;
  dateAdded: string;
  playCount: number;
  lastPlayedAt: string | null;
  rating: number;
  importStatus?: TrackImportStatus;
  /** Original dropped/picked path; used for copy and stable list keys during import. */
  importSourcePath?: string;
  /** Client-only flag set when playback cannot find the file on disk. */
  missingFile?: true;
  lyricsFormat?: LyricsFormat | null;
}

export interface TrackInput {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNumber: number | null;
  totalTracks: number | null;
  discNumber: number | null;
  totalDiscs: number | null;
  year: number | null;
  genre: string | null;
  durationSeconds: number | null;
  sampleRate: number | null;
  bitrate: number | null;
  codec: string | null;
  filePath: string;
  artPath: string | null;
  rating?: number | null;
  lyrics?: TrackLyricsInput | null;
}
