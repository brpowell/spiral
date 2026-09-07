export type MusicBrainzEntityKind = "release" | "recording" | "artist";

export type MusicBrainzEntityHit = {
  kind: MusicBrainzEntityKind;
  mbid: string;
  title: string;
  artist?: string | null;
  disambiguation?: string | null;
  year?: number | null;
  country?: string | null;
  label?: string | null;
  entityType?: string | null;
  area?: string | null;
  trackCount?: number | null;
};

/** One position on a release medium (numeric disc/track). */
export type MusicBrainzTrackSlot = {
  discNumber: number;
  trackNumber: number;
  recordingMbid?: string | null;
};

/** Cached or fetched entity card plus optional release tracklist. */
export type MusicBrainzEntityLookup = {
  hit: MusicBrainzEntityHit;
  tracklist?: MusicBrainzTrackSlot[];
};
