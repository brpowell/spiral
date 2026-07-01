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

export type ActivityLogDomainFilter =
  | "all"
  | "metadata.musicbrainz"
  | "metadata.coverArt"
  | "library.convert"
  | "library.refresh";

export const ACTIVITY_LOG_DOMAINS = {
  musicbrainz: "metadata.musicbrainz",
  coverArt: "metadata.coverArt",
  convert: "library.convert",
  refresh: "library.refresh",
} as const;

export const ACTIVITY_LOG_EVENT = "activity://entry";
