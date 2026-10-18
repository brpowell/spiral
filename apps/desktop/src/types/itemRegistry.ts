/** Catalog + registry-source shapes for the item registry client (mirrors `packs::registry`). */

import type { ItemType } from "./item";

/** One configured registry. Identity is the normalized URL. */
export interface RegistrySource {
  /** Base URL (`GET /v1/items`, downloads). */
  url: string;
  /** Short display label. */
  name: string;
}

/** One published version of an item. */
export interface RegistryVersionSummary {
  version: string;
  name?: string;
  description?: string;
  minAppVersion?: string | null;
  /** Uncompressed on-disk size of the item (not the `.spk` archive length). */
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
  previewUrl?: string | null;
}

/** Catalog row: an item and its newest version, tagged with its registry. */
export interface RegistryItemSummary {
  registryUrl: string;
  publisherId: string;
  itemType: ItemType;
  id: string;
  /** `publisherId.type.id`. */
  effectiveId: string;
  latestVersion: RegistryVersionSummary;
}

/** An item with all published versions, newest first (`GET /v1/items/:publisher/:type/:id`). */
export interface RegistryItemDetail {
  registryUrl: string;
  publisherId: string;
  itemType: ItemType;
  id: string;
  effectiveId: string;
  versions: RegistryVersionSummary[];
}

/** One version with README / CHANGELOG (`GET .../versions/:version`). */
export interface RegistryVersionDetail extends RegistryVersionSummary {
  registryUrl: string;
  publisherId: string;
  itemType: ItemType;
  id: string;
  effectiveId: string;
  readme?: string | null;
  changelog?: string | null;
}

export interface RegistryFetchError {
  registryUrl: string;
  error: string;
}

export interface RegistryItemList {
  items: RegistryItemSummary[];
  /** Matches before paging, summed over registries. */
  total: number;
  /** Per-source failures when some registries were unreachable. */
  errors?: RegistryFetchError[];
}

/** Server-side filters and paging for the catalog. */
export interface ItemCatalogQuery {
  itemType?: ItemType | null;
  /** Substring over name, description, id and publisher. */
  q?: string | null;
  publisherId?: string | null;
  limit?: number;
  offset?: number;
}

/** A newer, app-compatible version of an installed item. */
export interface ItemUpdate {
  registryUrl: string;
  publisherId: string;
  itemType: ItemType;
  id: string;
  effectiveId: string;
  installedVersion: string;
  latest: RegistryVersionSummary;
}

export interface ItemUpdateCheck {
  updates: ItemUpdate[];
  errors?: RegistryFetchError[];
}

/** Catalog row enriched with local install + app-version state (no network). */
export interface CatalogItemEntry extends RegistryItemSummary {
  /** Version installed under `installed/`, when any. */
  installedVersion: string | null;
  /** True when that version is the catalog's newest. */
  installed: boolean;
  /** True when something is installed and the catalog's newest is newer. */
  updateAvailable: boolean;
  /** False when `minAppVersion` exceeds the running app, so Install should be disabled. */
  meetsMinAppVersion: boolean;
  /** Local `asset:` URL after Rust caches the catalog preview; null when missing/failed. */
  resolvedPreviewUrl?: string | null;
}

export interface ItemDownloadProgress {
  current: number;
  total: number;
}

/** Display name for a catalog or update entry: the version's name, else the item id. */
export function catalogItemName(entry: {
  id: string;
  latestVersion?: { name?: string };
  latest?: { name?: string };
}): string {
  return (
    entry.latestVersion?.name?.trim() || entry.latest?.name?.trim() || entry.id
  );
}
