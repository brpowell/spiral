import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track } from "../types/track";

export interface AlbumEditorForm {
  title: string;
  artist: string;
  year: string;
}

export function albumToForm(album: {
  title: string;
  artist: string;
  year: number | null;
}): AlbumEditorForm {
  return {
    title: album.title,
    artist: album.artist,
    year: album.year != null ? String(album.year) : "",
  };
}

export function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

export function albumFormsEqual(a: AlbumEditorForm, b: AlbumEditorForm): boolean {
  return a.title === b.title && a.artist === b.artist && a.year === b.year;
}

export function buildTrackAlbumMetadata(
  track: Track,
  form: AlbumEditorForm,
  artPath: string | null,
  artChanged: boolean,
): TrackMetadataUpdate {
  return {
    title: track.title,
    artist: track.artist,
    album: form.title.trim() || null,
    albumArtist: form.artist.trim() || null,
    year: parseOptionalInt(form.year),
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    genre: track.genre,
    artPath,
    artChanged,
  };
}
