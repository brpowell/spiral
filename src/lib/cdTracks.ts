import type { CdDisc, CdDiscCdText, CdTrack } from "../types/cd";
import type { Track } from "../types/track";

const PLACEHOLDER_TRACK_TITLE = /^Track \d+$/;

export function discNeedsCdText(disc: CdDisc): boolean {
  return disc.tracks.some((track) => PLACEHOLDER_TRACK_TITLE.test(track.title));
}

export function mergeCdTextIntoDisc(disc: CdDisc, cdText: CdDiscCdText): CdDisc {
  const titleByNumber = new Map(
    cdText.trackTitles.map((entry) => [entry.number, entry.title]),
  );
  const album = cdText.album?.trim() ? cdText.album : disc.album;
  const artist = cdText.artist?.trim() ? cdText.artist : disc.artist;

  return {
    ...disc,
    album,
    artist,
    tracks: disc.tracks.map((track) => ({
      ...track,
      title: titleByNumber.get(track.number) ?? track.title,
      artist: artist ?? track.artist,
    })),
  };
}

/**
 * CD rows get synthetic ids below this base so they stay disjoint from both
 * library ids (positive) and pending-import ids (small negatives from -1 down).
 */
const CD_TRACK_LIST_ID_BASE = -1_000_000_000;

/** Synthetic library IDs for CD rows in TrackList (negative, scoped to disc view). */
export function cdTrackListId(trackNumber: number): number {
  return CD_TRACK_LIST_ID_BASE - trackNumber;
}

export function isCdTrackListId(id: number): boolean {
  return id <= CD_TRACK_LIST_ID_BASE;
}

export function cdTrackNumberFromListId(id: number): number {
  return CD_TRACK_LIST_ID_BASE - id;
}

export function cdTracksForList(disc: CdDisc): Track[] {
  return disc.tracks.map((track) => cdTrackToListRow(track, disc));
}

function cdTrackToListRow(track: CdTrack, disc: CdDisc): Track {
  return {
    id: cdTrackListId(track.number),
    title: track.title,
    artist: track.artist ?? disc.artist ?? null,
    album: disc.album ?? null,
    albumArtist: disc.artist ?? null,
    trackNumber: track.number,
    discNumber: 1,
    year: null,
    genre: null,
    durationSeconds: track.durationSeconds ?? null,
    filePath: "",
    artPath: null,
    dateAdded: "",
    playCount: 0,
  };
}

export function albumTotalDurationSecondsFromCd(tracks: CdTrack[]): number {
  return tracks.reduce(
    (total, track) => total + (track.durationSeconds ?? 0),
    0,
  );
}

export const UNKNOWN_CD_DISC_LABEL = "Unknown Disc";

export function cdDiscTitle(
  disc: CdDisc,
  fallback: string = UNKNOWN_CD_DISC_LABEL,
): string {
  if (disc.album?.trim()) return disc.album.trim();
  if (disc.artist?.trim()) return disc.artist.trim();
  return fallback;
}

export function cdSidebarDiscLabel(
  disc: CdDisc | null | undefined,
): string {
  if (disc == null) return UNKNOWN_CD_DISC_LABEL;
  return cdDiscTitle(disc);
}

/** Wait for CD-Text when the fast disc read has no album/artist yet. */
export function isCdSidebarDiscReady(
  disc: CdDisc | null | undefined,
  cdTextAttempted: boolean,
): boolean {
  if (disc === undefined) return false;
  if (disc == null) return true;
  if (disc.album?.trim() || disc.artist?.trim()) return true;
  if (discNeedsCdText(disc)) return cdTextAttempted;
  return true;
}
