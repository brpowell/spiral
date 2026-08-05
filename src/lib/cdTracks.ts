import type { CdDisc, CdDiscCdText, CdTrack, DiscTocTrack } from "../types/cd";
import type { Track } from "../types/track";
import { t } from "./i18n";

const PLACEHOLDER_TRACK_TITLE = /^Track \d+$/;

export function discNeedsCdText(disc: CdDisc): boolean {
  return disc.tracks.some((track) => PLACEHOLDER_TRACK_TITLE.test(track.title));
}

export function mergeCdTextIntoDisc(
  disc: CdDisc,
  cdText: CdDiscCdText,
): CdDisc {
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
  const artist =
    track.artist?.trim() || disc.artist?.trim() || t("common:unknownArtist");
  return {
    id: cdTrackListId(track.number),
    title: track.title,
    artist,
    album: disc.album ?? null,
    albumArtist: disc.artist?.trim() || artist,
    trackNumber: track.number,
    totalTracks: disc.tracks.length,
    discNumber: 1,
    totalDiscs: 1,
    year: disc.year ?? null,
    genre: disc.genre ?? null,
    durationSeconds: track.durationSeconds ?? null,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "",
    artPath: null,
    dateAdded: "",
    playCount: 0,
    lastPlayedAt: null,
    rating: track.rating ?? 0,
  };
}

/** Attach cached CD hero art to synthetic list rows for playback and now-playing UI. */
export function applyArtPathToCdTracks(
  tracks: Track[],
  artPath: string | null,
): Track[] {
  return tracks.map((track) =>
    track.artPath === artPath ? track : { ...track, artPath },
  );
}

export function albumTotalDurationSecondsFromCd(tracks: CdTrack[]): number {
  return tracks.reduce(
    (total, track) => total + (track.durationSeconds ?? 0),
    0,
  );
}

export function cdDiscTitle(disc: CdDisc): string {
  if (disc.album?.trim()) return disc.album.trim();
  if (disc.artist?.trim()) return disc.artist.trim();
  return t("common:unknownDisc");
}

export function cdSidebarDiscLabel(disc: CdDisc | null | undefined): string {
  if (disc == null) return t("common:unknownDisc");
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

export function discTocTracks(disc: CdDisc): DiscTocTrack[] {
  return disc.tracks.flatMap((track) => {
    if (track.durationSeconds == null) return [];
    return [{ number: track.number, durationSeconds: track.durationSeconds }];
  });
}
