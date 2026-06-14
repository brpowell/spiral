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
}

export interface CdDisc {
  driveId: string;
  discId?: string | null;
  album?: string | null;
  artist?: string | null;
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
}

export interface DiscMetadata {
  discId?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  year?: number | null;
  country?: string | null;
  label?: string | null;
  releaseMbid?: string | null;
  tracks: DiscTrackMetadata[];
}

export interface DiscMetadataLookup {
  discId?: string | null;
  candidates: DiscMetadata[];
  preferred?: DiscMetadata | null;
}

export interface DiscMetadataCachePeek {
  lookup: DiscMetadataLookup;
  needsNetworkFetch: boolean;
}

export interface DiscTocTrack {
  number: number;
  durationSeconds: number;
}
