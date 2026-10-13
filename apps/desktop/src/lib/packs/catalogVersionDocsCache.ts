import {
  fetchRegistryPackVersionSafe,
  peekRegistryPackVersion,
} from "../packRegistry";
import type { RegistryVersionDetail } from "../../types/packRegistry";

export type CatalogVersionDocs = {
  readme: string | null;
  changelog: string | null;
};

type VersionArgs = {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: string;
};

function docsFromDetail(detail: RegistryVersionDetail): CatalogVersionDocs {
  return {
    readme: detail.readme?.trim() || null,
    changelog: detail.changelog?.trim() || null,
  };
}

/**
 * Docs already in the registry cache, for rendering without a loading state.
 * `undefined` means not cached (or expired); `null` is never returned.
 */
export function peekCatalogVersionDocs(
  args: VersionArgs,
): CatalogVersionDocs | undefined {
  const hit = peekRegistryPackVersion(args);
  return hit?.ok ? docsFromDetail(hit.detail) : undefined;
}

/**
 * Shared fetch for catalog About/Changelog (and tab presence). The underlying
 * registry fetch is cached and coalesced; failures resolve `null` and are
 * retried on the next call.
 */
export async function prefetchCatalogVersionDocs(
  args: VersionArgs,
): Promise<CatalogVersionDocs | null> {
  const result = await fetchRegistryPackVersionSafe(args);
  return result.ok ? docsFromDetail(result.detail) : null;
}
