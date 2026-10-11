import { parseOptionalInt } from "./albumMetadata";
import type { DiscMetadataOverride, DiscTrackOverride } from "../types/cd";
import type { MusicBrainzTrackSlot } from "../types/musicbrainz";
import type { TrackEditorForm } from "./trackMetadataForm";
import type { Track } from "../types/track";
import { cdTrackNumberFromListId } from "./cdTracks";
import { matchRecordingMbid } from "./musicBrainzReleaseRecordings";

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
  releaseMbid?: string;
  /** TOC track numbers when stamping recordings after a release change. */
  trackNumbers?: number[];
  /** Cached release tracklist; null/omit with empty release clears recordings. */
  tracklist?: MusicBrainzTrackSlot[] | null;
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
  if (input.releaseMbid !== undefined) {
    const releaseMbid = input.releaseMbid.trim();
    patch.releaseMbid = releaseMbid;
    if (input.trackNumbers != null && input.trackNumbers.length > 0) {
      const trackPatches: Record<string, DiscTrackOverride> = {};
      for (const number of input.trackNumbers) {
        const recordingMbid = !releaseMbid
          ? ""
          : input.tracklist != null
            ? (matchRecordingMbid(
                { discNumber: 1, trackNumber: number },
                input.tracklist,
              ) ?? "")
            : "";
        trackPatches[String(number)] = { recordingMbid };
      }
      patch.tracks = trackPatches;
    }
  }
  return patch;
}

export function cdArtCacheKey(discId: string): string {
  return `cd://${discId}`;
}
