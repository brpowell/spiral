/** Mirrors Rust `PackManifest` / pack.json v1. Archive extension: `.spk`. */

/** Current pack.json wrapper shape version (`manifestVersion`). */
export const PACK_MANIFEST_VERSION = 1 as const;

/** Zip artifact extension for distributable packs (Phase 3 export/install). */
export const PACK_ARCHIVE_EXTENSION = ".spk" as const;

/** Filename of the pack wrapper manifest inside a pack directory or `.spk`. */
export const PACK_MANIFEST_FILENAME = "pack.json" as const;

/**
 * Fixed type-folder → contribution type mapping (mirrors Rust
 * `CONTRIBUTION_TYPE_FOLDERS`). New types are additive here; pack.json unchanged.
 */
export const CONTRIBUTION_TYPE_FOLDERS = [
  { folder: "themes", type: "theme", manifestFilename: "theme.json" },
  { folder: "skins", type: "skin", manifestFilename: "skin.json" },
  { folder: "visualizers", type: "visualizer", manifestFilename: "viz.json" },
  { folder: "renderers", type: "renderer", manifestFilename: "renderer.json" },
] as const;

export interface PackManifest {
  manifestVersion: typeof PACK_MANIFEST_VERSION;
  packId: string;
  /**
   * Structured slug identifying who maintains/distributes this pack.
   * Independent of freeform `author` on contribution manifests.
   */
  authorId: string;
  /** Semver content version of this pack build. */
  version: string;
  name: string;
  description: string;
  /** Optional pack icon path relative to the pack root. Prefer square 128×128 or 256×256. */
  icon?: string;
  /** Optional semver floor; checked after parse (Phase 1+). */
  minAppVersion?: string;
}

export type PackZone = "builtin" | "workshop" | "installed" | "linked";

/** Packs-page top-level grouping: managed vs custom. */
export type PackCategory = "managed" | "custom";

/** Workshop drafts and linked packs share the mutable authoring class. */
export function isAuthoringPackZone(zone: PackZone): boolean {
  return zone === "workshop" || zone === "linked";
}

/** Packs-page top-level grouping: managed (built-in/installed) vs custom (workshop/linked). */
export function packCategoryOf(zone: PackZone): PackCategory {
  return isAuthoringPackZone(zone) ? "custom" : "managed";
}

export interface PackContributionSummary {
  type: string;
  localId: string;
  effectiveId: string;
  name: string;
  /** Freeform credit from the contribution manifest (may be empty). */
  author: string;
  hidden: boolean;
}

/** One on-disk pack directory (builtin / workshop / installed@version). */
export interface PackSummary {
  packId: string;
  authorId: string;
  version: string;
  name: string;
  description: string;
  /** Optional pack icon path relative to the pack root. Prefer square 128×128 or 256×256. */
  icon?: string;
  zone: PackZone;
  packDir: string;
  contributions: PackContributionSummary[];
  active: boolean;
  rollbackVersion?: string;
}
