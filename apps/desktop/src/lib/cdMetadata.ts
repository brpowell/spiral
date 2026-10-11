import type {
  CdDisc,
  DiscMetadata,
  DiscMetadataLookup,
  DiscMetadataOverride,
} from "../types/cd";
import type { MusicBrainzEntityHit } from "../types/musicbrainz";

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
    releaseMbid: metadata.releaseMbid?.trim() || null,
    albumArtistMbids: metadata.albumArtistMbids ?? [],
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
        recordingMbid: remote?.recordingMbid?.trim() || null,
        artistMbids: remote?.artistMbids ?? [],
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
  const releaseMbid = overlayOptionalMbid(
    disc.releaseMbid,
    override.releaseMbid,
  );

  return {
    ...disc,
    album,
    artist,
    year: override.year !== undefined ? override.year : disc.year,
    genre:
      override.genre !== undefined
        ? override.genre?.trim() || null
        : disc.genre,
    releaseMbid,
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
        recordingMbid: overlayOptionalMbid(
          track.recordingMbid,
          trackOverride.recordingMbid,
        ),
      };
    }),
  };
}

/** `undefined`/`null` = not overridden; empty string = cleared. */
function overlayOptionalMbid(
  current: string | null | undefined,
  override: string | null | undefined,
): string | null {
  if (override == null) return current?.trim() || null;
  const trimmed = override.trim();
  return trimmed || null;
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

export function selectedDiscFromLookup(
  lookup: DiscMetadataLookup,
): DiscMetadata | undefined {
  return (
    lookup.preferred ??
    (lookup.candidates.length === 1 ? lookup.candidates[0] : undefined)
  );
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
  if (typeof override.releaseMbid === "string") return true;
  const tracks = override.tracks;
  if (tracks == null) return false;
  return Object.values(tracks).some(
    (track) =>
      (track.title != null && track.title.trim() !== "") ||
      (track.artist != null && track.artist.trim() !== "") ||
      (track.rating != null && track.rating !== 0) ||
      typeof track.recordingMbid === "string",
  );
}

/** Map a disc lookup candidate onto the shared MusicBrainz entity card shape. */
export function discMetadataToEntityHit(
  metadata: DiscMetadata,
  fallbackTitle: string,
): MusicBrainzEntityHit {
  return {
    kind: "release",
    mbid: metadata.releaseMbid?.trim() ?? "",
    title: metadata.album?.trim() || fallbackTitle,
    artist: metadata.albumArtist?.trim() || null,
    year: metadata.year ?? null,
    country: metadata.country?.trim() || null,
    label: metadata.label?.trim() || null,
    trackCount: metadata.tracks.length,
  };
}
