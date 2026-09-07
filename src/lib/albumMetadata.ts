import type { TrackMetadataUpdate } from "../types/metadata";
import type { MusicBrainzTrackSlot } from "../types/musicbrainz";
import { mbidFieldsFrom, type Track } from "../types/track";
import { t } from "./i18n";
import { matchRecordingMbid } from "./musicBrainzReleaseRecordings";
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
  /** MusicBrainz release UUID. */
  releaseMbid: string;
}

export type AlbumEditorMixedField =
  | Extract<TrackEditorFormField, "genre" | "totalTracks" | "totalDiscs">
  | "releaseMbid";

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
    releaseMbid: sharedString(album.tracks, (track) => track.releaseMbid ?? ""),
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
    a.totalDiscs === b.totalDiscs &&
    a.releaseMbid === b.releaseMbid
  );
}

export function isReleaseMbidMixed(tracks: Track[]): boolean {
  if (tracks.length <= 1) return false;
  const first = tracks[0].releaseMbid?.trim() || "";
  return tracks.some((track) => (track.releaseMbid?.trim() || "") !== first);
}

export function albumMixedFieldPlaceholder(
  tracks: Track[],
  field: AlbumEditorMixedField,
  form: AlbumEditorForm,
): string | undefined {
  if (tracks.length <= 1 || form[field] !== "") return undefined;
  const mixed =
    field === "releaseMbid"
      ? isReleaseMbidMixed(tracks)
      : isTrackEditorFieldMixed(tracks, field);
  return mixed ? t("library:editor.mixedValues") : undefined;
}

export type AlbumReleaseRecordingOptions =
  | { releaseChanged: false }
  | { releaseChanged: true; tracklist: MusicBrainzTrackSlot[] | null };

/**
 * When the album release MBID changes, stamp or clear each track's recording
 * from the release tracklist. Unchanged release leaves recordings alone
 * (`undefined` = do not write).
 */
function recordingMbidForAlbumSave(
  track: Track,
  form: AlbumEditorForm,
  options: AlbumReleaseRecordingOptions,
): string | null | undefined {
  if (!options.releaseChanged) {
    return undefined;
  }
  if (!form.releaseMbid.trim()) {
    return null;
  }
  if (options.tracklist == null) {
    return null;
  }
  return matchRecordingMbid(track, options.tracklist);
}

export function buildTrackAlbumMetadata(
  track: Track,
  form: AlbumEditorForm,
  originalForm: AlbumEditorForm,
  artPath: string | null,
  artChanged: boolean,
  recordingOptions: AlbumReleaseRecordingOptions = { releaseChanged: false },
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

  const releaseMbidChanged = form.releaseMbid !== originalForm.releaseMbid;
  // Caller decides when to rematch (release change, or backfill from cache).
  const nextRecording = recordingMbidForAlbumSave(
    track,
    form,
    recordingOptions,
  );

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
    ...mbidFieldsFrom(track),
    releaseMbid: releaseMbidChanged
      ? form.releaseMbid.trim() || null
      : (track.releaseMbid ?? null),
    ...(nextRecording !== undefined ? { recordingMbid: nextRecording } : {}),
  };
}
