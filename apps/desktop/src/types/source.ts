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

/** Where a track's file is, or is going (see `file_plan::Location`). */
export interface FileLocation {
  sourceId: number;
  /** Path relative to the source's folder, with `/` separators. */
  relPath: string;
  path: string;
}

/** One file operation in a plan. Only moves exist so far. */
export interface FileOp {
  kind: "move";
  trackId: number;
  from: FileLocation;
  to: FileLocation;
}

/**
 * Why an operation can't go exactly as wanted. `targetExists` and
 * `duplicateTarget` still run, to a numbered name; the rest are skipped.
 */
export type FileConflict =
  | { kind: "targetExists"; wanted: string }
  | { kind: "duplicateTarget"; wanted: string; otherTrackId: number }
  | { kind: "sourceMissing" }
  | { kind: "sourceUnreadable"; error: string }
  | { kind: "insideSpiralFolder" }
  | { kind: "invalidTarget"; error: string };

export interface PlannedFileOp {
  op: FileOp;
  conflict: FileConflict | null;
}

/** What organizing a source would do, for the user to confirm. */
export interface FilePlanSummary {
  /** Files that will move, renamed ones included. */
  moves: number;
  /** Of those, the ones going to a numbered name. */
  renamed: number;
  /** Tracks that stay put because of a conflict. */
  skipped: number;
  /** Tracks already where they belong. */
  unchanged: number;
  /** The first moves, by path. */
  sample: PlannedFileOp[];
  /** The first operations with a conflict. */
  conflicts: PlannedFileOp[];
}

export interface FilePlanApplySummary {
  moved: number;
  failed: number;
  errors: string[];
}

/** Payload of `library://file-plan-progress`. */
export interface FilePlanProgress {
  /** Null while an interrupted plan is finished at startup. */
  sourceId: number | null;
  done: number;
  total: number;
}
