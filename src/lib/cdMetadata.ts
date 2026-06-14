import type { CdDisc, DiscMetadata } from "../types/cd";
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

export function discMetadataLabel(metadata: DiscMetadata): string {
  const album = metadata.album?.trim() || "Unknown album";
  const artist = metadata.albumArtist?.trim();
  const year = metadata.year != null ? String(metadata.year) : null;
  const details = [artist, year].filter(Boolean).join(" · ");
  return details ? `${album} — ${details}` : album;
}

export function discMetadataReleaseDetails(metadata: DiscMetadata): string | null {
  const country = metadata.country?.trim();
  const parts = [
    country ? formatCountryDisplay(country) : null,
    metadata.label?.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
