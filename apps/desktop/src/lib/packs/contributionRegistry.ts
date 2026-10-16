import {
  CONTRIBUTION_TYPE_FOLDERS,
  type PackManifest,
} from "../../types/pack";
import { effectiveContributionId } from "./packManifest";

/** Lightweight summary exposed to theme/skin/visualizer stores after scan. */
export interface ContributionSummary {
  type: string;
  localId: string;
  effectiveId: string;
  name: string;
  author: string;
  description: string;
  /** Pack-relative path to the contribution manifest. */
  manifestPath: string;
}

export interface ContributionHandlerContext {
  publisherId: string;
  packId: string;
  packDir: string;
  localId: string;
  effectiveId: string;
  /** Pack-relative path to the contribution manifest. */
  manifestPath: string;
}

/**
 * Code-side handler for one contribution `type` string.
 * New domains add a registry entry + folder mapping; pack.json schema stays untouched.
 */
export interface ContributionTypeHandler {
  /** Contribution manifest schema identity (docs / future validate). */
  schema: { id: string; version: number };
  /** Expected manifest filename inside the contribution folder. */
  manifestFilename: string;
  summarize: (ctx: ContributionHandlerContext) => ContributionSummary;
}

function stubSummarize(type: string): ContributionTypeHandler["summarize"] {
  return (ctx) => ({
    type,
    localId: ctx.localId,
    effectiveId: ctx.effectiveId,
    name: ctx.localId,
    author: "",
    description: "",
    manifestPath: ctx.manifestPath,
  });
}

/** Builtin handlers for known types. Runtime scan/load is the Rust packs module. */
export const CONTRIBUTION_TYPE_HANDLERS: Record<
  string,
  ContributionTypeHandler
> = {
  theme: {
    schema: { id: "theme-v1", version: 1 },
    manifestFilename: "theme.json",
    summarize: stubSummarize("theme"),
  },
  skin: {
    schema: { id: "skin-v1", version: 1 },
    manifestFilename: "skin.json",
    summarize: stubSummarize("skin"),
  },
  visualizer: {
    schema: { id: "viz-v1", version: 1 },
    manifestFilename: "viz.json",
    summarize: stubSummarize("visualizer"),
  },
  sound: {
    schema: { id: "sound-v1", version: 1 },
    manifestFilename: "sound.json",
    summarize: stubSummarize("sound"),
  },
};

export function getContributionTypeHandler(
  type: string,
): ContributionTypeHandler | undefined {
  return CONTRIBUTION_TYPE_HANDLERS[type];
}

export interface DiscoveredContribution {
  type: string;
  /** Contribution folder name on disk (not the source of truth for id). */
  folderName: string;
  /** Pack-relative path to the contribution manifest. */
  manifestPath: string;
  handler: ContributionTypeHandler;
}

export interface ResolvedContribution {
  type: string;
  handler: ContributionTypeHandler;
  localId: string;
  effectiveId: string;
  summary: ContributionSummary;
  manifestPath: string;
}

export interface ResolveContributionsOptions {
  packDir?: string;
  /**
   * Declared contribution ids keyed by pack-relative manifest path.
   * Required — ids live in contribution manifests (no folder-name fallback).
   */
  contributionIdsByPath: Record<string, string>;
  /** Called when a folder's type has no handler — contribution is skipped. */
  onUnknownType?: (type: string, folder: string) => void;
}

/**
 * Resolve contributions for a pack given discovered type-folder entries
 * and declared contribution ids (from each contribution manifest).
 */
export function resolvePackContributions(
  pack: PackManifest,
  discovered: DiscoveredContribution[],
  options: ResolveContributionsOptions,
): ResolvedContribution[] {
  const packDir = options.packDir ?? "";
  const ids = options.contributionIdsByPath;
  const resolved: ResolvedContribution[] = [];
  /** Uniqueness is per type so `sounds/wave` and `visualizers/wave` can coexist. */
  const seenTypeLocalIds = new Set<string>();

  for (const entry of discovered) {
    const handler =
      entry.handler ?? getContributionTypeHandler(entry.type);
    if (!handler) {
      options.onUnknownType?.(entry.type, entry.folderName);
      continue;
    }
    const localId = ids[entry.manifestPath];
    if (!localId) {
      throw new Error(
        `missing contribution id for "${entry.manifestPath}" in pack "${pack.packId}"`,
      );
    }
    const typeLocalKey = `${entry.type}:${localId}`;
    if (seenTypeLocalIds.has(typeLocalKey)) {
      throw new Error(
        `duplicate ${entry.type} contribution id "${localId}" in pack "${pack.packId}"`,
      );
    }
    seenTypeLocalIds.add(typeLocalKey);
    const effectiveId = effectiveContributionId(
      pack.publisherId,
      pack.packId,
      entry.type,
      localId,
    );
    const ctx: ContributionHandlerContext = {
      publisherId: pack.publisherId,
      packId: pack.packId,
      packDir,
      localId,
      effectiveId,
      manifestPath: entry.manifestPath,
    };
    resolved.push({
      type: entry.type,
      handler,
      localId,
      effectiveId,
      summary: handler.summarize(ctx),
      manifestPath: entry.manifestPath,
    });
  }

  return resolved;
}

/** Build discovery stubs from the fixed folder table (no filesystem). */
export function discoveredFromFolderTable(
  contributionFolders: Array<{ typeFolder: string; folderName: string }>,
): DiscoveredContribution[] {
  const out: DiscoveredContribution[] = [];
  for (const { typeFolder, folderName } of contributionFolders) {
    const entry = CONTRIBUTION_TYPE_FOLDERS.find((e) => e.folder === typeFolder);
    if (!entry) continue;
    const handler = getContributionTypeHandler(entry.type);
    if (!handler) continue;
    out.push({
      type: entry.type,
      folderName,
      manifestPath: `${typeFolder}/${folderName}/${entry.manifestFilename}`,
      handler,
    });
  }
  return out;
}
