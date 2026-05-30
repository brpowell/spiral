import {
  normalizeArtistName,
  parseArtistField,
  serializeArtistField,
} from "./artistNames";
import type { ArtistBrowseMode } from "./artists";
import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track } from "../types/track";

const UNKNOWN_ARTIST = "Unknown Artist";

export interface ArtistEditorForm {
  name: string;
}

export function artistToForm(artist: { name: string }): ArtistEditorForm {
  return { name: artist.name };
}

export function artistFormsEqual(
  a: ArtistEditorForm,
  b: ArtistEditorForm,
): boolean {
  return a.name === b.name;
}

export function artistKeyAfterRename(
  name: string,
  browseMode: ArtistBrowseMode,
): string {
  const trimmed = name.trim();
  if (!trimmed) return UNKNOWN_ARTIST;
  if (browseMode === "performers") return normalizeArtistName(trimmed);
  return trimmed;
}

function updateDiscographyArtistName(
  track: Track,
  newName: string,
): { artist: string | null; albumArtist: string | null } {
  const trimmedNew = newName.trim() || null;
  if (track.albumArtist?.trim()) {
    return { artist: track.artist, albumArtist: trimmedNew };
  }
  return { artist: trimmedNew, albumArtist: track.albumArtist };
}

function updatePerformerArtistName(
  track: Track,
  artistKey: string,
  newName: string,
): string | null {
  const trimmedNew = newName.trim();
  const names = parseArtistField(track.artist);
  if (names.length === 0) {
    return trimmedNew || null;
  }
  const updated = names.map((name) =>
    normalizeArtistName(name) === artistKey ? trimmedNew || name : name,
  );
  return serializeArtistField(updated.filter(Boolean));
}

/** Name-only metadata update — never touches album art or embedded file art. */
export function buildTrackArtistMetadata(
  track: Track,
  form: ArtistEditorForm,
  originalForm: ArtistEditorForm,
  artistKey: string,
  browseMode: ArtistBrowseMode,
): TrackMetadataUpdate {
  const nameChanged = form.name !== originalForm.name;

  let artist = track.artist;
  let albumArtist = track.albumArtist;

  if (nameChanged) {
    if (browseMode === "discography") {
      const updated = updateDiscographyArtistName(track, form.name);
      artist = updated.artist;
      albumArtist = updated.albumArtist;
    } else {
      artist = updatePerformerArtistName(track, artistKey, form.name);
    }
  }

  return {
    title: track.title,
    artist,
    album: track.album,
    albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    genre: track.genre,
    artPath: track.artPath,
    artChanged: false,
  };
}
