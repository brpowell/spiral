import { parseOptionalInt } from "./albumMetadata";
import type { DiscMetadataOverride, DiscTrackOverride } from "../types/cd";
import type { TrackEditorForm } from "./trackMetadataForm";
import type { Track } from "../types/track";
import { cdTrackNumberFromListId } from "./cdTracks";

/** Build a disc override patch from track editor form values for the given CD rows. */
export function discOverridePatchFromTrackForm(
  tracks: Track[],
  form: TrackEditorForm,
  artPath: string | null | undefined,
  artChanged: boolean,
): DiscMetadataOverride {
  const trackPatches: Record<string, DiscTrackOverride> = {};
  for (const track of tracks) {
    const number = cdTrackNumberFromListId(track.id);
    trackPatches[String(number)] = {
      title: form.title.trim() || track.title,
      artist: form.artist.trim() || null,
      rating: form.rating,
    };
  }

  const patch: DiscMetadataOverride = {
    tracks: trackPatches,
  };

  if (form.album.trim()) {
    patch.album = form.album.trim();
  }
  if (form.albumArtist.trim()) {
    patch.albumArtist = form.albumArtist.trim();
  }
  const year = parseOptionalInt(form.year);
  if (year != null) {
    patch.year = year;
  }
  if (form.genre.trim()) {
    patch.genre = form.genre.trim();
  }
  if (artChanged) {
    patch.artPath = artPath ?? null;
  }

  return patch;
}

export function discOverridePatchFromAlbumForm(input: {
  title: string;
  artist: string;
  year: string;
  genre: string;
  artPath: string | null | undefined;
  artChanged: boolean;
}): DiscMetadataOverride {
  const patch: DiscMetadataOverride = {
    album: input.title.trim() || null,
    albumArtist: input.artist.trim() || null,
    year: parseOptionalInt(input.year),
    genre: input.genre.trim() || null,
  };
  if (input.artChanged) {
    patch.artPath = input.artPath ?? null;
  }
  return patch;
}

export function cdArtCacheKey(discId: string): string {
  return `cd://${discId}`;
}
