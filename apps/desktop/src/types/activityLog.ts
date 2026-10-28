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
  library: { value: "library", label: "Library" },
  playback: { value: "playback", label: "Playback" },
  metadata: { value: "metadata", label: "Metadata" },
  lyrics: { value: "lyrics", label: "Lyrics" },
  studio: { value: "studio", label: "Studio" },
  cd: { value: "cd", label: "CD" },
  app: { value: "app", label: "App" },
} as const;

export const ACTIVITY_LOG_DOMAINS = {
  library: ACTIVITY_LOG_DOMAIN_DEFS.library.value,
  playback: ACTIVITY_LOG_DOMAIN_DEFS.playback.value,
  metadata: ACTIVITY_LOG_DOMAIN_DEFS.metadata.value,
  lyrics: ACTIVITY_LOG_DOMAIN_DEFS.lyrics.value,
  studio: ACTIVITY_LOG_DOMAIN_DEFS.studio.value,
  cd: ACTIVITY_LOG_DOMAIN_DEFS.cd.value,
  app: ACTIVITY_LOG_DOMAIN_DEFS.app.value,
} as const;

export const ACTIVITY_LOG_DOMAIN_OPTIONS: ReadonlyArray<{
  value: ActivityLogDomain;
  label: string;
}> = Object.values(ACTIVITY_LOG_DOMAIN_DEFS);

export const ACTIVITY_LOG_EVENT = "activity://entry";
