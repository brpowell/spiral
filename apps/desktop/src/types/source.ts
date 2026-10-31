/**
 * A library source: a folder of tracks. Ids 1 (the default source, the Spiral
 * folder's tracks folder) and 2 (Other, loose files with no folder) are built
 * in; folders the user adds get ids from 3 up.
 */
export interface Source {
  id: number;
  name: string;
  /** The source's folder (resolved for the default source); null for Other. */
  rootPath: string | null;
  /** Whether Spiral keeps the source's files organized. */
  autoOrganize: boolean;
  /** This source's own path format; null inherits the global one. */
  pathFormat: string | null;
  /** New imports are copied into this source. */
  importTarget: boolean;
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
