/** Where a library source's files live and who owns them. */
export type SourceKind = "managed" | "watched" | "external";

/** A library source: the Spiral tracks folder, a watched folder, or other files. */
export interface Source {
  id: number;
  kind: SourceKind;
  /** Folder a watched source indexes; null for managed and external. */
  rootPath: string | null;
  name: string;
  /** Whether Spiral may change the source's files (tags, moves, deletes). */
  writable: boolean;
  createdAt: string;
}

/** What one reconcile pass changed in a source's tracks. */
export interface ReconcileSummary {
  sourceId: number;
  added: number;
  updated: number;
  missing: number;
  restored: number;
  failed: number;
  errors: string[];
}

/** Whether a watched folder is being watched live (see `get_source_statuses`). */
export type SourceWatchStatus = "watching" | "unreachable" | "notWatching";

export interface SourceStatus {
  sourceId: number;
  status: SourceWatchStatus;
}
