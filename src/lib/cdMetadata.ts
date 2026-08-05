import type { CdDisc, DiscMetadata, DiscMetadataOverride } from "../types/cd";
import { formatCountryDisplay } from "./countryFlag";

/** Overlay MusicBrainz (or user-selected) metadata onto a drive disc read. */
export function mergeRemoteMetadataIntoDisc(
  disc: CdDisc,
  metadata: DiscMetadata,
): CdDisc {
  const titleByNumber = new Map(
    metadata.tracks.map((track) => [track.number, track]),
  );

  const album = metadata.album?.trim() || disc.album;
  const artist = metadata.albumArtist?.trim() || disc.artist;

  return {
    ...disc,
    discId: metadata.discId ?? disc.discId,
    album,
    artist,
    year: metadata.year ?? disc.year ?? null,
    genre: metadata.genre?.trim() || disc.genre || null,
    tracks: disc.tracks.map((track) => {
      const remote = titleByNumber.get(track.number);
      return {
        ...track,
        title: remote?.title?.trim() || track.title,
        artist:
          remote?.artist?.trim() ||
          track.artist?.trim() ||
          artist ||
          track.artist,
      };
    }),
  };
}

/** Apply user disc overrides as the highest-priority metadata layer. */
export function mergeOverridesIntoDisc(
  disc: CdDisc,
  override: DiscMetadataOverride | null | undefined,
): CdDisc {
  if (override == null || !discMetadataOverrideHasEdits(override)) {
    return disc;
  }

  const album = override.album?.trim() || disc.album;
  const artist = override.albumArtist?.trim() || disc.artist;

  return {
    ...disc,
    album,
    artist,
    year: override.year !== undefined ? override.year : disc.year,
    genre:
      override.genre !== undefined
        ? override.genre?.trim() || null
        : disc.genre,
    tracks: disc.tracks.map((track) => {
      const trackOverride = override.tracks?.[String(track.number)];
      if (trackOverride == null) return track;
      return {
        ...track,
        title: trackOverride.title?.trim() || track.title,
        artist:
          trackOverride.artist?.trim() ||
          track.artist?.trim() ||
          artist ||
          track.artist,
        rating:
          trackOverride.rating !== undefined && trackOverride.rating !== null
            ? trackOverride.rating
            : track.rating,
      };
    }),
  };
}

/** Raw disc → MusicBrainz overlay → user overrides (display / import plan). */
export function mergeDiscDisplayLayers(
  disc: CdDisc,
  remoteMetadata: DiscMetadata | null | undefined,
  override: DiscMetadataOverride | null | undefined,
): CdDisc {
  let merged = disc;
  if (remoteMetadata != null) {
    merged = mergeRemoteMetadataIntoDisc(merged, remoteMetadata);
  }
  return mergeOverridesIntoDisc(merged, override);
}

export function discMetadataOverrideHasEdits(
  override: DiscMetadataOverride | null | undefined,
): boolean {
  if (override == null) return false;
  if (override.album != null && override.album.trim() !== "") return true;
  if (override.albumArtist != null && override.albumArtist.trim() !== "")
    return true;
  if (override.year != null) return true;
  if (override.genre != null && override.genre.trim() !== "") return true;
  if (override.artPath != null && override.artPath.trim() !== "") return true;
  const tracks = override.tracks;
  if (tracks == null) return false;
  return Object.values(tracks).some(
    (track) =>
      (track.title != null && track.title.trim() !== "") ||
      (track.artist != null && track.artist.trim() !== "") ||
      (track.rating != null && track.rating !== 0),
  );
}

export function discMetadataLabel(metadata: DiscMetadata): string {
  const album = metadata.album?.trim() || "Unknown album";
  const artist = metadata.albumArtist?.trim();
  const year = metadata.year != null ? String(metadata.year) : null;
  const details = [artist, year].filter(Boolean).join(" · ");
  return details ? `${album} — ${details}` : album;
}

export function discMetadataReleaseDetails(
  metadata: DiscMetadata,
): string | null {
  const country = metadata.country?.trim();
  const parts = [
    country ? formatCountryDisplay(country) : null,
    metadata.label?.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
