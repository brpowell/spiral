export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ActivityLogContext {
  driveId?: string;
  discId?: string;
  releaseMbid?: string;
  artist?: string;
  album?: string;
}

export interface ActivityLogEntry {
  id: string;
  timestampMs: number;
  level: LogLevel;
  domain: string;
  message: string;
  context?: ActivityLogContext;
  details?: Record<string, unknown>;
}

/** Canonical JSON shape for one log line (copy/export). */
export interface ActivityLogLine {
  id: string;
  timestampMs: number;
  level: LogLevel;
  domain: string;
  message: string;
  releaseMbid?: string;
  artist?: string;
  album?: string;
  details?: Record<string, unknown>;
}

export interface ActivityLogDraft {
  level: LogLevel;
  domain: string;
  message: string;
  context?: ActivityLogContext;
  details?: Record<string, unknown>;
}

export type ActivityLogDomain =
  (typeof ACTIVITY_LOG_DOMAIN_DEFS)[keyof typeof ACTIVITY_LOG_DOMAIN_DEFS]["value"];

const ACTIVITY_LOG_DOMAIN_DEFS = {
  musicbrainz: { value: "metadata.musicbrainz", label: "MusicBrainz" },
  coverArt: { value: "metadata.coverArt", label: "Cover Art" },
  artistArt: { value: "metadata.artistArt", label: "Artist Art" },
  convert: { value: "library.convert", label: "Convert" },
  import: { value: "library.import", label: "Import" },
  refresh: { value: "library.refresh", label: "Refresh" },
  metadataSave: { value: "metadata.save", label: "Metadata" },
  lyricsFetch: { value: "lyrics.fetch", label: "Lyrics" },
  skinLoad: { value: "skin.load", label: "Skin load" },
  visualizerLoad: { value: "visualizer.load", label: "Visualizer load" },
  packScan: { value: "pack.scan", label: "Pack scan" },
  packInstall: { value: "pack.install", label: "Pack install" },
  cdPlayback: { value: "cd.playback", label: "CD playback" },
  libraryPlayback: { value: "library.playback", label: "Library playback" },
  libraryLoad: { value: "library.load", label: "Library load" },
} as const;

export const ACTIVITY_LOG_DOMAINS = {
  musicbrainz: ACTIVITY_LOG_DOMAIN_DEFS.musicbrainz.value,
  coverArt: ACTIVITY_LOG_DOMAIN_DEFS.coverArt.value,
  artistArt: ACTIVITY_LOG_DOMAIN_DEFS.artistArt.value,
  convert: ACTIVITY_LOG_DOMAIN_DEFS.convert.value,
  import: ACTIVITY_LOG_DOMAIN_DEFS.import.value,
  refresh: ACTIVITY_LOG_DOMAIN_DEFS.refresh.value,
  metadataSave: ACTIVITY_LOG_DOMAIN_DEFS.metadataSave.value,
  lyricsFetch: ACTIVITY_LOG_DOMAIN_DEFS.lyricsFetch.value,
  skinLoad: ACTIVITY_LOG_DOMAIN_DEFS.skinLoad.value,
  visualizerLoad: ACTIVITY_LOG_DOMAIN_DEFS.visualizerLoad.value,
  packScan: ACTIVITY_LOG_DOMAIN_DEFS.packScan.value,
  packInstall: ACTIVITY_LOG_DOMAIN_DEFS.packInstall.value,
  cdPlayback: ACTIVITY_LOG_DOMAIN_DEFS.cdPlayback.value,
  libraryPlayback: ACTIVITY_LOG_DOMAIN_DEFS.libraryPlayback.value,
  libraryLoad: ACTIVITY_LOG_DOMAIN_DEFS.libraryLoad.value,
} as const;

export const ACTIVITY_LOG_DOMAIN_OPTIONS: ReadonlyArray<{
  value: ActivityLogDomain;
  label: string;
}> = Object.values(ACTIVITY_LOG_DOMAIN_DEFS);

export const ACTIVITY_LOG_EVENT = "activity://entry";
