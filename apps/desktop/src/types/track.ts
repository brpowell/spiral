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
  /** MusicBrainz recording UUID (`MUSICBRAINZ_TRACKID`). */
  recordingMbid?: string | null;
  /** MusicBrainz release UUID (`MUSICBRAINZ_ALBUMID`). */
  releaseMbid?: string | null;
  /** Performer credit MBIDs, same order as `artist` names. */
  artistMbids?: string[];
  /** Album-artist credit MBIDs, same order as `albumArtist` names. */
  albumArtistMbids?: string[];
  /**
   * Library source the file belongs to (managed tracks folder, a watched
   * folder, or external). Absent on tracks still being imported.
   */
  sourceId?: number;
  /** When the library found the file missing on disk; null while present. */
  missingSince?: string | null;
}

/** Copy MusicBrainz ID fields, treating missing values as empty. */
export function mbidFieldsFrom(source: {
  recordingMbid?: string | null;
  releaseMbid?: string | null;
  artistMbids?: string[];
  albumArtistMbids?: string[];
}): {
  recordingMbid: string | null;
  releaseMbid: string | null;
  artistMbids: string[];
  albumArtistMbids: string[];
} {
  return {
    recordingMbid: source.recordingMbid ?? null,
    releaseMbid: source.releaseMbid ?? null,
    artistMbids: source.artistMbids ?? [],
    albumArtistMbids: source.albumArtistMbids ?? [],
  };
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
  recordingMbid?: string | null;
  releaseMbid?: string | null;
  artistMbids?: string[];
  albumArtistMbids?: string[];
}
