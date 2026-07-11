export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ActivityLogContext {
  operationId?: string;
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
  operationId?: string;
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
  operationId?: string;
  driveId?: string;
  discId?: string;
  releaseMbid?: string;
  artist?: string;
  album?: string;
  details?: Record<string, unknown>;
}

export interface ActivityLogDraft {
  level: LogLevel;
  domain: string;
  message: string;
  operationId?: string;
  context?: ActivityLogContext;
  details?: Record<string, unknown>;
}

export type ActivityLogDomain =
  (typeof ACTIVITY_LOG_DOMAIN_DEFS)[keyof typeof ACTIVITY_LOG_DOMAIN_DEFS]["value"];

const ACTIVITY_LOG_DOMAIN_DEFS = {
  musicbrainz: { value: "metadata.musicbrainz", label: "MusicBrainz" },
  coverArt: { value: "metadata.coverArt", label: "Cover Art" },
  convert: { value: "library.convert", label: "Convert" },
  refresh: { value: "library.refresh", label: "Refresh" },
  lyricsFetch: { value: "lyrics.fetch", label: "Lyrics" },
  skinLoad: { value: "skin.load", label: "Skin load" },
  visualizerLoad: { value: "visualizer.load", label: "Visualizer load" },
} as const;

export const ACTIVITY_LOG_DOMAINS = {
  musicbrainz: ACTIVITY_LOG_DOMAIN_DEFS.musicbrainz.value,
  coverArt: ACTIVITY_LOG_DOMAIN_DEFS.coverArt.value,
  convert: ACTIVITY_LOG_DOMAIN_DEFS.convert.value,
  refresh: ACTIVITY_LOG_DOMAIN_DEFS.refresh.value,
  lyricsFetch: ACTIVITY_LOG_DOMAIN_DEFS.lyricsFetch.value,
  skinLoad: ACTIVITY_LOG_DOMAIN_DEFS.skinLoad.value,
  visualizerLoad: ACTIVITY_LOG_DOMAIN_DEFS.visualizerLoad.value,
} as const;

export const ACTIVITY_LOG_DOMAIN_OPTIONS: ReadonlyArray<{
  value: ActivityLogDomain;
  label: string;
}> = Object.values(ACTIVITY_LOG_DOMAIN_DEFS);

export const ACTIVITY_LOG_EVENT = "activity://entry";
