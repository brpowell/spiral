import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track } from "../types/track";
import { t } from "./i18n";
import {
  isTrackEditorFieldMixed,
  sharedInt,
  sharedString,
  type TrackEditorFormField,
} from "./trackMetadataForm";

export interface AlbumEditorForm {
  title: string;
  artist: string;
  year: string;
  genre: string;
  totalTracks: string;
  totalDiscs: string;
}

export type AlbumEditorMixedField = Extract<
  TrackEditorFormField,
  "genre" | "totalTracks" | "totalDiscs"
>;

export function albumToForm(album: {
  title: string;
  artist: string;
  year: number | null;
  tracks: Track[];
}): AlbumEditorForm {
  return {
    title: album.title,
    artist: album.artist,
    year: album.year != null ? String(album.year) : "",
    genre: sharedString(album.tracks, (track) => track.genre),
    totalTracks: sharedInt(album.tracks, (track) => track.totalTracks),
    totalDiscs: sharedInt(album.tracks, (track) => track.totalDiscs),
  };
}

export function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

export function albumFormsEqual(
  a: AlbumEditorForm,
  b: AlbumEditorForm,
): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.year === b.year &&
    a.genre === b.genre &&
    a.totalTracks === b.totalTracks &&
    a.totalDiscs === b.totalDiscs
  );
}

export function albumMixedFieldPlaceholder(
  tracks: Track[],
  field: AlbumEditorMixedField,
  form: AlbumEditorForm,
): string | undefined {
  if (tracks.length <= 1 || form[field] !== "") return undefined;
  return isTrackEditorFieldMixed(tracks, field)
    ? t("library:editor.mixedValues")
    : undefined;
}

export function buildTrackAlbumMetadata(
  track: Track,
  form: AlbumEditorForm,
  originalForm: AlbumEditorForm,
  artPath: string | null,
  artChanged: boolean,
): TrackMetadataUpdate {
  const pickString = (
    field: "genre",
    current: string | null,
  ): string | null => {
    if (form[field] === originalForm[field]) return current;
    const trimmed = form[field].trim();
    return trimmed || null;
  };

  const pickInt = (
    field: "totalTracks" | "totalDiscs",
    current: number | null,
  ): number | null => {
    if (form[field] === originalForm[field]) return current;
    return parseOptionalInt(form[field]);
  };

  return {
    title: track.title,
    artist: track.artist,
    album: form.title.trim() || null,
    albumArtist: form.artist.trim() || null,
    year: parseOptionalInt(form.year),
    trackNumber: track.trackNumber,
    totalTracks: pickInt("totalTracks", track.totalTracks),
    discNumber: track.discNumber,
    totalDiscs: pickInt("totalDiscs", track.totalDiscs),
    genre: pickString("genre", track.genre),
    artPath,
    artChanged,
    lyricsChanged: false,
  };
}
