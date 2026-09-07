import {
  normalizeArtistName,
  parseArtistField,
  serializeArtistField,
} from "./artistNames";
import type { ArtistBrowseMode } from "./artists";
import { t } from "./i18n";
import type { TrackMetadataUpdate } from "../types/metadata";
import { mbidFieldsFrom, type Track } from "../types/track";

export interface ArtistEditorForm {
  name: string;
  /** MusicBrainz artist UUID for the entity being edited. */
  artistMbid: string;
}

export function artistToForm(
  artist: { name: string; key: string; tracks: Track[] },
  browseMode: ArtistBrowseMode,
): ArtistEditorForm {
  return {
    name: artist.name,
    artistMbid: sharedArtistMbid(artist.tracks, artist.key, browseMode),
  };
}

export function artistFormsEqual(
  a: ArtistEditorForm,
  b: ArtistEditorForm,
): boolean {
  return a.name === b.name && a.artistMbid === b.artistMbid;
}

function creditNamesForBrowseMode(
  track: Track,
  browseMode: ArtistBrowseMode,
): string[] {
  if (browseMode === "discography") {
    return parseArtistField(track.albumArtist || track.artist);
  }
  return parseArtistField(track.artist);
}

function mbidAtMatchingSlot(
  names: string[],
  ids: string[],
  matchKey: string,
): string {
  if (names.length <= 1) {
    return ids[0]?.trim() || "";
  }
  const key = normalizeArtistName(matchKey);
  const index = names.findIndex((name) => normalizeArtistName(name) === key);
  if (index >= 0) return ids[index]?.trim() || "";
  return ids.length === 1 ? ids[0]?.trim() || "" : "";
}

function artistMbidFromTrack(
  track: Track,
  artistKey: string,
  browseMode: ArtistBrowseMode,
): string {
  const names = creditNamesForBrowseMode(track, browseMode);
  const ids =
    browseMode === "discography"
      ? (track.albumArtistMbids ?? [])
      : (track.artistMbids ?? []);
  return mbidAtMatchingSlot(names, ids, artistKey);
}

function sharedArtistMbid(
  tracks: Track[],
  artistKey: string,
  browseMode: ArtistBrowseMode,
): string {
  if (tracks.length === 0) return "";
  const first = artistMbidFromTrack(tracks[0], artistKey, browseMode);
  for (let i = 1; i < tracks.length; i++) {
    if (artistMbidFromTrack(tracks[i], artistKey, browseMode) !== first) {
      return "";
    }
  }
  return first;
}

export function isArtistMbidMixed(
  tracks: Track[],
  artistKey: string,
  browseMode: ArtistBrowseMode,
): boolean {
  if (tracks.length <= 1) return false;
  const first = artistMbidFromTrack(tracks[0], artistKey, browseMode);
  return tracks.some(
    (track) => artistMbidFromTrack(track, artistKey, browseMode) !== first,
  );
}

export function artistMbidPlaceholder(
  tracks: Track[],
  artistKey: string,
  browseMode: ArtistBrowseMode,
  form: ArtistEditorForm,
): string | undefined {
  if (tracks.length <= 1 || form.artistMbid !== "") return undefined;
  return isArtistMbidMixed(tracks, artistKey, browseMode)
    ? t("library:editor.mixedValues")
    : undefined;
}

/** Replace the MBID at the name slot that matches `matchKey`. */
function replaceMbidAtMatchingSlot(
  names: string[],
  ids: string[],
  matchKey: string,
  newId: string,
): string[] {
  const trimmed = newId.trim();
  if (names.length <= 1) {
    return trimmed ? [trimmed] : [];
  }
  const key = normalizeArtistName(matchKey);
  const index = names.findIndex((name) => normalizeArtistName(name) === key);
  if (index < 0) {
    return trimmed ? [trimmed] : [];
  }
  const next = names.map((_, i) => ids[i]?.trim() || "");
  next[index] = trimmed;
  return next;
}

export function artistKeyAfterRename(
  name: string,
  browseMode: ArtistBrowseMode,
): string {
  const trimmed = name.trim();
  if (!trimmed) return t("common:unknownArtist");
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

/** Name / artist-MBID metadata update — never touches album art or embedded file art. */
export function buildTrackArtistMetadata(
  track: Track,
  form: ArtistEditorForm,
  originalForm: ArtistEditorForm,
  artistKey: string,
  browseMode: ArtistBrowseMode,
): TrackMetadataUpdate {
  const nameChanged = form.name !== originalForm.name;
  const mbidChanged = form.artistMbid !== originalForm.artistMbid;

  let artist = track.artist;
  let albumArtist = track.albumArtist;
  const mbids = mbidFieldsFrom(track);

  if (nameChanged) {
    if (browseMode === "discography") {
      const updated = updateDiscographyArtistName(track, form.name);
      artist = updated.artist;
      albumArtist = updated.albumArtist;
    } else {
      artist = updatePerformerArtistName(track, artistKey, form.name);
    }
  }

  if (mbidChanged) {
    const names = creditNamesForBrowseMode(track, browseMode);
    const next = replaceMbidAtMatchingSlot(
      names,
      browseMode === "discography" ? mbids.albumArtistMbids : mbids.artistMbids,
      artistKey,
      form.artistMbid,
    );
    if (browseMode === "discography") {
      mbids.albumArtistMbids = next;
    } else {
      mbids.artistMbids = next;
    }
  }

  return {
    title: track.title,
    artist,
    album: track.album,
    albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    totalTracks: track.totalTracks,
    discNumber: track.discNumber,
    totalDiscs: track.totalDiscs,
    genre: track.genre,
    artPath: track.artPath,
    artChanged: false,
    lyricsChanged: false,
    ...mbids,
  };
}
