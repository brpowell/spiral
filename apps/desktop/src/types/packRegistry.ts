/** Catalog + registry-source shapes for pack registry client integration. */

/** One configured pack registry. Identity is the normalized URL. */
export interface RegistrySource {
  /** Base URL (`GET /v1/packs`, downloads). */
  url: string;
  /** Short display label. */
  name: string;
}

/** Contribution summary extracted at publish for pre-install browsing. */
export interface RegistryContributionSummary {
  type: string;
  localId: string;
  effectiveId: string;
  name: string;
  author: string;
}

export interface RegistryVersionSummary {
  version: string;
  /** Display name from pack.json (empty on older registry rows). */
  name?: string;
  /** Short description from pack.json. */
  description?: string;
  minAppVersion?: string | null;
  contributionTypes: string[];
  /** Contribution summaries for catalog browsing (may be empty on older rows). */
  contributions?: RegistryContributionSummary[];
  /** Uncompressed on-disk size of the pack root (not `.spk` archive length). */
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
  previewUrl?: string | null;
}

/** Full version detail including README/CHANGELOG (from `GET .../versions/:version`). */
export interface RegistryVersionDetail {
  registryUrl: string;
  publisherId: string;
  packId: string;
  version: string;
  name: string;
  description: string;
  minAppVersion?: string | null;
  contributionTypes: string[];
  contributions: RegistryContributionSummary[];
  /** Uncompressed on-disk size of the pack root (not `.spk` archive length). */
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
  previewUrl?: string | null;
  readme?: string | null;
  changelog?: string | null;
}

/** Pack detail with all published versions (from `GET /v1/packs/:author/:pack`). */
export interface RegistryPackDetail {
  registryUrl: string;
  publisherId: string;
  packId: string;
  versions: RegistryVersionSummary[];
}

/** Catalog row tagged with which configured registry it came from. */
export interface RegistryPackSummary {
  registryUrl: string;
  publisherId: string;
  packId: string;
  latestVersion: RegistryVersionSummary;
}

export interface RegistryFetchError {
  registryUrl: string;
  error: string;
}

export interface RegistryPackList {
  packs: RegistryPackSummary[];
  /** Per-source failures when some registries were unreachable. */
  errors?: RegistryFetchError[];
}

/** Catalog row enriched with local install + app-version gates (no network). */
export interface CatalogPackEntry extends RegistryPackSummary {
  /** True when `publisherId.packId@latestVersion.version` is already under `installed/`. */
  installed: boolean;
  /**
   * True when an older installed version of the same `publisherId`+`packId` exists
   * and catalog latest is newer (semver core compare).
   */
  updateAvailable: boolean;
  /** Highest installed version for this identity, when any exist. */
  installedVersion?: string | null;
  /** Display name from an on-disk install of this pack, when known. */
  localName?: string | null;
  /** False when `minAppVersion` exceeds the running app — UI should disable download. */
  meetsMinAppVersion: boolean;
  /** Local `asset:` URL after Rust caches the catalog preview; null when missing/failed. */
  resolvedPreviewUrl?: string | null;
}

export interface PackDownloadProgress {
  current: number;
  total: number;
}

/** Prefer catalog display name, then local install name, then packId. */
export function catalogDisplayName(entry: {
  packId: string;
  localName?: string | null;
  latestVersion: { name?: string };
}): string {
  return (
    entry.latestVersion.name?.trim() || entry.localName?.trim() || entry.packId
  );
}
