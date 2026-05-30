import { albumKey, pickArtPath } from "./albums";
import {
  artistNamesEqual,
  parseArtistField,
  serializeArtistField,
} from "./artistNames";
import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track } from "../types/track";

function tracksShareAlbum(tracks: Track[]): boolean {
  if (tracks.length <= 1) return true;
  const key = albumKey(tracks[0]);
  return tracks.every((t) => albumKey(t) === key);
}

export interface TrackEditorForm {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: string;
  trackNumber: string;
  discNumber: string;
  genre: string;
}

export type TrackEditorFormField = keyof TrackEditorForm;

const MIXED_PLACEHOLDER = "Multiple values";

export function mixedFieldPlaceholder(
  tracks: Track[],
  field: TrackEditorFormField,
  form: TrackEditorForm,
): string | undefined {
  if (tracks.length <= 1 || form[field] !== "") return undefined;
  return isTrackEditorFieldMixed(tracks, field) ? MIXED_PLACEHOLDER : undefined;
}

function normalizeOptionalString(value: string | null): string {
  return value ?? "";
}

function sharedString(
  tracks: Track[],
  getter: (track: Track) => string | null,
): string {
  if (tracks.length === 0) return "";
  const first = normalizeOptionalString(getter(tracks[0]));
  for (let i = 1; i < tracks.length; i++) {
    if (normalizeOptionalString(getter(tracks[i])) !== first) return "";
  }
  return first;
}

export function sharedArtistField(
  tracks: Track[],
  getter: (track: Track) => string | null,
): string {
  if (tracks.length === 0) return "";
  const first = parseArtistField(getter(tracks[0]));
  for (let i = 1; i < tracks.length; i++) {
    if (!artistNamesEqual(first, parseArtistField(getter(tracks[i])))) return "";
  }
  return serializeArtistField(first) ?? "";
}

function sharedInt(
  tracks: Track[],
  getter: (track: Track) => number | null,
): string {
  if (tracks.length === 0) return "";
  const first = getter(tracks[0]);
  for (let i = 1; i < tracks.length; i++) {
    if (getter(tracks[i]) !== first) return "";
  }
  return first != null ? String(first) : "";
}

export function trackToForm(track: Track): TrackEditorForm {
  return {
    title: track.title,
    artist: track.artist ?? "",
    album: track.album ?? "",
    albumArtist: track.albumArtist ?? "",
    year: track.year != null ? String(track.year) : "",
    trackNumber: track.trackNumber != null ? String(track.trackNumber) : "",
    discNumber: track.discNumber != null ? String(track.discNumber) : "",
    genre: track.genre ?? "",
  };
}

export function tracksToForm(tracks: Track[]): TrackEditorForm {
  if (tracks.length === 1) return trackToForm(tracks[0]);
  return {
    title: sharedString(tracks, (t) => t.title),
    artist: sharedArtistField(tracks, (t) => t.artist),
    album: sharedString(tracks, (t) => t.album),
    albumArtist: sharedArtistField(tracks, (t) => t.albumArtist),
    year: sharedInt(tracks, (t) => t.year),
    trackNumber: sharedInt(tracks, (t) => t.trackNumber),
    discNumber: sharedInt(tracks, (t) => t.discNumber),
    genre: sharedString(tracks, (t) => t.genre),
  };
}

function valuesDiffer<T>(
  tracks: Track[],
  getter: (track: Track) => T,
): boolean {
  if (tracks.length <= 1) return false;
  const first = getter(tracks[0]);
  return tracks.some((t) => getter(t) !== first);
}

export function isTrackEditorFieldMixed(
  tracks: Track[],
  field: TrackEditorFormField,
): boolean {
  switch (field) {
    case "title":
      return valuesDiffer(tracks, (t) => t.title);
    case "artist": {
      if (tracks.length <= 1) return false;
      const first = parseArtistField(tracks[0].artist);
      return tracks.some(
        (t) => !artistNamesEqual(first, parseArtistField(t.artist)),
      );
    }
    case "album":
      return valuesDiffer(tracks, (t) => normalizeOptionalString(t.album));
    case "albumArtist": {
      if (tracks.length <= 1) return false;
      const first = parseArtistField(tracks[0].albumArtist);
      return tracks.some(
        (t) => !artistNamesEqual(first, parseArtistField(t.albumArtist)),
      );
    }
    case "year":
      return valuesDiffer(tracks, (t) => t.year);
    case "trackNumber":
      return valuesDiffer(tracks, (t) => t.trackNumber);
    case "discNumber":
      return valuesDiffer(tracks, (t) => t.discNumber);
    case "genre":
      return valuesDiffer(tracks, (t) => normalizeOptionalString(t.genre));
  }
}

export function sharedArtPath(tracks: Track[]): string | null {
  if (tracks.length === 0) return null;
  const first = tracks[0].artPath;
  if (tracks.every((t) => t.artPath === first)) return first;
  if (tracksShareAlbum(tracks)) return pickArtPath(tracks);
  return null;
}

export function isArtMixed(tracks: Track[]): boolean {
  if (tracks.length <= 1) return false;
  if (tracks.every((t) => t.artPath === tracks[0].artPath)) return false;
  return sharedArtPath(tracks) == null;
}

export function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

export function trackEditorFormsEqual(
  a: TrackEditorForm,
  b: TrackEditorForm,
): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.albumArtist === b.albumArtist &&
    a.year === b.year &&
    a.trackNumber === b.trackNumber &&
    a.discNumber === b.discNumber &&
    a.genre === b.genre
  );
}

export function buildTrackMetadataFromForm(
  track: Track,
  form: TrackEditorForm,
  initialForm: TrackEditorForm,
  artPath: string | null,
  artChanged: boolean,
): TrackMetadataUpdate {
  const pickString = (
    field: Exclude<TrackEditorFormField, "title" | "year" | "trackNumber" | "discNumber">,
    current: string | null,
  ): string | null => {
    if (form[field] === initialForm[field]) return current;
    const trimmed = form[field].trim();
    return trimmed || null;
  };

  const pickInt = (
    field: "year" | "trackNumber" | "discNumber",
    current: number | null,
  ): number | null => {
    if (form[field] === initialForm[field]) return current;
    return parseOptionalInt(form[field]);
  };

  const title =
    form.title === initialForm.title
      ? track.title
      : form.title.trim() || "Unknown";

  return {
    title,
    artist: pickString("artist", track.artist),
    album: pickString("album", track.album),
    albumArtist: pickString("albumArtist", track.albumArtist),
    year: pickInt("year", track.year),
    trackNumber: pickInt("trackNumber", track.trackNumber),
    discNumber: pickInt("discNumber", track.discNumber),
    genre: pickString("genre", track.genre),
    artPath,
    artChanged,
  };
}
