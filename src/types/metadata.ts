/** Editable track metadata — shared by the Track Editor UI and Tauri write command. */
import type { TrackLyricsInput } from "./lyrics";

export interface TrackMetadataUpdate {
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
  /** Cached art file path for the library DB (null = no cached art). */
  artPath: string | null;
  /** When true, embed or clear cover art in the audio file. */
  artChanged: boolean;
  lyrics?: TrackLyricsInput | null;
  /** When true, embed or clear lyrics in the audio file and sync track_lyrics. */
  lyricsChanged?: boolean;
}
