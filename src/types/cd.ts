export interface CdDrive {
  id: string;
  name: string;
  hasDisc: boolean;
}

export interface CdTrack {
  number: number;
  title: string;
  artist?: string | null;
  durationSeconds?: number | null;
  /** Canonical 0–255 rating from user override; 0 / omitted = unrated. */
  rating?: number | null;
  recordingMbid?: string | null;
  artistMbids?: string[];
}

export interface CdDisc {
  driveId: string;
  discId?: string | null;
  album?: string | null;
  artist?: string | null;
  year?: number | null;
  genre?: string | null;
  releaseMbid?: string | null;
  albumArtistMbids?: string[];
  tracks: CdTrack[];
}

export interface CdTrackTitle {
  number: number;
  title: string;
}

/** CD-Text overlay fetched after the fast status-XML track list. */
export interface CdDiscCdText {
  driveId: string;
  album?: string | null;
  artist?: string | null;
  trackTitles: CdTrackTitle[];
}

export const CD_DISC_CHANGED_EVENT = "cd-disc-changed";

export interface CdDiscChangedPayload {
  drives: CdDrive[];
}

export interface DiscTrackMetadata {
  number: number;
  title: string;
  artist?: string | null;
  recordingMbid?: string | null;
  artistMbids?: string[];
}

export interface DiscMetadata {
  discId?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  year?: number | null;
  genre?: string | null;
  country?: string | null;
  label?: string | null;
  releaseMbid?: string | null;
  albumArtistMbids?: string[];
  tracks: DiscTrackMetadata[];
}

export interface DiscMetadataLookup {
  discId?: string | null;
  candidates: DiscMetadata[];
  preferred?: DiscMetadata | null;
  kind?: "hit" | "miss" | "error";
}

export interface DiscMetadataCachePeek {
  lookup: DiscMetadataLookup;
  needsNetworkFetch: boolean;
}

export interface DiscTocTrack {
  number: number;
  durationSeconds: number;
}

export interface DiscTrackOverride {
  title?: string | null;
  artist?: string | null;
  rating?: number | null;
  recordingMbid?: string | null;
}

/** User metadata edits for a disc, keyed by TOC disc id. Independent of library. */
export interface DiscMetadataOverride {
  album?: string | null;
  albumArtist?: string | null;
  year?: number | null;
  genre?: string | null;
  artPath?: string | null;
  releaseMbid?: string | null;
  /** Track number as decimal string → field overrides. */
  tracks?: Record<string, DiscTrackOverride>;
}
